import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { parseUploadFields, requireStorageIdentity } from './storage.validation.js';
import { createUploadMiddleware } from './storage.upload.js';
import { removeTemporary } from './storage.files.js';
import { createManagedImageJobs } from '../../workers/image-lifecycle.js';
import { enqueueDefaultImageJob } from '../../workers/image-admission.js';

export function createJobsRouter({ database, storageRoot, enqueueJob = enqueueDefaultImageJob }) {
  const router = Router();
  const jobs = createManagedImageJobs({ database, storageRoot });
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, requireAuth, requireStorageIdentity);
  router.get('/', async (req, res) => { res.json({ data: await jobs.list(req.user.id, req.query) }); });
  router.get('/:jobId', async (req, res) => { res.json({ data: await jobs.get(req.user.id, req.params.jobId) }); });
  router.post('/', createUploadMiddleware(storageRoot), async (req, res) => {
    try {
      const { folderId } = parseUploadFields(req.body);
      const job = await jobs.stage({ ownerId: req.user.id, file: req.file, folderId, jobId: req.get('Idempotency-Key') });
      // La admisión ya está confirmada. Una pérdida de Redis no invita a
      // repetir la carga: el reconciliador recupera la entrega por UUID.
      try { await enqueueJob(job.id); }
      catch { console.error('Trabajo admitido; entrega a cola pendiente de recuperación.'); }
      res.location(`/api/jobs/${job.id}`).status(202).json({ data: await jobs.get(req.user.id, job.id) });
    } finally { await removeTemporary(req.file?.path); }
  });
  return router;
}
