import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { createUsersRepository } from './users.repository.js';
import { createUsersService } from './users.service.js';
import { createUsersController } from './users.controller.js';
import { createAuditRecorder } from '../audit/audit.routes.js';

// Se monta en /api/admin/users. Todas las rutas exigen sesión y rol admin (RF08, RF09).
export function createUsersAdminRouter(database) {
  const router = Router();
  const service = createUsersService({ repository: createUsersRepository(database), audit: createAuditRecorder(database) });
  const controller = createUsersController(service);
  router.use(requireAuth, requireRole('admin'));
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id/status', controller.setStatus);
  return router;
}
