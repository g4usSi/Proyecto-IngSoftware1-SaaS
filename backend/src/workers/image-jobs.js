import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../lib/app-error.js';
import { MAX_UPLOAD_BYTES, prepareImage, removeTemporary } from '../modules/storage/storage.files.js';
import { safeOriginalName } from '../modules/storage/storage.validation.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function normalizeJobId(id) {
  if (typeof id !== 'string' || !uuid.test(id)) throw new AppError(400, 'INVALID_JOB_ID', 'El identificador de trabajo no es válido.');
  return id.toLowerCase();
}

export function jobPaths(storageRoot, id) {
  const directory = path.join(storageRoot, '.tmp', 'jobs', normalizeJobId(id));
  return { directory, original: path.join(directory, 'original'), result: path.join(directory, 'result.webp') };
}

async function fingerprint(filename) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filename)) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
    hash.update(chunk);
  }
  if (!size) throw new AppError(400, 'EMPTY_FILE', 'La imagen está vacía.');
  return { hash: hash.digest('hex'), size };
}

export function createImageJobs({ database, storageRoot }) {
  async function locked(id, operation) {
    id = normalizeJobId(id);
    const connection = await database.connect();
    let locked = false;
    let releaseError;
    try {
      // Bloqueo de sesión: processing se hace visible antes de convertir.
      // Serializa entregas repetidas, incluso con dos workers.
      await connection.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`smartstorage:conversion:${id}`]);
      locked = true;
      const { rows: [job] } = await connection.query('SELECT * FROM image_processing_jobs WHERE id = $1', [id]);
      if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'No existe el trabajo de conversión.');
      return await operation(connection, job);
    } finally {
      try {
        if (locked) await connection.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`smartstorage:conversion:${id}`]);
      } catch (error) { releaseError = error; }
      connection.release(releaseError);
    }
  }

  return {
    // Entrada INTERNA para pruebas/integración. No montar como ruta HTTP antes
    // de implementar reserva de cuota + admisión atómica de S3-08.
    async stage({ ownerId, file }) {
      if (!file?.path) throw new AppError(400, 'UPLOAD_REQUIRED', 'Selecciona una imagen.');
      const info = await lstat(file.path);
      if (!info.isFile() || info.size === 0) throw new AppError(400, 'EMPTY_FILE', 'La imagen está vacía o no es un archivo regular.');
      if (info.size > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
      const id = randomUUID();
      const files = jobPaths(storageRoot, id);
      await mkdir(files.directory, { recursive: true });
      let inserting = false;
      try {
        await copyFile(file.path, files.original);
        const { size, hash } = await fingerprint(files.original);
        inserting = true;
        const result = await database.query(`INSERT INTO image_processing_jobs
          (id, user_id, original_name, original_size_bytes, original_hash)
          SELECT $1, id, $3, $4, $5 FROM users WHERE id = $2 AND active = TRUE RETURNING id`,
        [id, ownerId, safeOriginalName(file.originalname), size, hash]);
        if (!result.rows.length) {
          inserting = false;
          throw new AppError(401, 'USER_INACTIVE', 'La cuenta no existe o está inactiva.');
        }
        return { id, status: 'queued' };
      } catch (error) {
        // Si se perdió la respuesta del INSERT, conservar el temporal: la fila
        // podría existir. S3-05 reconciliará admisiones y temporales huérfanos.
        if (!inserting) await removeTemporary(files.original);
        throw error;
      }
    },

    async get(ownerId, id) {
      jobPaths(storageRoot, id);
      const { rows: [row] } = await database.query(`SELECT id, status, attempts, error_code, created_at, updated_at
        FROM image_processing_jobs WHERE id = $1 AND user_id = $2`, [id, ownerId]);
      if (!row) throw new AppError(404, 'JOB_NOT_FOUND', 'El trabajo no existe o no pertenece a esta cuenta.');
      return { id: row.id, status: row.status, attempts: row.attempts, errorCode: row.error_code,
        createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
    },

    async process(id, { finalAttempt = false } = {}) {
      id = normalizeJobId(id);
      return locked(id, async (connection, job) => {
        const files = jobPaths(storageRoot, id);
        if (job.status === 'converted') {
          const result = await lstat(files.result).catch(() => null);
          if (!result?.isFile() || !result.size) throw new AppError(409, 'JOB_RESULT_MISSING', 'Falta el resultado temporal del trabajo.');
          await removeTemporary(files.original);
          return { id, status: 'converted' };
        }
        if (job.status === 'failed') throw new AppError(409, job.error_code || 'JOB_FAILED', 'El trabajo ya terminó con error.');
        await connection.query(`UPDATE image_processing_jobs SET status = 'processing', attempts = attempts + 1,
          error_code = NULL, updated_at = now() WHERE id = $1`, [id]);
        let prepared;
        try {
          prepared = await prepareImage({ path: files.original, size: Number(job.original_size_bytes) }, files.directory);
          if (prepared.hash !== job.original_hash || prepared.originalSizeBytes !== String(job.original_size_bytes)) {
            throw new AppError(409, 'JOB_INPUT_CHANGED', 'El temporal no coincide con el original admitido.');
          }
          await rename(prepared.optimizedPath, files.result);
          await connection.query(`UPDATE image_processing_jobs SET status = 'converted', converted_at = now(),
            error_code = NULL, updated_at = now() WHERE id = $1`, [id]);
          await removeTemporary(files.original);
          return { id, status: 'converted' };
        } catch (error) {
          const permanent = error instanceof AppError && error.status < 500 || error.code === 'ENOENT';
          const code = error instanceof AppError ? error.code : error.code === 'ENOENT' ? 'JOB_INPUT_MISSING' : 'PROCESSING_UNAVAILABLE';
          // No retroceder un COMMIT confirmado si su respuesta se perdió.
          const updated = await connection.query(`UPDATE image_processing_jobs SET status = $2, error_code = $3,
            updated_at = now() WHERE id = $1 AND status <> 'converted' RETURNING id`,
          [id, permanent || finalAttempt ? 'failed' : 'queued', code]);
          if (updated.rows.length && (permanent || finalAttempt)) await removeTemporary(files.original);
          throw new AppError(permanent ? 422 : 503, code, 'No se pudo convertir la imagen.');
        } finally {
          await removeTemporary(prepared?.optimizedPath);
        }
      });
    },
  };
}
