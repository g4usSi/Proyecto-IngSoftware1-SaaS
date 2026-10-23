import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { createAuditRepository } from './audit.repository.js';
import { createAuditService } from './audit.service.js';

// GET /api/admin/audit-events (RF-AUT-12, RNF-AUT-10): solo administradores, solo lectura.
export function createAuditRouter(database) {
  const router = Router();
  const service = createAuditService(createAuditRepository(database));
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, requireAuth, requireRole('admin'));
  router.get('/', async (req, res) => {
    res.json({ data: await service.list(req.query) });
  });
  return router;
}

export function createAuditRecorder(database) {
  return createAuditService(createAuditRepository(database));
}
