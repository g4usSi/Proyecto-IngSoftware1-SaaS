// RF-STO-10/11/12/14 y RF-PAG-04: detalle de imagen, resumen de ahorro del cliente y cola global del administrador.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { fixture as workerFixture } from './helpers/worker-fixture.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { storageKeyFor } from '../src/modules/storage/storage.files.js';
import { createManagedImageJobs } from '../src/workers/image-lifecycle.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 90000 };
const SECRET = 'storage-extra-test-secret-longer-than-thirty-two-characters';
const png = (i) => sharp({ create: { width: 60, height: 40, channels: 3, background: { r: (i * 53) % 256, g: (i * 97 + 30) % 256, b: (i * 29 + 90) % 256 } } }).png().toBuffer();

async function setup(t) {
  const f = await workerFixture(t);
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  f.jobs = createManagedImageJobs(f);
  f.storage = createStorageService(f);
  const file = async (buffer) => {
    const filename = path.join(f.storageRoot, `${randomUUID()}.png`);
    await writeFile(filename, buffer);
    return { path: filename, size: buffer.length, originalname: 'prueba.png' };
  };
  f.upload = async (buffer, owner) => f.storage.uploadFile(owner, await file(buffer), {});
  f.stage = async (buffer, owner) => f.jobs.stage({ ownerId: owner, file: await file(buffer), folderId: null });
  const tokens = createTokenService({ secret: SECRET, expiresIn: '1h' });
  f.headers = (id) => ({ Authorization: `Bearer ${tokens.issue(id).token}` });
  return f;
}

async function withApi(f, run) {
  const server = createApp({ ...f, storageDemo: false, jwtSecret: SECRET, enqueueJob: async () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (route, headers) => {
    const response = await fetch(`${base}${route}`, { headers });
    return { status: response.status, body: await response.json() };
  };
  try { await run(get); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('RF-STO-10/11/12: detalle con huella corta y duplicados; resumen de ahorro contra el disco', options, async (t) => {
  const f = await setup(t);
  const [a, b] = f.users;
  const [one, two] = [await png(1), await png(2)];
  const first = (await f.upload(one, a)).image;
  const copy = (await f.upload(one, a)).image; // mismo contenido en la misma cuenta
  const other = (await f.upload(two, a)).image;
  await f.upload(one, b); // otra cuenta con el mismo archivo no altera los números de A
  await f.storage.trashFile(a, other.id);

  await withApi(f, async (get) => {
    const list = await get('/files', f.headers(a));
    assert.equal(list.status, 200);
    const byId = Object.fromEntries(list.body.data.items.map((i) => [i.id, i]));
    const hash = (await f.database.query('SELECT object_hash FROM images WHERE id=$1', [first.id])).rows[0].object_hash;
    for (const id of [first.id, copy.id]) {
      assert.equal(byId[id].duplicate, true);
      assert.equal(byId[id].hashPrefix, hash.slice(0, 12));
      assert.equal(byId[id].optimizedFormat, 'webp');
      assert.ok(!('hashSha256' in byId[id]) && !JSON.stringify(byId[id]).includes(hash), 'nunca el hash completo');
    }

    // Disco real: el físico es un WebP por objeto distinto, una sola vez aunque haya copias.
    const sizeOf = async (h) => (await stat(path.join(f.storageRoot, storageKeyFor(h)))).size;
    const hashTwo = (await f.database.query('SELECT object_hash FROM images WHERE id=$1', [other.id])).rows[0].object_hash;
    const physical = (await sizeOf(hash)) + (await sizeOf(hashTwo));
    const logical = 2 * one.length + two.length;

    const summary = await get('/files/summary', f.headers(a));
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.data, {
      logicalBytes: String(logical),
      physicalBytes: String(physical),
      savedBytes: String(logical - physical),
      savedPercent: summary.body.data.savedPercent,
      imageCount: '2',
      trashCount: '1',
      uniqueObjectCount: '2',
      duplicateCount: '1',
      unavailableObjectCount: '0',
    });
    assert.match(summary.body.data.savedPercent, /^-?\d+\.\d{2}$/);

    const mine = await get('/files/summary', f.headers(b));
    assert.equal(mine.body.data.imageCount, '1');
    assert.equal(mine.body.data.duplicateCount, '0', 'las copias de otra cuenta no cuentan como duplicados propios');
    assert.equal((await get('/files/summary')).status, 401);
  });
});

test('RF-STO-12: resumen vacío y objeto ausente en disco no inventan cifras', options, async (t) => {
  const f = await setup(t);
  const [a] = f.users;
  await withApi(f, async (get) => {
    const empty = await get('/files/summary', f.headers(a));
    assert.equal(empty.body.data.logicalBytes, '0');
    assert.equal(empty.body.data.savedPercent, '0.00');
    const { image } = await f.upload(await png(3), a);
    const hash = (await f.database.query('SELECT object_hash FROM images WHERE id=$1', [image.id])).rows[0].object_hash;
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(f.storageRoot, storageKeyFor(hash)));
    const broken = await get('/files/summary', f.headers(a));
    assert.equal(broken.status, 200);
    assert.equal(broken.body.data.unavailableObjectCount, '1');
    assert.equal(broken.body.data.savedPercent, null, 'sin archivo físico no se calcula un ahorro');
  });
});

test('RF-STO-14: el administrador consulta la cola global; el cliente no', options, async (t) => {
  const f = await setup(t);
  const [admin, client] = f.users;
  await f.database.query("UPDATE users SET role='admin' WHERE id=$1", [admin]);
  const same = await png(5);
  const done = await f.stage(same, admin);
  await f.jobs.process(done.id);
  const waiting = await f.stage(same, client); // mismo contenido que una imagen ya publicada
  const other = await f.stage(await png(6), client);
  await f.database.query("UPDATE image_processing_jobs SET status='failed', error_code='JOB_INPUT_CHANGED' WHERE id=$1", [other.id]);

  await withApi(f, async (get) => {
    assert.equal((await get('/admin/jobs')).status, 401);
    assert.equal((await get('/admin/jobs', f.headers(client))).status, 403);

    const all = await get('/admin/jobs', f.headers(admin));
    assert.equal(all.status, 200);
    assert.equal(all.body.data.total, '3');
    const byId = Object.fromEntries(all.body.data.items.map((j) => [j.id, j]));
    assert.equal(byId[done.id].status, 'published');
    assert.equal(byId[waiting.id].status, 'queued');
    assert.equal(byId[waiting.id].sharedObject, true, 'ya existe una imagen con el mismo contenido');
    assert.equal(byId[other.id].status, 'failed');
    assert.equal(byId[other.id].errorCode, 'JOB_INPUT_CHANGED');
    assert.equal(byId[waiting.id].user.id, client);
    const dump = JSON.stringify(all.body);
    assert.ok(!/original_hash|hash|storage_key|\/tmp\//i.test(dump), 'sin hashes ni rutas');

    assert.equal((await get('/admin/jobs?status=failed', f.headers(admin))).body.data.items.length, 1);
    assert.equal((await get(`/admin/jobs?userId=${client}&limit=1&offset=1`, f.headers(admin))).body.data.items.length, 1);
    for (const bad of ['status=otro', 'userId=1', 'limit=0', 'limit=101', 'x=1']) {
      const response = await get(`/admin/jobs?${bad}`, f.headers(admin));
      assert.equal(response.status, 400, bad);
      assert.equal(response.body.error.code, 'INVALID_ADMIN_QUERY');
    }
  });
});
