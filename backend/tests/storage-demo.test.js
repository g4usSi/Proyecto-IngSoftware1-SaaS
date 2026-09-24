import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';
import { createStorageDemo, DEMO_ACCOUNTS } from '../src/dev/storage-demo.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { readEnv } from '../src/config/env.js';

async function demoApi(t, enabled, rows = DEMO_ACCOUNTS.map((account) => ({ ...account, role: 'client' }))) {
  let queries = 0;
  const database = { query: async () => { queries += 1; return { rows }; } };
  const demo = createStorageDemo({ database, enabled });
  const app = express();
  app.use('/dev', demo.router);
  app.get('/private', demo.authenticate, (req, res) => res.json({ data: req.user }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    request: (route, headers) => fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers }),
    foreignHostStatus: () => new Promise((resolve, reject) => {
      get({ hostname: '127.0.0.1', port: server.address().port, path: '/dev/storage-demo', headers: { Host: 'external.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).once('error', reject);
    }),
    queries: () => queries,
  };
}

test('demo apagada no revela cuentas ni acepta su cabecera como autenticación', async (t) => {
  const api = await demoApi(t, false);
  const discovery = await api.request('/dev/storage-demo');
  assert.deepEqual((await discovery.json()).data, { enabled: false, accounts: [] });
  const response = await api.request('/private', { 'X-Storage-Demo-User': DEMO_ACCOUNTS[0].id });
  assert.equal(response.status, 501);
  assert.equal(api.queries(), 0);
});

test('demo encendida exige selección explícita, identidad reservada y host local', async (t) => {
  const api = await demoApi(t, true);
  const discovery = await api.request('/dev/storage-demo');
  assert.equal(discovery.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await discovery.json()).data.accounts, DEMO_ACCOUNTS);
  assert.equal((await api.request('/private')).status, 501);
  const accepted = await api.request('/private', { 'X-Storage-Demo-User': DEMO_ACCOUNTS[1].id });
  assert.deepEqual((await accepted.json()).data, { id: DEMO_ACCOUNTS[1].id, email: DEMO_ACCOUNTS[1].email, role: 'client' });
  for (const headers of [
    { 'X-Storage-Demo-User': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { 'X-Storage-Demo-User': DEMO_ACCOUNTS[0].id, Authorization: 'Bearer invented' },
  ]) assert.equal((await api.request('/private', headers)).status, 401);
  assert.equal(await api.foreignHostStatus(), 403);
});

test('demo no concede acceso a cuentas alteradas o no preparadas', async (t) => {
  const api = await demoApi(t, true, [{ ...DEMO_ACCOUNTS[0], role: 'admin' }]);
  const response = await api.request('/private', { 'X-Storage-Demo-User': DEMO_ACCOUNTS[0].id });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DEMO_NOT_SEEDED');
});

test('ruta de archivos parte del proyecto y demo es opt-in estrictamente local', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  assert.equal(readEnv({}).storageRoot, path.join(root, 'storage'));
  assert.equal(readEnv({ STORAGE_ROOT: './custom-storage' }).storageRoot, path.join(root, 'custom-storage'));
  assert.equal(readEnv({}).storageDemo, false);
  assert.equal(readEnv({ STORAGE_DEMO_ENABLED: 'true' }).storageDemo, true);
  for (const extra of [
    { NODE_ENV: 'production' }, { HOST: '0.0.0.0' }, { CORS_ORIGINS: 'https://external.example' },
  ]) assert.throws(() => readEnv({ STORAGE_DEMO_ENABLED: 'true', ...extra }), /demostración/);
  assert.throws(() => readEnv({ STORAGE_DEMO_ENABLED: 'yes' }), /STORAGE_DEMO_ENABLED/);
});
