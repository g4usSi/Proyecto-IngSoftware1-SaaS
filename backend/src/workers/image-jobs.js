import { randomUUID } from 'node:crypto';
import { copyFile, lstat } from 'node:fs/promises';
import { AppError } from '../lib/app-error.js';
import { MAX_UPLOAD_BYTES, prepareImage, removeTemporary } from '../modules/storage/storage.files.js';
import { cursorFor, parsePagination, safeOriginalName } from '../modules/storage/storage.validation.js';
import { checkJobDirectory, cleanJobFiles, fingerprint, jobPaths, normalizeJobId, recoverResult, saveResult, verifyConverted } from './image-job-files.js';
import { transaction, withJobLock } from './job-lock.js';

export { jobPaths, normalizeJobId } from './image-job-files.js';
export const MAX_JOB_ATTEMPTS = 3;
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function publicJob(row) {
  const terminal = ['failed', 'published'].includes(row.status);
  return { id: row.id, originalName: row.original_name, status: row.status, attempts: row.attempts,
    maxAttempts: MAX_JOB_ATTEMPTS, errorCode: row.error_code, imageId: row.published_image_id,
    available: row.status === 'published' && !!row.published_image_id,
    downloadUrl: row.status === 'published' && row.published_image_id ? `/api/files/${row.published_image_id}/download` : null,
    quotaState: !row.quota_managed ? 'not_required' : row.quota_settled_at ? 'settled' : 'pending',
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    nextPollAfterMs: terminal ? null : 2000 };
}

// Puerto interno de integración; ningún doble se activa mediante .env.
export function createImageJobs({ database, storageRoot, lifecycle, convert = prepareImage, now = Date.now }) {
  if (lifecycle && ['reserve', 'confirm', 'release'].some((name) => typeof lifecycle[name] !== 'function')) {
    throw new TypeError('lifecycle requiere reserve, confirm y release.');
  }
  const load = async (client, id) => (await client.query('SELECT * FROM image_processing_jobs WHERE id = $1', [id])).rows[0];

  async function settle(client, job) {
    if (!job.quota_managed || job.quota_settled_at || !lifecycle || !['converted', 'failed'].includes(job.status)) return job;
    await transaction(client, async () => {
      const payload = { jobId: job.id, userId: job.user_id, originalHash: job.original_hash,
        originalSizeBytes: String(job.original_size_bytes), originalName: job.original_name };
      if (job.status === 'converted') {
        // Publicación y confirmación de cuota comparten ESTA transacción.
        // El adaptador debe copiar, nunca mover/borrar la entrada antes del COMMIT.
        const { imageId } = await lifecycle.confirm(client, { ...payload, resultPath: jobPaths(storageRoot, job.id).result });
        const image = await client.query(`SELECT i.id FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
          WHERE i.id = $1 AND i.user_id = $2 AND i.object_hash = $3 AND o.status = 'ready'`, [imageId, job.user_id, job.original_hash]);
        if (!image.rows.length) throw new Error('El contrato debe publicar una imagen propia antes de confirmar.');
        await client.query(`UPDATE image_processing_jobs SET status = 'published', published_image_id = $2,
          quota_settled_at = now(), updated_at = now() WHERE id = $1`, [job.id, imageId]);
      } else {
        await lifecycle.release(client, { ...payload, reason: job.error_code });
        await client.query('UPDATE image_processing_jobs SET quota_settled_at = now(), updated_at = now() WHERE id = $1', [job.id]);
      }
    });
    return load(client, job.id);
  }

  async function clean(client, job) {
    // Si se perdió la sesión también se perdió el bloqueo: no borrar desde ella.
    await client.query('SELECT 1');
    if (job.status === 'converted') return cleanJobFiles(storageRoot, job.id, { keepResult: true });
    if (['failed', 'published'].includes(job.status) && !job.cleaned_at) {
      await cleanJobFiles(storageRoot, job.id);
      await client.query('UPDATE image_processing_jobs SET cleaned_at = now() WHERE id = $1', [job.id]);
    }
  }

  async function finish(client, job) {
    // Una liberación pendiente solo necesita el UUID, no el original.
    try { job = await settle(client, job); }
    finally { await clean(client, job); }
    return { id: job.id, status: job.status };
  }

  async function fail(client, job, code) {
    await client.query(`UPDATE image_processing_jobs SET status = 'failed', error_code = $2, converted_at = NULL,
      updated_at = now(), cleaned_at = NULL WHERE id = $1 AND status <> 'published'`, [job.id, code]);
    return finish(client, await load(client, job.id));
  }

  async function markConverted(client, job) {
    await client.query(`UPDATE image_processing_jobs SET status = 'converted', converted_at = now(),
      error_code = NULL, updated_at = now() WHERE id = $1`, [job.id]);
    return finish(client, await load(client, job.id));
  }

  async function examine(client, job) {
    if (['failed', 'published'].includes(job.status)) return finish(client, job);
    if (job.expires_at.getTime() <= now()) return fail(client, job, 'JOB_EXPIRED');
    try {
      await checkJobDirectory(storageRoot, job.id);
      const files = jobPaths(storageRoot, job.id);
      if (job.status === 'converted') await verifyConverted(files, job);
      else if (!await recoverResult(files, job)) return null;
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return fail(client, job, error.code);
      throw error;
    }
    // Un fallo del adaptador no invalida una conversión ya terminada.
    return job.status === 'converted' ? finish(client, job) : markConverted(client, job);
  }

  return {
    // Interno: S3-11 conecta HTTP cuando exista un lifecycle de cuotas real.
    async stage({ ownerId, file }) {
      if (!file?.path) throw new AppError(400, 'UPLOAD_REQUIRED', 'Selecciona una imagen.');
      const info = await lstat(file.path);
      if (!info.isFile() || !info.size) throw new AppError(400, 'EMPTY_FILE', 'La imagen está vacía o no es un archivo regular.');
      if (info.size > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
      const id = randomUUID();
      return withJobLock(database, id, async (client) => {
        const files = jobPaths(storageRoot, id);
        await checkJobDirectory(storageRoot, id, { create: true });
        let committing = false;
        try {
          await copyFile(file.path, files.original);
          const { size, hash } = await fingerprint(files.original, MAX_UPLOAD_BYTES);
          await client.query('BEGIN');
          const { rows } = await client.query(`INSERT INTO image_processing_jobs
            (id, user_id, original_name, original_size_bytes, original_hash, quota_managed)
            SELECT $1, id, $3, $4, $5, $6 FROM users WHERE id = $2 AND active = TRUE RETURNING id`,
          [id, ownerId, safeOriginalName(file.originalname), size, hash, !!lifecycle]);
          if (!rows.length) throw new AppError(401, 'USER_INACTIVE', 'La cuenta no existe o está inactiva.');
          if (lifecycle) await lifecycle.reserve(client, { jobId: id, userId: ownerId, originalHash: hash,
            originalSizeBytes: String(size), originalName: safeOriginalName(file.originalname) });
          committing = true;
          await client.query('COMMIT');
          return { id, status: 'queued' };
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          // COMMIT incierto: el reconciliador comprobará la fila antes de limpiar.
          if (!committing) await cleanJobFiles(storageRoot, id);
          throw error;
        }
      });
    },

    async get(ownerId, id) {
      id = normalizeJobId(id);
      const { rows: [row] } = await database.query('SELECT * FROM image_processing_jobs WHERE id = $1 AND user_id = $2', [id, ownerId]);
      if (!row) throw new AppError(404, 'JOB_NOT_FOUND', 'El trabajo no existe o no pertenece a esta cuenta.');
      return publicJob(row);
    },

    async list(ownerId, query = {}) {
      const { limit, cursor } = parsePagination(query);
      const { rows } = await database.query(`SELECT *, to_char(created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM image_processing_jobs
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $4`, [ownerId, cursor?.createdAt || null, cursor?.id || null, limit + 1]);
      const page = rows.slice(0, limit);
      return { items: page.map(publicJob), nextCursor: rows.length > limit ? cursorFor(page.at(-1)) : null };
    },

    async process(id, { finalAttempt = false } = {}) {
      id = normalizeJobId(id);
      return withJobLock(database, id, async (client) => {
        const job = await load(client, id);
        if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'No existe el trabajo.');
        const existing = await examine(client, job);
        if (existing) {
          if (existing.status === 'failed') throw new AppError(422, (await load(client, id)).error_code, 'El trabajo terminó con error.');
          return existing;
        }
        if (job.attempts >= MAX_JOB_ATTEMPTS) {
          await fail(client, job, 'JOB_ATTEMPTS_EXHAUSTED');
          throw new AppError(422, 'JOB_ATTEMPTS_EXHAUSTED', 'Se agotaron los intentos de conversión.');
        }
        const files = jobPaths(storageRoot, id);
        await client.query(`UPDATE image_processing_jobs SET status = 'processing', attempts = attempts + 1,
          error_code = NULL, updated_at = now() WHERE id = $1`, [id]);
        let prepared;
        let resultSaved = false;
        try {
          const input = await fingerprint(files.original, MAX_UPLOAD_BYTES);
          if (input.hash !== job.original_hash || String(input.size) !== String(job.original_size_bytes)) {
            throw new AppError(422, 'JOB_INPUT_CHANGED', 'El temporal no coincide con el original admitido.');
          }
          prepared = await convert({ path: files.original, size: input.size }, files.directory);
          if (prepared.hash !== job.original_hash || prepared.originalSizeBytes !== String(job.original_size_bytes)) {
            throw new AppError(422, 'JOB_INPUT_CHANGED', 'El temporal cambió durante la conversión.');
          }
          await client.query('SELECT 1');
          await saveResult(files, job, prepared.optimizedPath);
          resultSaved = true;
          await client.query(`UPDATE image_processing_jobs SET status = 'converted', converted_at = now(),
            error_code = NULL, updated_at = now() WHERE id = $1`, [id]);
        } catch (error) {
          const permanent = error instanceof AppError && error.status < 500 || error.code === 'ENOENT';
          const code = error instanceof AppError ? error.code : error.code === 'ENOENT' ? 'JOB_INPUT_MISSING' : 'PROCESSING_UNAVAILABLE';
          const terminal = !resultSaved && (permanent || finalAttempt || job.attempts + 1 >= MAX_JOB_ATTEMPTS);
          const updated = await client.query(`UPDATE image_processing_jobs SET status = $2, error_code = $3,
            updated_at = now() WHERE id = $1 AND status <> 'converted' RETURNING id`, [id, terminal ? 'failed' : 'queued', code]);
          if (terminal && updated.rows.length) await finish(client, await load(client, id));
          throw new AppError(permanent ? 422 : 503, code, 'No se pudo convertir la imagen.');
        } finally { await removeTemporary(prepared?.optimizedPath); }
        return finish(client, await load(client, id));
      });
    },

    async recover(id, ensureQueued) {
      return withJobLock(database, id, async (client) => {
        const job = await load(client, id);
        if (!job) return { skipped: true };
        const existing = await examine(client, job);
        if (existing) return existing;
        if (job.attempts >= MAX_JOB_ATTEMPTS) return fail(client, job, 'JOB_ATTEMPTS_EXHAUSTED');
        try {
          const input = await fingerprint(jobPaths(storageRoot, id).original, MAX_UPLOAD_BYTES);
          if (input.hash !== job.original_hash || String(input.size) !== String(job.original_size_bytes)) return fail(client, job, 'JOB_INPUT_CHANGED');
        } catch (error) {
          if (error.code === 'ENOENT') return fail(client, job, 'JOB_INPUT_MISSING');
          if (error instanceof AppError && error.status < 500) return fail(client, job, error.code);
          throw error;
        }
        await client.query("UPDATE image_processing_jobs SET status = 'queued', updated_at = now() WHERE id = $1 AND status = 'processing'", [id]);
        await ensureQueued(id);
        return { id, status: 'queued' };
      }, { tryOnly: true });
    },
  };
}
