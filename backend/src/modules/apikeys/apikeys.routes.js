import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { createApiKeysRepository } from './apikeys.repository.js';
import { createApiKeysService } from './apikeys.service.js';

// Gestión de claves: solo con sesión iniciada. Una clave de API no puede crear ni revocar claves.
export function createApiKeysRouter(database) {
  const router = Router();
  const keys = createApiKeysService(createApiKeysRepository(database));
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, requireAuth);
  router.get('/', async (req, res) => { res.json({ data: await keys.list(req.user.id) }); });
  router.post('/', async (req, res) => { res.status(201).json({ data: await keys.create(req.user.id, req.body) }); });
  router.delete('/:keyId', async (req, res) => { res.json({ data: await keys.revoke(req.user.id, req.params.keyId) }); });
  return router;
}
