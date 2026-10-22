import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubscriptionsQuery, parseSummaryQuery, parseUsageQuery } from '../src/modules/admin/admin.validation.js';
import { createAdminService } from '../src/modules/admin/admin.service.js';

test('Admin S4-04: los filtros aplican valores por defecto y rechazan entradas ambiguas', () => {
  assert.deepEqual(parseSubscriptionsQuery({}), { status: null, plan: null, search: null, limit: 20, offset: 0 });
  assert.deepEqual(parseUsageQuery({ plan: 'free', search: '  ana  ', limit: '5', offset: '10' }),
    { plan: 'free', search: 'ana', limit: 5, offset: 10 });
  for (const query of [{ status: 'pending' }, { limit: '0' }, { limit: '101' }, { offset: '-1' }, { limit: '2.5' },
    { plan: 'Free!' }, { userId: 'x' }, { status: ['active', 'expired'] }, { search: 'x'.repeat(101) }]) {
    assert.throws(() => parseSubscriptionsQuery(query), { code: 'INVALID_ADMIN_QUERY' }, JSON.stringify(query));
  }
  assert.throws(() => parseUsageQuery({ status: 'active' }), { code: 'INVALID_ADMIN_QUERY' });
  assert.throws(() => parseSummaryQuery({ limit: '1' }), { code: 'INVALID_ADMIN_QUERY' });
});

test('Admin S4-04: el servicio calcula disponible, porcentaje y deduplicación sin inventar cifras', async () => {
  const service = createAdminService({
    async listUsage() {
      return [
        { user_id: 'u1', user_name: 'Ana', user_email: 'ana@x.test', user_active: true, plan_code: 'free', plan_name: 'Free',
          capacity_bytes: '2000000000', used_bytes: '1500000000', reserved_bytes: '600000000', image_count: '3', trash_count: '1', total: '2' },
        { user_id: 'u2', user_name: 'Beto', user_email: 'beto@x.test', user_active: false, plan_code: null, plan_name: null,
          capacity_bytes: null, used_bytes: '0', reserved_bytes: '0', image_count: '0', trash_count: '0', total: '2' },
      ];
    },
    async listSubscriptions() { return []; },
    async summary() {
      return {
        users: { total: '0', active: '0', verified: '0', admins: '0' }, plans: [],
        storage: { logical_bytes: '0', reserved_bytes: '0', unique_original_bytes: '0', image_count: '0', trash_count: '0', unique_object_count: '0' },
        jobs: [{ status: 'failed', count: '2' }],
      };
    },
  });
  const usage = await service.listUsage({ limit: 20, offset: 0 });
  assert.equal(usage.total, '2');
  assert.equal(usage.items[0].availableBytes, '0', 'Lo excedido no se muestra como negativo');
  assert.equal(usage.items[0].usedPercent, '105.00');
  assert.equal(usage.items[1].plan, null);
  assert.equal(usage.items[1].usedPercent, null, 'Sin plan vigente no hay porcentaje');
  assert.deepEqual(await service.listSubscriptions({ limit: 20, offset: 0 }), { items: [], total: '0', limit: 20, offset: 0 });
  const summary = await service.summary();
  assert.equal(summary.storage.deduplicatedPercent, '0.00');
  assert.deepEqual(summary.jobs, { queued: '0', processing: '0', converted: '0', published: '0', failed: '2' });
});
