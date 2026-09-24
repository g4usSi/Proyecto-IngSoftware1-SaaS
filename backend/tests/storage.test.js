import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, mkdtemp, readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import test from 'node:test';
import pg from 'pg';
import { createApp } from '../src/app.js';

// Deliberately never falls back to DATABASE_URL or the developer's database.
// Every case creates a disposable schema inside the explicitly selected test DB.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const integrationOptions = {
  skip: !testDatabaseUrl && 'Configura TEST_DATABASE_URL para ejecutar Storage con PostgreSQL real.',
  timeout: 120000,
};

async function fixture(t) {
  assert.ok(testDatabaseUrl, 'Las pruebas requieren TEST_DATABASE_URL explícita.');
  const schema = `smartstorage_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^smartstorage_test_[a-f0-9]{32}$/);
  const adminConnection = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  let database;
  let storageRoot;
  let server;
  let baseUrl;

  // Register cleanup before setup, so failed migrations do not leak a schema.
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await database?.end();
    try {
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await adminConnection.end();
      if (storageRoot) {
        // Delete only this exact directory created by mkdtemp, never a supplied path.
        assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
        assert.match(path.basename(storageRoot), /^smartstorage-test-[\w-]+$/);
        await rm(storageRoot, { recursive: true, force: true });
      }
    }
  });

  await adminConnection.query(`CREATE SCHEMA "${schema}"`);
  database = new pg.Pool({
    connectionString: testDatabaseUrl,
    options: `-c search_path=${schema},public`,
    max: 8,
  });
  const migrationNames = (await readdir(migrationsDirectory)).filter((name) => /^\d+[-_].*\.sql$/.test(name)).sort();
  for (const name of migrationNames) {
    await database.query(await readFile(path.join(migrationsDirectory, name), 'utf8'));
  }
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-test-'));
  const users = {};
  for (const name of ['alice', 'bob', 'admin']) {
    const { rows: [user] } = await database.query(`
      INSERT INTO users(name, email, password_hash, role)
      VALUES ($1, $2, 'test-only-not-a-password', $3) RETURNING id, email, role
    `, [name, `${name}@storage.test`, name === 'admin' ? 'admin' : 'client']);
    users[name] = user;
    await database.query(`
      INSERT INTO subscriptions(user_id, plan_id)
      SELECT $1, id FROM plans WHERE code = 'free'
    `, [user.id]);
  }

  // This identity source exists only inside the test process. Production's
  // requireAuth is unchanged and must continue to reject unverified identities.
  function storageAuthenticate(req, res, next) {
    const user = users[req.get('x-test-user')];
    if (!user) return res.status(401).json({ error: { code: 'TEST_AUTH_REQUIRED', message: 'Sesión de prueba requerida.' } });
    req.user = user;
    return next();
  }

  async function start() {
    server = createApp({ database, storageRoot, storageAuthenticate, storageDemo: false }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }
  await start();

  function request(route, { user = 'alice', headers, ...options } = {}) {
    const requestHeaders = new Headers(headers);
    if (user !== null) requestHeaders.set('x-test-user', user);
    return fetch(`${baseUrl}${route}`, { ...options, headers: requestHeaders });
  }

  return {
    database, storageRoot, users, request,
    async restart() {
      await new Promise((resolve) => server.close(resolve));
      await start();
    },
    upload(bytes, { user = 'alice', name = 'imagen.png', type = 'image/png', folderId } = {}) {
      const body = new FormData();
      body.set('file', new Blob([bytes], { type }), name);
      if (folderId !== undefined) body.set('folderId', folderId);
      return request('/api/files', { method: 'POST', body, user });
    },
    async limits({ capacity = '2000000000', count = null, bytes = null } = {}) {
      await database.query(`
        UPDATE plans SET capacity_bytes = $1, daily_upload_limit = $2, daily_bytes_limit = $3
        WHERE code = 'free'
      `, [String(capacity), count, bytes === null ? null : String(bytes)]);
    },
  };
}

async function json(response, expectedStatus = 200) {
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(payload));
  return payload;
}

async function expectError(response, status, code) {
  const payload = await json(response, status);
  assert.equal(payload.error?.code, code);
  assert.equal(typeof payload.error?.message, 'string');
  assert.equal('data' in payload, false);
}

async function png(color = { r: 50, g: 120, b: 180 }) {
  const { default: sharp } = await import('sharp');
  return sharp({ create: { width: 48, height: 32, channels: 3, background: color } }).png().toBuffer();
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const content = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([length, content, checksum]);
}

async function animatedPng() {
  const { default: sharp } = await import('sharp');
  const frames = [];
  for (const background of ['#ff0000', '#0000ff']) {
    const encoded = await sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer();
    const idat = [];
    let ihdr;
    for (let offset = 8; offset < encoded.length;) {
      const length = encoded.readUInt32BE(offset);
      const type = encoded.toString('ascii', offset + 4, offset + 8);
      const data = encoded.subarray(offset + 8, offset + 8 + length);
      if (type === 'IHDR') ihdr = data;
      if (type === 'IDAT') idat.push(data);
      offset += length + 12;
    }
    assert.equal(ihdr[9], 2, 'Los fotogramas de esta fixture deben ser RGB.');
    frames.push({ ihdr, idat: Buffer.concat(idat) });
  }

  function frameControl(sequence) {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence, 0);
    control.writeUInt32BE(2, 4);
    control.writeUInt32BE(2, 8);
    control.writeUInt16BE(1, 20);
    control.writeUInt16BE(10, 22);
    return control; // offsets cero, 100 ms, sin descarte y mezcla SOURCE.
  }
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(2); // Dos fotogramas; repeticiones infinitas.
  const frameDataSequence = Buffer.alloc(4);
  frameDataSequence.writeUInt32BE(2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', frames[0].ihdr),
    pngChunk('acTL', animationControl),
    pngChunk('fcTL', frameControl(0)),
    pngChunk('IDAT', frames[0].idat),
    pngChunk('fcTL', frameControl(1)),
    pngChunk('fdAT', Buffer.concat([frameDataSequence, frames[1].idat])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function filesIn(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(location));
    else files.push(location);
  }
  return files;
}

async function assertClean(f, expectedObjects, expectedImages) {
  const { rows: [counts] } = await f.database.query(`
    SELECT (SELECT count(*) FROM stored_objects)::text AS objects,
           (SELECT count(*) FROM images)::text AS images
  `);
  assert.equal(counts.objects, String(expectedObjects));
  assert.equal(counts.images, String(expectedImages));
  const files = await filesIn(f.storageRoot);
  assert.equal(files.length, expectedObjects, 'Solo deben quedar los WebP referenciados, sin originales ni temporales.');
  for (const location of files) assert.match(path.relative(f.storageRoot, location).replaceAll('\\', '/'), /^[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
  assert.deepEqual(await filesIn(path.join(f.storageRoot, '.tmp')), []);
}

function assertImage(image, originalBytes, name) {
  assert.match(image.id, /^[a-f0-9-]{36}$/i);
  assert.equal(image.originalName, name);
  assert.equal(image.status, 'ready');
  assert.equal(image.originalSizeBytes, String(originalBytes));
  assert.match(image.optimizedSizeBytes, /^\d+$/);
  assert.ok(Number(image.optimizedSizeBytes) > 0);
  assert.ok(Number.isFinite(Date.parse(image.createdAt)));
  for (const field of ['hash', 'hashSha256', 'objectHash', 'storageKey', 'storage_key', 'path', 'userId']) {
    assert.equal(field in image, false, `La respuesta pública no debe exponer ${field}.`);
  }
}

test('Storage: WebP real, orientación y privacidad; persiste al reiniciar la aplicación', integrationOptions, async (t) => {
  const f = await fixture(t);
  const { default: sharp } = await import('sharp');
  const original = await sharp({ create: { width: 31, height: 19, channels: 3, background: '#4587ad' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const originalName = 'retrato de José — 2026.jpg';
  const { data: { image } } = await json(await f.upload(original, { name: originalName, type: 'image/jpeg' }), 201);
  assertImage(image, original.length, originalName);
  const hash = createHash('sha256').update(original).digest('hex');
  const location = path.join(f.storageRoot, hash.slice(0, 2), `${hash}.webp`);
  const stored = await readFile(location);
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 19);
  assert.equal(metadata.height, 31);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(image.optimizedSizeBytes, String(stored.length));

  const download = await f.request(`/api/files/${image.id}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /^image\/webp/);
  assert.match(download.headers.get('content-disposition'), /attachment/i);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), stored);
  await expectError(await f.request(`/api/files/${image.id}/download`, { user: 'bob' }), 404, 'FILE_NOT_FOUND');
  await expectError(await f.request(`/api/files/${hash}/download`), 404, 'FILE_NOT_FOUND');
  assert.equal((await f.request(`/${hash.slice(0, 2)}/${hash}.webp`)).status, 404);
  assert.equal((await f.request('/api/files', { user: null })).status, 401);
  await f.restart();
  const { data: listing } = await json(await f.request('/api/files'));
  assert.deepEqual(listing.items.map((item) => item.id), [image.id]);
  assert.equal(listing.items[0].originalName, originalName);
  assert.equal(listing.nextCursor, null);
  assert.deepEqual(Buffer.from(await (await f.request(`/api/files/${image.id}/download`)).arrayBuffer()), stored);
  assert.equal((await f.request(`/api/files/${image.id}`, { method: 'DELETE' })).status, 501);
  await assertClean(f, 1, 1);
});

test('Storage: subidas idénticas concurrentes entre cuentas comparten un solo objeto físico', integrationOptions, async (t) => {
  const f = await fixture(t);
  const original = await png();
  const replies = await Promise.all([
    f.upload(original, { user: 'alice', name: 'alice.png' }),
    f.upload(original, { user: 'bob', name: 'bob.png' }),
  ]);
  const images = await Promise.all(replies.map(async (response) => (await json(response, 201)).data.image));
  assert.notEqual(images[0].id, images[1].id);
  const hash = createHash('sha256').update(original).digest('hex');
  const { rows } = await f.database.query('SELECT hash_sha256, original_size_bytes FROM stored_objects');
  assert.deepEqual(rows, [{ hash_sha256: hash, original_size_bytes: String(original.length) }]);
  for (const [index, user] of ['alice', 'bob'].entries()) {
    const { data } = await json(await f.request('/api/files', { user }));
    assert.deepEqual(data.items.map((item) => item.id), [images[index].id]);
    await expectError(await f.request(`/api/files/${images[1 - index].id}/download`, { user }), 404, 'FILE_NOT_FOUND');
  }
  await assertClean(f, 1, 2);
  // Visually identical input in another encoding has different original bytes.
  // It must not be deduplicated by hashing the optimized result.
  const { default: sharp } = await import('sharp');
  const webpOriginal = await sharp(original).webp().toBuffer();
  const { data: { image: webpImage } } = await json(await f.upload(webpOriginal, { name: 'otra-codificacion.webp', type: 'image/webp' }), 201);
  assertImage(webpImage, webpOriginal.length, 'otra-codificacion.webp');
  await assertClean(f, 2, 3);
});

test('Storage: el límite diario resiste subidas concurrentes de contenido distinto y cambia de día', integrationOptions, async (t) => {
  const f = await fixture(t);
  await f.limits({ count: 1 });
  // Different hashes ensure the quota cannot accidentally be protected only by
  // serialization of two uploads of the same physical object.
  const originals = await Promise.all([png(), png({ r: 190, g: 60, b: 40 })]);
  const responses = await Promise.all(originals.map((original) => f.upload(original)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
  const acceptedOriginal = originals[responses.findIndex((response) => response.status === 201)];
  for (const response of responses) {
    if (response.status === 429) await expectError(response, 429, 'DAILY_UPLOAD_LIMIT_EXCEEDED');
    else await json(response, 201);
  }
  await assertClean(f, 1, 1);
  await f.database.query("UPDATE images SET created_at = now() - INTERVAL '2 days'");
  await json(await f.upload(acceptedOriginal), 201);
  await assertClean(f, 1, 2);
});

for (const quota of [
  { name: 'capacidad', property: 'capacity', status: 403, code: 'CAPACITY_EXCEEDED' },
  { name: 'bytes diarios', property: 'bytes', status: 429, code: 'DAILY_BYTES_LIMIT_EXCEEDED' },
]) {
  test(`Storage: cuota de ${quota.name} acepta el límite exacto y rechaza otra referencia`, integrationOptions, async (t) => {
    const f = await fixture(t);
    const original = await png();
    await f.limits({ [quota.property]: original.length });
    await json(await f.upload(original), 201);
    await expectError(await f.upload(original), quota.status, quota.code);
    await assertClean(f, 1, 1);
  });
}

test('Storage: una cuenta sin suscripción y una carpeta ajena no dejan archivos ni referencias', integrationOptions, async (t) => {
  const f = await fixture(t);
  const original = await png();
  const { rows: [folder] } = await f.database.query(
    "INSERT INTO folders(user_id, name) VALUES ($1, 'Privada') RETURNING id", [f.users.bob.id],
  );
  await expectError(await f.upload(original, { folderId: folder.id }), 404, 'FOLDER_NOT_FOUND');
  await assertClean(f, 0, 0);
  await f.database.query("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1", [f.users.alice.id]);
  await expectError(await f.upload(original), 403, 'NO_ACTIVE_SUBSCRIPTION');
  await assertClean(f, 0, 0);
});

test('Storage: archivos vacíos, falsos, truncados y animados se rechazan y limpian', integrationOptions, async (t) => {
  const f = await fixture(t);
  const { default: sharp } = await import('sharp');
  const jpeg = await sharp(await png()).jpeg().toBuffer();
  // GIF de dos fotogramas distintos usado únicamente para crear un WebP animado real.
  const gif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
  const animated = await sharp(gif, { animated: true }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  const apng = await animatedPng();
  // libvips puede leer solo el primer fotograma y no informar metadata.pages.
  // La fixture contiene dos fotogramas reales y CRC válidos, no una firma falsa.
  assert.equal((await sharp(apng).metadata()).format, 'png');
  await sharp(apng).raw().toBuffer();
  const cases = [
    { bytes: Buffer.alloc(0), status: 400, code: 'EMPTY_FILE' },
    { bytes: Buffer.from('not an image'), status: 415, code: 'UNSUPPORTED_IMAGE' },
    { bytes: jpeg.subarray(0, 40), name: 'rota.jpg', type: 'image/jpeg', status: 400, code: 'INVALID_IMAGE' },
    { bytes: animated, name: 'animada.webp', type: 'image/webp', status: 415, code: 'ANIMATED_IMAGE_NOT_SUPPORTED' },
    { bytes: apng, name: 'animada.png', type: 'image/png', status: 415, code: 'ANIMATED_IMAGE_NOT_SUPPORTED' },
  ];
  for (const item of cases) {
    await expectError(await f.upload(item.bytes, item), item.status, item.code);
    await assertClean(f, 0, 0);
  }
  await expectError(await f.request('/api/files', { method: 'POST', body: new FormData() }), 400, 'UPLOAD_REQUIRED');
  await assertClean(f, 0, 0);
});

test('Storage: acepta exactamente 25 MB originales y rechaza un byte adicional', integrationOptions, async (t) => {
  const f = await fixture(t);
  // PNG válido con relleno tras IEND: se decodifica normalmente, pero todos los
  // bytes recibidos cuentan para el límite y el hash del original.
  const original = Buffer.alloc(25_000_000);
  (await png()).copy(original);
  const { data: { image } } = await json(await f.upload(original), 201);
  assertImage(image, 25_000_000, 'imagen.png');
  await assertClean(f, 1, 1);
  await expectError(await f.upload(Buffer.concat([original, Buffer.alloc(1)])), 413, 'FILE_TOO_LARGE');
  await assertClean(f, 1, 1);
});

test('Storage: rollback de PostgreSQL limpia objetos nuevos y conserva objetos compartidos', integrationOptions, async (t) => {
  const f = await fixture(t);
  const original = await png();
  await f.database.query(`
    CREATE FUNCTION reject_test_image() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Intentional integration test failure'; END; $$;
    CREATE TRIGGER reject_test_image BEFORE INSERT ON images
    FOR EACH ROW EXECUTE FUNCTION reject_test_image();
  `);
  await expectError(await f.upload(original), 500, 'INTERNAL_ERROR');
  await assertClean(f, 0, 0);
  await f.database.query('ALTER TABLE images DISABLE TRIGGER reject_test_image');
  const { data: { image } } = await json(await f.upload(original), 201);
  await f.database.query('ALTER TABLE images ENABLE TRIGGER reject_test_image');
  await expectError(await f.upload(original, { user: 'bob' }), 500, 'INTERNAL_ERROR');
  await assertClean(f, 1, 1);
  assert.equal((await f.request(`/api/files/${image.id}/download`)).status, 200);
});

test('Storage: estadísticas administrativas derivan el tamaño físico y no ocultan ahorro negativo', integrationOptions, async (t) => {
  const f = await fixture(t);
  const { data: empty } = await json(await f.request('/api/admin/storage/stats', { user: 'admin' }));
  assert.deepEqual(empty, {
    originalSizeBytes: '0', uniqueOriginalSizeBytes: '0', optimizedSizeBytes: '0',
    savedBytes: '0', savedPercent: '0.00', imageCount: '0', objectCount: '0',
  });
  const original = await png();
  await json(await f.upload(original), 201);
  await json(await f.upload(original, { user: 'bob' }), 201);
  assert.equal((await f.request('/api/admin/storage/stats')).status, 403);
  assert.equal((await f.request('/api/admin/storage/stats', { user: null })).status, 401);
  const [location] = await filesIn(f.storageRoot);
  const physicalSize = (await stat(location)).size;
  const { data: stats } = await json(await f.request('/api/admin/storage/stats', { user: 'admin' }));
  assert.equal(stats.originalSizeBytes, String(original.length * 2));
  assert.equal(stats.uniqueOriginalSizeBytes, String(original.length));
  assert.equal(stats.optimizedSizeBytes, String(physicalSize));
  assert.equal(stats.savedBytes, String(original.length * 2 - physicalSize));
  assert.equal(stats.imageCount, '2');
  assert.equal(stats.objectCount, '1');
  assert.equal(typeof stats.savedPercent, 'string');
  assert.ok(Math.abs(Number(stats.savedPercent) - 100 * (original.length * 2 - physicalSize) / (original.length * 2)) <= 0.011);

  // A changed file size must be reflected by stat rather than a cached DB metric.
  const extraBytes = original.length * 3;
  await appendFile(location, Buffer.alloc(extraBytes));
  const { data: changed } = await json(await f.request('/api/admin/storage/stats', { user: 'admin' }));
  assert.equal(changed.optimizedSizeBytes, String(physicalSize + extraBytes));
  assert.equal(changed.savedBytes, String(original.length * 2 - physicalSize - extraBytes));
  assert.ok(Number(changed.savedPercent) < 0);
  await unlink(location);
  await expectError(await f.request('/api/admin/storage/stats', { user: 'admin' }), 503, 'STORAGE_INTEGRITY_ERROR');
});

test('Storage: paginación estable conserva empates de microsegundos y aísla al propietario', integrationOptions, async (t) => {
  const f = await fixture(t);
  const original = await png();
  const images = [];
  for (let index = 0; index < 5; index += 1) {
    const { data: { image } } = await json(await f.upload(original, { name: `foto-${index}.png` }), 201);
    images.push(image);
  }
  await json(await f.upload(original, { user: 'bob' }), 201);
  await f.database.query("UPDATE images SET created_at = TIMESTAMPTZ '2026-01-01 12:00:00.123456+00'");
  let page = (await json(await f.request('/api/files?limit=2'))).data;
  assert.equal(page.items.length, 2);
  assert.equal(typeof page.nextCursor, 'string');
  const seen = page.items.map((item) => item.id);
  // A more recent insert must not shift the remaining pages like OFFSET would.
  const { data: { image: newImage } } = await json(await f.upload(original, { name: 'nueva.png' }), 201);
  let pages = 1;
  while (page.nextCursor !== null) {
    assert.ok(pages < 5, 'La paginación debe terminar.');
    page = (await json(await f.request(`/api/files?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`))).data;
    assert.ok(page.items.length <= 2);
    seen.push(...page.items.map((item) => item.id));
    pages += 1;
  }
  assert.equal(new Set(seen).size, 5);
  assert.deepEqual([...seen].sort(), images.map((image) => image.id).sort());
  assert.equal(seen.includes(newImage.id), false);
  await expectError(await f.request('/api/files?cursor=not-a-valid-cursor'), 400, 'INVALID_CURSOR');
  await expectError(await f.request('/api/files?limit=0'), 400, 'INVALID_LIMIT');
  await assertClean(f, 1, 7);
});
