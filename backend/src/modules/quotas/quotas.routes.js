import { Router } from 'express';
import { requireAuthOrApiKey } from '../../middleware/require-auth.js';
import { createQuotasRepository } from './quotas.repository.js';
import { createQuotasService } from './quotas.service.js';

export function createQuotasRouter(database) {
  const router = Router();
  const quotas = createQuotasService(createQuotasRepository(database));
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, requireAuthOrApiKey);
  router.get('/me', async (req, res) => {
    res.json({ data: await quotas.getMyQuota(req.user.id) });
  });
  return router;
}
