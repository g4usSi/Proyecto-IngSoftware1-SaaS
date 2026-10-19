import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 60000 };
const secret = 'admin-consultas-integration-secret-more-than-32-chars';

async function fixture(t) {
  const schema = `admin_test_${randomUUID().replaceAll('-', '')}`;
  const root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  await root.query(`CREATE SCHEMA "${schema}"`);
  const database = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 4 });
  t.after(async () => {
    await database.end();
    await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root.end();
  });
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => /^\d+[-_].*\.sql$/.test(f)).sort()) {
    await database.query(await readFile(new URL(file, dir), 'utf8'));
  }
  const ids = {};
  for (const [name, role] of [['ana', 'client'], ['beto', 'client'], ['admin', 'admin']]) {
    ids[name] = (await database.query(`INSERT INTO users(name, email, password_hash, role, email_verified)
      VALUES ($1, $2, '!test', $3, TRUE) RETURNING id`, [name, `${name}@admin.test`, role])).rows[0].id;
  }
  await database.query(`INSERT INTO subscriptions(user_id, plan_id) SELECT u.id, p.id FROM users u CROSS JOIN plans p WHERE p.code = 'free'`);
  const tokens = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, createTokenService({ secret, expiresIn: '1h' }).issue(id).token]));
  const server = createApp({ database, storageDemo: false, jwtSecret: secret, enqueueJob: async () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (route, as = 'admin') => fetch(`http://127.0.0.1:${server.address().port}/api${route}`,
    { headers: as ? { Authorization: `Bearer ${tokens[as]}` } : {} });
  async function image(owner, size, { trash = false, hashSeed = randomUUID() } = {}) {
    const hash = createHash('sha256').update(hashSeed).digest('hex');
    await database.query(`INSERT INTO stored_objects(hash_sha256, original_size_bytes, storage_key, status)
      VALUES ($1, $2, $3, 'ready') ON CONFLICT DO NOTHING`, [hash, size, `${hash.slice(0, 2)}/${hash}.webp`]);
    await database.query(`INSERT INTO images(user_id, object_hash, original_name, deleted_at)
      VALUES ($1, $2, 'foto.png', $3)`, [owner, hash, trash ? new Date() : null]);
  }
  return { database, ids, request, image };
}

async function data(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body.data;
}

test('Admin S4-04: solo el administrador consulta resumen, suscripciones y consumo', options, async (t) => {
  const f = await fixture(t);
  for (const route of ['/admin/summary', '/admin/subscriptions', '/admin/usage']) {
    assert.equal((await f.request(route, null)).status, 401, `${route} sin sesión`);
    const denied = await f.request(route, 'ana');
    assert.equal(denied.status, 403, `${route} como cliente`);
    assert.equal((await denied.json()).error.code, 'FORBIDDEN');
    assert.equal((await f.request(route)).status, 200, `${route} como administrador`);
  }
  await f.database.query('UPDATE users SET active = FALSE WHERE id = $1', [f.ids.admin]);
  assert.equal((await f.request('/admin/summary')).status, 403, 'Una cuenta desactivada pierde el acceso');
});

test('Admin S4-04: base vacía responde ceros reales y planes sin suscriptores', options, async (t) => {
  const f = await fixture(t);
  const summary = await data(await f.request('/admin/summary'));
  assert.deepEqual(summary.users, { total: '3', active: '3', verified: '3', admins: '1' });
  assert.equal(summary.storage.logicalBytes, '0');
  assert.equal(summary.storage.deduplicatedPercent, '0.00');
  assert.equal(summary.plans.find((p) => p.code === 'free').currentSubscriptions, '3');
  assert.equal(summary.jobs.failed, '0');
});

test('Admin S4-04: consumo lógico, papelera, reservas y deduplicación coinciden con la base', options, async (t) => {
  const f = await fixture(t);
  await f.image(f.ids.ana, 1000, { hashSeed: 'compartida' });
  await f.image(f.ids.beto, 1000, { hashSeed: 'compartida' });
  await f.image(f.ids.ana, 500, { trash: true });
  await f.database.query(`INSERT INTO quota_reservations(user_id, reservation_key, reserved_bytes)
    VALUES ($1, $2, 250)`, [f.ids.beto, randomUUID()]);

  const summary = await data(await f.request('/admin/summary'));
  assert.equal(summary.storage.logicalBytes, '2500', 'La papelera sigue contando');
  assert.equal(summary.storage.uniqueOriginalBytes, '1500');
  assert.equal(summary.storage.deduplicatedBytes, '1000');
  assert.equal(summary.storage.deduplicatedPercent, '40.00');
  assert.equal(summary.storage.reservedBytes, '250');
  assert.equal(summary.storage.imageCount, '3');
  assert.equal(summary.storage.trashCount, '1');
  assert.equal(summary.storage.uniqueObjectCount, '2');

  const usage = await data(await f.request('/admin/usage'));
  assert.equal(usage.total, '3');
  const ana = usage.items.find((item) => item.user.id === f.ids.ana);
  assert.deepEqual([ana.usedBytes, ana.reservedBytes, ana.imageCount, ana.trashCount], ['1500', '0', '2', '1']);
  assert.equal(ana.plan.code, 'free');
  assert.equal(ana.availableBytes, String(2_000_000_000 - 1500));
  const beto = usage.items.find((item) => item.user.id === f.ids.beto);
  assert.deepEqual([beto.usedBytes, beto.reservedBytes], ['1000', '250']);
  assert.equal(usage.items[0].user.id, f.ids.ana, 'Ordenado por consumo comprometido');

  const filtered = await data(await f.request('/admin/usage?search=bet&limit=1'));
  assert.equal(filtered.total, '1');
  assert.equal(filtered.items[0].user.email, 'beto@admin.test');
  assert.equal((await f.request('/admin/usage?status=active')).status, 400);
});

test('Admin S4-04: suscripciones filtran por estado, plan y búsqueda, y paginan', options, async (t) => {
  const f = await fixture(t);
  await f.database.query(`UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1`, [f.ids.beto]);
  await f.database.query(`INSERT INTO subscriptions(user_id, plan_id) SELECT $1, id FROM plans WHERE code = 'free'`, [f.ids.beto]);

  const all = await data(await f.request('/admin/subscriptions'));
  assert.equal(all.total, '4');
  const active = await data(await f.request('/admin/subscriptions?status=active&plan=free'));
  assert.equal(active.total, '3');
  assert.ok(active.items.every((item) => item.current && item.plan.code === 'free'));
  const cancelled = await data(await f.request('/admin/subscriptions?status=cancelled'));
  assert.equal(cancelled.items[0].user.id, f.ids.beto);
  assert.equal(cancelled.items[0].current, false);
  const page = await data(await f.request('/admin/subscriptions?limit=1&offset=1'));
  assert.equal(page.items.length, 1);
  assert.equal(page.total, '4');
  const like = await data(await f.request(`/admin/subscriptions?search=${encodeURIComponent('%')}`));
  assert.equal(like.total, '0', 'Los comodines de búsqueda se tratan como texto');
});
