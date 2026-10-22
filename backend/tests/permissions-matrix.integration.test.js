// S4-05: la matriz de permisos de docs/permisos-api.md se verifica contra la API real.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { fixture as workerFixture } from './helpers/worker-fixture.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 90000 };
const SECRET = 'matrix-test-secret-longer-than-thirty-two-characters';

const PUBLIC = [['GET', '/health'], ['GET', '/plans']];
const AUTHENTICATED = [
  ['GET', '/auth/me'], ['GET', '/quotas/me'], ['GET', '/files'], ['GET', '/files/summary'], ['GET', '/albums'],
  ['GET', '/jobs'], ['GET', '/subscriptions/me'], ['GET', '/payments'], ['GET', '/payments/receipts'],
];
const ADMIN_ONLY = (userId) => [
  ['GET', '/admin/summary'], ['GET', '/admin/subscriptions'], ['GET', '/admin/usage'], ['GET', '/admin/jobs'],
  ['GET', '/admin/audit-events'], ['GET', '/admin/storage/stats'], ['GET', '/admin/users'],
  ['GET', `/admin/users/${userId}`], ['PATCH', `/admin/users/${userId}/status`, { active: true }],
];

test('S4-05: sin sesión 401, cliente 403 y administrador accede, ruta por ruta', options, async (t) => {
  const f = await workerFixture(t);
  const [admin, client] = f.users;
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  await f.database.query("UPDATE users SET role='admin' WHERE id=$1", [admin]);
  const tokens = createTokenService({ secret: SECRET, expiresIn: '1h' });
  const bearer = (id) => ({ Authorization: `Bearer ${tokens.issue(id).token}` });
  const server = createApp({ ...f, storageDemo: false, jwtSecret: SECRET, enqueueJob: async () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const status = async ([method, route, body], headers = {}) => {
    const response = await fetch(`${base}${route}`, {
      method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    await response.arrayBuffer();
    return response.status;
  };
  try {
    for (const route of PUBLIC) assert.equal(await status(route), 200, `${route[0]} ${route[1]} es público`);
    for (const route of [...AUTHENTICATED, ...ADMIN_ONLY(client)]) {
      assert.equal(await status(route), 401, `${route[0]} ${route[1]} sin sesión`);
      assert.equal(await status(route, { Authorization: 'Bearer token.invalido.x' }), 401, `${route[0]} ${route[1]} token inválido`);
    }
    for (const route of AUTHENTICATED) {
      const code = await status(route, bearer(client));
      assert.ok(code === 200 || code === 404, `${route[0]} ${route[1]} cliente: ${code}`); // 404 solo en /payments/receipts sin pagos
      assert.equal(await status(route, bearer(admin)), code, `${route[0]} ${route[1]} admin igual que cliente`);
    }
    for (const route of ADMIN_ONLY(client)) {
      assert.equal(await status(route, bearer(client)), 403, `${route[0]} ${route[1]} cliente`);
      assert.equal(await status(route, bearer(admin)), 200, `${route[0]} ${route[1]} administrador`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
