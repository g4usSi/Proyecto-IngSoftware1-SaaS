import { Router } from 'express';
import { AppError } from '../../lib/app-error.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { requireStorageIdentity } from './storage.validation.js';
import { createImageJobs } from '../../workers/image-jobs.js';

export function createJobsRouter({ database, storageRoot }) {
  const router = Router();
  const jobs = createImageJobs({ database, storageRoot });
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, requireAuth, requireStorageIdentity);
  router.get('/', async (req, res) => { res.json({ data: await jobs.list(req.user.id, req.query) }); });
  router.get('/:jobId', async (req, res) => { res.json({ data: await jobs.get(req.user.id, req.params.jobId) }); });
  // Reserva explícita del contrato: no aceptar archivos ni crear trabajos sin cuotas.
  router.post('/', () => { throw new AppError(503, 'ASYNC_UPLOAD_NOT_READY', 'La carga asíncrona aún no está disponible. Utiliza la carga de archivos actual.'); });
  return router;
}
