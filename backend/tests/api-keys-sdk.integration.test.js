// CU-14 y RNF-STO-03: claves de API y SDK contra la API y PostgreSQL reales.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import sharp from 'sharp';
import { SmartStorageClient, SmartStorageError } from '../../sdk/src/index.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';
import { createManagedImageJobs } from '../src/workers/image-lifecycle.js';
import { createFakeMailer } from './helpers/fake-auth-database.js';
import { fixture as workerFixture } from './helpers/worker-fixture.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 90000 };
const SECRET = 'api-keys-test-secret-longer-than-thirty-two-characters';
const OK = { number: '4242424242424242' };

async function setup(t) {
  const f = await workerFixture(t);
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  const tokens = createTokenService({ secret: SECRET, expiresIn: '1h' });
  const managed = createManagedImageJobs({ database: f.database, storageRoot: f.storageRoot });
  // La cola se sustituye por un procesamiento inmediato: el SDK observa el mismo ciclo que con el worker.
  const server = createApp({ ...f, mailer: createFakeMailer(), storageDemo: false, jwtSecret: SECRET,
    enqueueJob: async (id) => { await managed.process(id); } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (auth, route, { method = 'GET', body, key } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, body: type.includes('json') ? await response.json() : null };
  };
  const jwt = (userId) => tokens.issue(userId).token;
  return { ...f, base, call, jwt };
}

const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 90, b: 40 } } }).png().toBuffer();

test('CU-14: las claves requieren plan Estándar y se guardan solo como huella', options, async (t) => {
  const f = await setup(t);
  const [a] = f.users;
  const free = await f.call(f.jwt(a), '/keys', { method: 'POST', body: { name: 'Demo' } });
  assert.equal(free.status, 403);
  assert.equal(free.body.error.code, 'PLAN_REQUIRED');
  assert.equal((await f.call(f.jwt(a), '/keys')).body.data.eligible, false);

  await f.call(f.jwt(a), '/subscriptions/checkout', { method: 'POST', body: { planCode: 'standard', card: OK }, key: randomUUID() });
  const created = await f.call(f.jwt(a), '/keys', { method: 'POST', body: { name: '  Script de respaldo ' } });
  assert.equal(created.status, 201);
  const { key, secret } = created.body.data;
  assert.match(secret, /^ss_[A-Za-z0-9_-]{32}$/);
  assert.equal(key.name, 'Script de respaldo');
  assert.equal(key.prefix, secret.slice(0, 11));

  const { rows: [stored] } = await f.database.query('SELECT key_hash, key_prefix FROM api_keys WHERE id = $1', [key.id]);
  assert.equal(stored.key_hash, createHash('sha256').update(secret).digest('hex'), 'solo la huella SHA-256');
  const dump = JSON.stringify((await f.database.query('SELECT * FROM api_keys')).rows);
  assert.ok(!dump.includes(secret), 'la clave completa no se guarda');

  const listed = await f.call(f.jwt(a), '/keys');
  assert.ok(!JSON.stringify(listed.body).includes(secret), 'el listado nunca vuelve a mostrar la clave');
  assert.equal(listed.body.data.items[0].prefix, key.prefix);

  for (let i = 0; i < 4; i += 1) await f.call(f.jwt(a), '/keys', { method: 'POST', body: { name: `k${i}` } });
  assert.equal((await f.call(f.jwt(a), '/keys', { method: 'POST', body: {} })).body.error.code, 'API_KEY_LIMIT');
  assert.equal((await f.call(f.jwt(a), '/keys', { method: 'POST', body: { name: '' } })).status, 400);
});

test('CU-14: el SDK sube, espera, lista, descarga y organiza con una clave de API', options, async (t) => {
  const f = await setup(t);
  const [a, b] = f.users;
  await f.call(f.jwt(a), '/subscriptions/checkout', { method: 'POST', body: { planCode: 'pro', card: OK }, key: randomUUID() });
  const { secret } = (await f.call(f.jwt(a), '/keys', { method: 'POST', body: { name: 'SDK' } })).body.data;
  const client = new SmartStorageClient({ apiKey: secret, baseUrl: f.base });

  assert.equal((await client.quota()).plan.code, 'pro');
  const job = await client.uploadImage(await png(), { filename: 'naranja.png' });
  assert.equal(job.status, 'published');
  assert.ok(job.imageId);

  const page = await client.listImages();
  const image = page.items.find((item) => item.id === job.imageId);
  assert.equal(image.originalFormat, 'png', 'RF-STO-11: formato original registrado');
  assert.equal(image.optimizedFormat, 'webp');

  const webp = await client.downloadImage(job.imageId);
  assert.equal((await sharp(webp).metadata()).format, 'webp');

  const { album } = await client.createAlbum('Desde el SDK');
  await client.moveImage(job.imageId, album.id);
  const moved = (await client.listImages({ folderId: album.id })).items[0];
  assert.equal(moved.folderName, 'Desde el SDK', 'RF-STO-11: el detalle informa el álbum');
  const all = [];
  for await (const item of client.images()) all.push(item.id);
  assert.deepEqual(all, [job.imageId]);
  assert.equal((await client.summary()).imageCount, '1');

  // Privacidad: una clave de A no accede a imágenes de B ni a rutas fuera del SDK.
  await f.call(f.jwt(b), '/subscriptions/checkout', { method: 'POST', body: { planCode: 'standard', card: OK }, key: randomUUID() });
  const other = new SmartStorageClient({ apiKey: (await f.call(f.jwt(b), '/keys', { method: 'POST', body: {} })).body.data.secret, baseUrl: f.base });
  await assert.rejects(other.downloadImage(job.imageId), (error) => error instanceof SmartStorageError && error.status === 404);
  for (const route of ['/payments', '/subscriptions/me', '/keys', '/auth/me', '/admin/summary', '/admin/storage/stats']) {
    const denied = await f.call(secret, route);
    assert.equal(denied.status, 403, route);
    assert.equal(denied.body.error.code, 'API_KEY_NOT_ALLOWED', route);
  }
});

test('RNF-STO-03: una clave revocada, inválida o sin plan vigente deja de servir', options, async (t) => {
  const f = await setup(t);
  const [a] = f.users;
  await f.call(f.jwt(a), '/subscriptions/checkout', { method: 'POST', body: { planCode: 'standard', card: OK }, key: randomUUID() });
  const { key, secret } = (await f.call(f.jwt(a), '/keys', { method: 'POST', body: {} })).body.data;
  assert.equal((await f.call(secret, '/quotas/me')).status, 200);
  assert.ok((await f.database.query('SELECT last_used_at FROM api_keys WHERE id=$1', [key.id])).rows[0].last_used_at, 'registra el último uso');

  assert.equal((await f.call(`${secret.slice(0, -1)}x`, '/quotas/me')).body.error.code, 'API_KEY_INVALID');
  assert.equal((await f.call(f.jwt(a), '/subscriptions/change-plan', { method: 'POST', body: { planCode: 'free' }, key: randomUUID() })).status, 200);
  assert.equal((await f.call(secret, '/quotas/me')).body.error.code, 'PLAN_REQUIRED', 'al bajar a Free la clave se suspende');

  await f.call(f.jwt(a), '/subscriptions/checkout', { method: 'POST', body: { planCode: 'standard', card: OK }, key: randomUUID() });
  assert.equal((await f.call(secret, '/quotas/me')).status, 200, 'vuelve a servir al recuperar el plan');
  const revoked = await f.call(f.jwt(a), `/keys/${key.id}`, { method: 'DELETE' });
  assert.ok(revoked.body.data.revokedAt);
  assert.equal((await f.call(secret, '/quotas/me')).body.error.code, 'API_KEY_INVALID');
  assert.equal((await f.call(f.jwt(f.users[1]), `/keys/${key.id}`, { method: 'DELETE' })).status, 404, 'no se revoca la clave de otra cuenta');
  assert.throws(() => new SmartStorageClient({ apiKey: 'token' }), TypeError, 'el SDK rechaza un JWT u otro texto');
});
