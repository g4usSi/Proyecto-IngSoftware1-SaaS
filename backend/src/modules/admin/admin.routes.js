import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { createAdminRepository } from './admin.repository.js';
import { createAdminService } from './admin.service.js';
import { createAdminController } from './admin.controller.js';

// Se monta en /api/admin. Cada ruta declara su protección para no interceptar otras rutas
// administrativas montadas en el mismo prefijo (storage/stats, users).
export function createAdminRouter(database) {
  const router = Router();
  const controller = createAdminController(createAdminService(createAdminRepository(database)));
  const guard = [(_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); },
    requireAuth, requireRole('admin')];
  router.get('/summary', ...guard, controller.summary);
  router.get('/subscriptions', ...guard, controller.subscriptions);
  router.get('/usage', ...guard, controller.usage);
  router.get('/jobs', ...guard, controller.jobs);
  return router;
}
