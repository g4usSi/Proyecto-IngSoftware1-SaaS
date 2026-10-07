import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { fixture as workerFixture } from './helpers/worker-fixture.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';
import { createAlbumsService } from '../src/modules/storage/albums.service.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { createQuotasRepository } from '../src/modules/quotas/quotas.repository.js';
import { parseAlbumName, parseImageMove, parseLibraryQuery } from '../src/modules/storage/storage.validation.js';
import { createImageJobs } from '../src/workers/image-jobs.js';
import { createImageLifecycle, createManagedImageJobs } from '../src/workers/image-lifecycle.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 60000 };
const png = () => sharp({ create: { width: 32, height: 24, channels: 3, background: '#287fb1' } }).png().toBuffer();

async function fixture(t) {
  const f = await workerFixture(t);
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  f.storage = createStorageService(f);
  f.albums = createAlbumsService(f);
  f.jobs = createManagedImageJobs(f);
  f.quotas = createQuotasRepository(f.database);
  f.file = async (bytes) => {
    const filename = path.join(f.storageRoot, `${randomUUID()}.png`);
    await writeFile(filename, bytes);
    return { path: filename, size: bytes.length, originalname: 'prueba.png' };
  };
  f.upload = async (bytes, ownerId = f.users[0], folderId) => f.storage.uploadFile(ownerId, await f.file(bytes), folderId ? { folderId } : {});
  f.stage = async (bytes, folderId, jobId) => f.jobs.stage({ ownerId: f.users[0], file: await f.file(bytes), folderId, jobId });
  f.usage = () => f.quotas.getUsage(f.database, f.users[0]);
  return f;
}

async function http(t, f) {
  const secret = 'albums-trash-integration-secret-more-than-32-characters';
  const tokens = f.users.map((id) => createTokenService({ secret, expiresIn: '1h' }).issue(id).token);
  const server = createApp({ ...f, storageDemo: false, jwtSecret: secret, enqueueJob: async () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (route, { owner = 0, body, ...init } = {}) => {
    const headers = new Headers(init.headers);
    if (owner !== null) headers.set('Authorization', `Bearer ${tokens[owner]}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    return fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
      ...init, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };
}

async function data(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value.data;
}

async function error(response, status, code) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  assert.equal(value.error.code, code);
}

test('Álbumes y papelera: filtros y cuerpos rechazan entradas ambiguas', () => {
  assert.deepEqual(parseImageMove({ folderId: null }), { folderId: null });
  assert.equal(parseAlbumName({ name: '  Vacaciones  ' }), 'Vacaciones');
  for (const body of [{}, { name: '' }, { name: 'x', userId: randomUUID() }, { name: 'x\nY' }, { name: 'x'.repeat(121) }, null, []]) {
    assert.throws(() => parseAlbumName(body), { code: 'INVALID_ALBUM_NAME' });
  }
  for (const body of [{}, { folderId: '' }, { folderId: [] }, { folderId: null, userId: randomUUID() }, null]) {
    assert.throws(() => parseImageMove(body));
  }
  for (const query of [{ trash: '1' }, { trash: ['true', 'false'] }, { folderId: '' }, { folderId: ['none'] }, { ownerId: randomUUID() }]) {
    assert.throws(() => parseLibraryQuery(query));
  }
  const filter = parseLibraryQuery({ trash: 'true', folderId: 'none' });
  assert.equal(filter.trash, true);
  assert.equal(filter.folderId, null);
});

test('Álbumes: CRUD autenticado, nombres y aislamiento entre propietarios', options, async (t) => {
  const f = await fixture(t);
  const request = await http(t, f);
  await error(await request('/albums', { owner: null }), 401, 'AUTH_REQUIRED');
  const { album } = await data(await request('/albums', { method: 'POST', body: { name: ' Viaje ' } }), 201);
  assert.equal(album.name, 'Viaje');
  assert.equal(album.imageCount, '0');
  assert.deepEqual((await data(await request('/albums'))).items, [album]);
  assert.deepEqual((await data(await request('/albums', { owner: 1 }))).items, []);
  await error(await request('/albums', { method: 'POST', body: { name: 'Viaje' } }), 409, 'ALBUM_NAME_CONFLICT');
  await data(await request('/albums', { owner: 1, method: 'POST', body: { name: 'Viaje' } }), 201);
  await error(await request(`/albums/${album.id}`, { owner: 1, method: 'PATCH', body: { name: 'Ajeno' } }), 404, 'ALBUM_NOT_FOUND');
  await error(await request(`/albums/${album.id}`, { owner: 1, method: 'DELETE' }), 404, 'ALBUM_NOT_FOUND');
  const renamed = await data(await request(`/albums/${album.id}`, { method: 'PATCH', body: { name: 'Familia' } }));
  assert.equal(renamed.album.name, 'Familia');
  await error(await request('/albums', { method: 'POST', body: { name: 'Inválido', userId: f.users[1] } }), 400, 'INVALID_ALBUM_NAME');
  await data(await request(`/albums/${album.id}`, { method: 'DELETE' }));
  await error(await request(`/albums/${album.id}`, { method: 'DELETE' }), 404, 'ALBUM_NOT_FOUND');
});

test('Biblioteca: mueve imágenes y filtra álbum, sin álbum y papelera con paginación', options, async (t) => {
  const f = await fixture(t);
  const request = await http(t, f);
  const { album } = await f.albums.create(f.users[0], { name: 'Fotos' });
  const { album: foreign } = await f.albums.create(f.users[1], { name: 'Fotos' });
  const bytes = await png();
  const { image: first } = await f.upload(bytes);
  const { image: second } = await f.upload(bytes, f.users[0], album.id);
  const { image: third } = await f.upload(bytes, f.users[0], album.id);
  assert.equal(first.folderId, null);
  assert.equal(second.folderId, album.id);
  assert.equal(first.deletedAt, null);
  await error(await request(`/files/${first.id}`, { method: 'PATCH', body: { folderId: foreign.id } }), 404, 'FOLDER_NOT_FOUND');
  await error(await request(`/files/${first.id}`, { owner: 1, method: 'PATCH', body: { folderId: foreign.id } }), 404, 'FILE_NOT_FOUND');
  await data(await request(`/files/${first.id}`, { method: 'PATCH', body: { folderId: album.id } }));
  assert.equal((await f.albums.list(f.users[0])).items[0].imageCount, '3');
  const page = await data(await request(`/files?folderId=${album.id}&limit=2`));
  assert.equal(page.items.length, 2);
  assert.ok(page.nextCursor);
  const next = await data(await request(`/files?folderId=${album.id}&limit=2&cursor=${page.nextCursor}`));
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.items, ...next.items].map((image) => image.id)).size, 3);
  assert.deepEqual((await data(await request('/files?folderId=none'))).items, []);
  assert.deepEqual((await data(await request(`/files?folderId=${foreign.id}`))).items, []);
  await data(await request(`/files/${first.id}`, { method: 'PATCH', body: { folderId: null } }));
  const trashed = await data(await request(`/files/${second.id}/trash`, { method: 'POST' }));
  assert.ok(trashed.deletedAt);
  const repeat = await data(await request(`/files/${second.id}/trash`, { method: 'POST' }));
  assert.equal(repeat.deletedAt, trashed.deletedAt);
  assert.equal((await f.albums.list(f.users[0])).items[0].imageCount, '1');
  assert.deepEqual((await data(await request('/files?folderId=none'))).items.map((image) => image.id), [first.id]);
  assert.deepEqual((await data(await request(`/files?folderId=${album.id}`))).items.map((image) => image.id), [third.id]);
  const trash = await data(await request(`/files?trash=true&folderId=${album.id}`));
  assert.deepEqual(trash.items.map((image) => image.id), [second.id]);
  assert.equal(trash.items[0].deletedAt, trashed.deletedAt);
  await error(await request(`/files/${second.id}/download`), 404, 'FILE_NOT_FOUND');
  await error(await request(`/files/${second.id}`, { method: 'PATCH', body: { folderId: null } }), 409, 'FILE_IN_TRASH');
  await error(await request(`/files/${second.id}/restore`, { owner: 1, method: 'POST' }), 404, 'FILE_NOT_FOUND');
  await error(await request(`/files/${third.id}/trash`, { owner: 1, method: 'POST' }), 404, 'FILE_NOT_FOUND');
  await data(await request(`/files/${second.id}/restore`, { method: 'POST' }));
  await data(await request(`/files/${second.id}/restore`, { method: 'POST' }));
  assert.equal((await request(`/files/${second.id}/download`)).status, 200);
  assert.equal((await f.albums.list(f.users[0])).items[0].imageCount, '2');
  await error(await request('/files?trash=yes'), 400, 'INVALID_TRASH_FILTER');
  await error(await request('/files?folderId=none&folderId=none'), 400, 'INVALID_FOLDER_ID');
});

test('Papelera: conserva capacidad e historial; purga libera capacidad y conserva objetos compartidos', options, async (t) => {
  const f = await fixture(t);
  const bytes = await png();
  await f.database.query("UPDATE plans SET capacity_bytes=$1,daily_upload_limit=1 WHERE code='free'", [bytes.length]);
  const { image } = await f.upload(bytes);
  const { image: shared } = await f.upload(bytes, f.users[1]);
  const { rows: [object] } = await f.database.query('SELECT * FROM stored_objects');
  const filename = path.join(f.storageRoot, object.storage_key);
  await f.storage.trashFile(f.users[0], image.id);
  assert.equal((await f.usage()).used_bytes, String(bytes.length));
  await assert.rejects(f.upload(bytes), { code: 'CAPACITY_EXCEEDED' });
  await f.storage.restoreFile(f.users[0], image.id);
  assert.equal((await f.usage()).daily_count, '1');
  await f.storage.trashFile(f.users[0], image.id);
  await f.storage.deleteFile(f.users[0], image.id);
  assert.equal((await f.usage()).used_bytes, '0');
  assert.equal((await f.usage()).daily_count, '1');
  await assert.rejects(f.upload(bytes), { code: 'DAILY_UPLOAD_LIMIT_EXCEEDED' });
  await stat(filename);
  await assert.rejects(f.storage.restoreFile(f.users[0], image.id), { code: 'FILE_NOT_FOUND' });
  await f.storage.trashFile(f.users[1], shared.id);
  await f.storage.deleteFile(f.users[1], shared.id);
  await assert.rejects(stat(filename), { code: 'ENOENT' });
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM stored_objects')).rows[0].n, 0);
  assert.deepEqual((await f.database.query('SELECT upload_count FROM quota_daily_usage')).rows.map((row) => row.upload_count), [1, 1]);
});

test('Papelera: una referencia físicamente ausente puede restaurarse o purgarse sin ocultar la incidencia', options, async (t) => {
  const f = await fixture(t);
  const { image } = await f.upload(await png());
  const { rows: [object] } = await f.database.query('SELECT * FROM stored_objects');
  await unlink(path.join(f.storageRoot, object.storage_key));
  await f.storage.trashFile(f.users[0], image.id);
  const trash = await f.storage.listFiles(f.users[0], { trash: 'true' });
  assert.deepEqual(trash.items, []);
  assert.equal(trash.unavailableItems[0].id, image.id);
  assert.ok(trash.unavailableItems[0].deletedAt);
  await f.storage.restoreFile(f.users[0], image.id);
  const active = await f.storage.listFiles(f.users[0], {});
  assert.equal(active.unavailableItems[0].deletedAt, null);
  await f.storage.deleteFile(f.users[0], image.id);
  assert.equal((await f.usage()).used_bytes, '0');
});

test('Álbum eliminado: conserva imágenes activas, papelera y admisión idempotente de trabajos', options, async (t) => {
  const f = await fixture(t);
  const bytes = await png();
  const { album } = await f.albums.create(f.users[0], { name: 'Temporal' });
  const { image: active } = await f.upload(bytes, f.users[0], album.id);
  const { image: trash } = await f.upload(bytes, f.users[0], album.id);
  await f.storage.trashFile(f.users[0], trash.id);
  const jobId = randomUUID();
  await f.stage(bytes, album.id, jobId);
  await f.albums.remove(f.users[0], album.id);
  assert.equal((await f.stage(bytes, album.id, jobId)).id, jobId);
  await assert.rejects(f.stage(bytes, null, jobId), { code: 'IDEMPOTENCY_CONFLICT' });
  const { rows: [job] } = await f.database.query('SELECT folder_id,admitted_folder_id FROM image_processing_jobs WHERE id=$1', [jobId]);
  assert.equal(job.folder_id, null);
  assert.equal(job.admitted_folder_id, album.id);
  await f.jobs.process(jobId);
  const state = await f.jobs.get(f.users[0], jobId);
  assert.equal(state.available, true);
  assert.equal(state.status, 'published');
  const images = (await f.database.query('SELECT id,folder_id,deleted_at FROM images ORDER BY id')).rows;
  assert.equal(images.length, 3);
  assert.ok(images.every((image) => image.folder_id === null));
  assert.ok(images.find((image) => image.id === trash.id).deleted_at);
  assert.equal(images.find((image) => image.id === active.id).deleted_at, null);
  await f.storage.trashFile(f.users[0], state.imageId);
  assert.equal((await f.jobs.get(f.users[0], jobId)).available, false);
  assert.equal((await f.jobs.get(f.users[0], jobId)).downloadUrl, null);
  assert.equal((await f.jobs.list(f.users[0])).items[0].available, false);
  await f.storage.restoreFile(f.users[0], state.imageId);
  assert.equal((await f.jobs.get(f.users[0], jobId)).available, true);
});

test('Álbumes: publicación relee el destino si se borró después de cargar el trabajo', options, async (t) => {
  const f = await fixture(t);
  const { album } = await f.albums.create(f.users[0], { name: 'Carrera' });
  const { id } = await f.stage(await png(), album.id);
  const lifecycle = createImageLifecycle(f);
  const reached = Promise.withResolvers();
  const continuePublication = Promise.withResolvers();
  const jobs = createImageJobs({ ...f, lifecycle: { ...lifecycle, async confirm(client, payload) {
    assert.equal(payload.folderId, album.id, 'El worker leyó la carpeta antes del borrado.');
    reached.resolve();
    await continuePublication.promise;
    return lifecycle.confirm(client, payload);
  } } });
  const processing = jobs.process(id);
  processing.catch((failure) => reached.reject(failure));
  await reached.promise;
  try { await f.albums.remove(f.users[0], album.id); }
  finally { continuePublication.resolve(); }
  await processing;
  const state = await jobs.get(f.users[0], id);
  assert.equal(state.available, true);
  assert.equal((await f.database.query('SELECT folder_id FROM images WHERE id=$1', [state.imageId])).rows[0].folder_id, null);
  assert.equal((await f.usage()).daily_count, '1');
});

test('Álbumes: mover y borrar simultáneamente no deja referencias huérfanas', options, async (t) => {
  const f = await fixture(t);
  const { album } = await f.albums.create(f.users[0], { name: 'Concurrente' });
  const { image } = await f.upload(await png());
  const outcomes = await Promise.allSettled([
    f.storage.moveFile(f.users[0], image.id, { folderId: album.id }),
    f.albums.remove(f.users[0], album.id),
  ]);
  assert.equal(outcomes[1].status, 'fulfilled');
  if (outcomes[0].status === 'rejected') assert.equal(outcomes[0].reason.code, 'FOLDER_NOT_FOUND');
  assert.equal((await f.database.query('SELECT folder_id FROM images WHERE id=$1', [image.id])).rows[0].folder_id, null);
  assert.equal((await f.storage.listFiles(f.users[0], { folderId: 'none' })).items[0].id, image.id);
});

test('Álbumes: rollback de eliminación conserva imágenes, papelera y destino del trabajo', options, async (t) => {
  const f = await fixture(t);
  const { album } = await f.albums.create(f.users[0], { name: 'Protegido' });
  const bytes = await png();
  const { image } = await f.upload(bytes, f.users[0], album.id);
  await f.storage.trashFile(f.users[0], image.id);
  const job = await f.stage(bytes, album.id);
  await f.database.query(`CREATE FUNCTION reject_album_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected album rollback'; END $$;
    CREATE TRIGGER reject_album_delete BEFORE DELETE ON folders FOR EACH ROW EXECUTE FUNCTION reject_album_delete()`);
  await assert.rejects(f.albums.remove(f.users[0], album.id), /injected album rollback/);
  const row = (await f.database.query('SELECT folder_id,deleted_at FROM images WHERE id=$1', [image.id])).rows[0];
  assert.equal(row.folder_id, album.id);
  assert.ok(row.deleted_at);
  assert.equal((await f.database.query('SELECT folder_id FROM image_processing_jobs WHERE id=$1', [job.id])).rows[0].folder_id, album.id);
  assert.equal((await f.albums.list(f.users[0])).items.length, 1);
});
