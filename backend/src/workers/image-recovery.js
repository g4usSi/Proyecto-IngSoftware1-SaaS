import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { checkJobDirectory, cleanJobFiles, jobPaths, normalizeJobId, statOrNull } from './image-job-files.js';
import { JOB_TTL_MS } from './image-jobs.js';
import { enqueueImageJob } from './image-queue.js';
import { withJobLock } from './job-lock.js';

export async function ensureImageQueued(queue, id) {
  const existing = await queue.getJob(id);
  if (!existing) return enqueueImageJob(queue, id);
  const state = await existing.getState();
  if (['failed', 'completed'].includes(state)) {
    // Redis puede perder sus contadores. El límite real persiste en PostgreSQL.
    await existing.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
  }
  // active/waiting/delayed conservan su bloqueo y backoff; BullMQ recupera stalled.
}

export function createImageRecovery({ database, storageRoot, jobs, queue, now = Date.now, orphanTtlMs = JOB_TTL_MS }) {
  let running;
  async function sweep() {
    const summary = { checked: 0, queued: 0, converted: 0, published: 0, failed: 0, skipped: 0, orphansRemoved: 0, errors: [] };
    let cursor = '00000000-0000-0000-0000-000000000000';
    // Paginación por UUID: un lote de pendientes no oculta filas posteriores.
    for (;;) {
      const { rows } = await database.query(`SELECT id FROM image_processing_jobs WHERE id > $1 AND
        (status IN ('queued', 'processing', 'converted') OR cleaned_at IS NULL OR (quota_managed AND quota_settled_at IS NULL))
        ORDER BY id LIMIT 100`, [cursor]);
      if (!rows.length) break;
      for (const { id } of rows) {
        summary.checked++;
        try {
          const result = await jobs.recover(id, (jobId) => ensureImageQueued(queue, jobId));
          if (result.skipped) summary.skipped++;
          else summary[result.status]++;
        } catch { summary.errors.push({ id, code: 'RECOVERY_UNAVAILABLE' }); }
      }
      cursor = rows.at(-1).id;
    }
    // Verificar padres antes de enumerar; nunca atravesar un enlace a otro disco.
    await checkJobDirectory(storageRoot, '00000000-0000-4000-8000-000000000000');
    const parent = path.resolve(storageRoot, '.tmp', 'jobs');
    if (!await statOrNull(parent)) return summary;
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      let id;
      try { id = normalizeJobId(entry.name); } catch { continue; }
      if (entry.name !== id || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const outcome = await withJobLock(database, id, async (client) => {
          const { rows } = await client.query('SELECT id FROM image_processing_jobs WHERE id = $1', [id]);
          if (rows.length) return false;
          const info = await statOrNull(jobPaths(storageRoot, id).directory);
          if (!info || now() - info.mtimeMs < orphanTtlMs) return false;
          await cleanJobFiles(storageRoot, id);
          return true;
        }, { tryOnly: true });
        if (outcome === true) summary.orphansRemoved++;
      } catch { summary.errors.push({ id, code: 'CLEANUP_UNAVAILABLE' }); }
    }
    return summary;
  }
  return {
    runOnce() {
      if (!running) running = sweep().finally(() => { running = undefined; });
      return running;
    },
  };
}

export function startRecoveryLoop(recovery, { intervalMs = 30000, onError = () => {} } = {}) {
  let stopped = false;
  let timer;
  let pending;
  const tick = () => {
    pending = recovery.runOnce().then((result) => { if (result.errors.length) onError(); }).catch(onError).finally(() => {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  };
  tick();
  return { async close() { stopped = true; clearTimeout(timer); await pending; } };
}
