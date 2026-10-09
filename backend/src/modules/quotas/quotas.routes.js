import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { createQuotasRepository } from './quotas.repository.js';

export function createQuotasRouter(database) {
  const router = Router();
  const quotas = createQuotasRepository(database);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, requireAuth);
  router.get('/me', async (req, res) => {
    const data = await quotas.withUserTransaction(req.user.id, async (client) => {
      const plan = await quotas.getActivePlan(client, req.user.id);
      const usage = await quotas.getUsage(client, req.user.id);
      const available = BigInt(plan.capacity_bytes) - BigInt(usage.used_bytes) - BigInt(usage.pending_bytes);
      return {
        plan: { code: plan.code, name: plan.name },
        capacityBytes: String(plan.capacity_bytes), usedBytes: usage.used_bytes,
        reservedBytes: usage.pending_bytes, availableBytes: (available > 0n ? available : 0n).toString(),
        daily: { date: usage.usage_date, uploadLimit: plan.daily_upload_limit,
          uploadsUsed: usage.daily_count, uploadsReserved: usage.pending_daily_count,
          bytesLimit: plan.daily_bytes_limit, bytesUsed: usage.daily_bytes, bytesReserved: usage.pending_daily_bytes },
      };
    });
    res.json({ data });
  });
  return router;
}
