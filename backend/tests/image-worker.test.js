import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import pg from 'pg';
import { QueueEvents } from 'bullmq';
import { createImageJobs, jobPaths } from '../src/workers/image-jobs.js';
import { createImageQueue, createImageWorker, enqueueImageJob, readWorkerConfig } from '../src/workers/image-queue.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL de pruebas.', timeout: 60000 };

async function fixture(t) {
  const schema = `worker_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  let database;
  let storageRoot;
  t.after(async () => {
    await database?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    if (storageRoot) {
      assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
      assert.match(path.basename(storageRoot), /^smartstorage-worker-[\w-]+$/);
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  database = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 6 });
  const migrationDir = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(migrationDir)).filter((f) => /^\d+[-_].*\.sql$/.test(f)).sort()) {
    await database.query(await readFile(new URL(file, migrationDir), 'utf8'));
  }
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-worker-'));
  const users = [];
  for (const name of ['A', 'B']) {
    users.push((await database.query("INSERT INTO users (name, email, password_hash) VALUES ($1, $2, '!test') RETURNING id", [name, `${name.toLowerCase()}@worker.test`])).rows[0].id);
  }
  const jobs = createImageJobs({ database, storageRoot });
  async function stage(buffer, ownerId = users[0]) {
    const file = path.join(storageRoot, `${randomUUID()}.png`);
    await writeFile(file, buffer);
    return jobs.stage({ ownerId, file: { path: file, originalname: 'prueba.png' } });
  }
  return { database, storageRoot, users, jobs, stage };
}

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#2678a1' } }).png().toBuffer();

test('Worker: configuración Redis y rutas rechazan valores inseguros', () => {
  assert.equal(readWorkerConfig({}).concurrency, 2);
  assert.deepEqual(readWorkerConfig({ REDIS_URL: 'rediss://user:pass@localhost:6380/2', IMAGE_WORKER_CONCURRENCY: '3' }),
    { connection: { host: 'localhost', port: 6380, db: 2, username: 'user', password: 'pass', tls: {} }, concurrency: 3 });
  for (const value of ['http://localhost', 'redis://localhost/not-a-db', 'redis://localhost:0', 'redis://localhost/0?token=secret']) {
    assert.throws(() => readWorkerConfig({ REDIS_URL: value }));
  }
  for (const value of ['0', '9', '1.5', 'NaN']) assert.throws(() => readWorkerConfig({ IMAGE_WORKER_CONCURRENCY: value }));
  assert.throws(() => jobPaths('/private', '../../escape'), { code: 'INVALID_JOB_ID' });
});

test('Worker: conversión real persistente, repetición idempotente y estado privado', options, async (t) => {
  const f = await fixture(t);
  const job = await f.stage(await png());
  assert.equal((await f.jobs.get(f.users[0], job.id)).status, 'queued');
  await assert.rejects(f.jobs.get(f.users[1], job.id), { code: 'JOB_NOT_FOUND' });
  const result = await f.jobs.process(job.id);
  assert.deepEqual(result, { id: job.id, status: 'converted' });
  const files = jobPaths(f.storageRoot, job.id);
  assert.equal((await sharp(files.result).metadata()).format, 'webp');
  await assert.rejects(readFile(files.original), { code: 'ENOENT' });
  const before = await readFile(files.result);
  const restarted = createImageJobs({ database: f.database, storageRoot: f.storageRoot });
  await restarted.process(job.id);
  assert.deepEqual(await readFile(files.result), before);
  assert.equal((await restarted.get(f.users[0], job.id)).attempts, 1);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM images')).rows[0].n, 0);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM stored_objects')).rows[0].n, 0);
});

test('Worker: dos consumidores de un trabajo no duplican la conversión', options, async (t) => {
  const f = await fixture(t);
  const job = await f.stage(await png());
  await Promise.all([f.jobs.process(job.id), f.jobs.process(job.id.toUpperCase())]);
  const state = await f.jobs.get(f.users[0], job.id);
  assert.equal(state.status, 'converted');
  assert.equal(state.attempts, 1);
});

test('Worker: contenido falso y temporal alterado fallan sin publicar ni guardar originales', options, async (t) => {
  const f = await fixture(t);
  const bad = await f.stage(Buffer.from('no es PNG'));
  await assert.rejects(f.jobs.process(bad.id), { code: 'UNSUPPORTED_IMAGE' });
  assert.equal((await f.jobs.get(f.users[0], bad.id)).status, 'failed');
  await assert.rejects(readFile(jobPaths(f.storageRoot, bad.id).original), { code: 'ENOENT' });
  const changed = await f.stage(await png());
  const other = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#eab932' } }).png().toBuffer();
  await writeFile(jobPaths(f.storageRoot, changed.id).original, other);
  await assert.rejects(f.jobs.process(changed.id), { code: 'JOB_INPUT_CHANGED' });
  assert.equal((await f.jobs.get(f.users[0], changed.id)).status, 'failed');
  await assert.rejects(readFile(jobPaths(f.storageRoot, changed.id).result), { code: 'ENOENT' });
});

test('Worker: fallo transitorio conserva original y un reintento completa el mismo trabajo', options, async (t) => {
  const f = await fixture(t);
  const job = await f.stage(await png());
  await f.database.query(`CREATE FUNCTION reject_conversion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status = 'converted' THEN RAISE EXCEPTION 'test-failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_conversion BEFORE UPDATE ON image_processing_jobs FOR EACH ROW EXECUTE FUNCTION reject_conversion()`);
  await assert.rejects(f.jobs.process(job.id), { code: 'PROCESSING_UNAVAILABLE' });
  assert.equal((await f.jobs.get(f.users[0], job.id)).status, 'queued');
  assert.ok((await readFile(jobPaths(f.storageRoot, job.id).original)).length);
  await f.database.query('DROP TRIGGER reject_conversion ON image_processing_jobs');
  await f.jobs.process(job.id);
  assert.equal((await f.jobs.get(f.users[0], job.id)).status, 'converted');
  assert.equal((await f.jobs.get(f.users[0], job.id)).attempts, 2);
});

test('Worker: BullMQ entrega un trabajo real con Redis y persiste el resultado en PostgreSQL', {
  ...options, skip: (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) && 'Requiere TEST_DATABASE_URL y TEST_REDIS_URL explícitas.',
}, async (t) => {
  const f = await fixture(t);
  const config = readWorkerConfig({ REDIS_URL: process.env.TEST_REDIS_URL });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(config.connection.host), 'Redis de pruebas debe ser local.');
  const name = `smartstorage-test-${randomUUID()}`;
  const queue = createImageQueue({ ...config, name });
  const events = new QueueEvents(name, { connection: config.connection });
  let worker;
  try {
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
    const staged = await f.stage(await png());
    const queued = await enqueueImageJob(queue, staged.id);
    assert.equal((await f.jobs.get(f.users[0], staged.id)).status, 'queued');
    // Arrancar después de publicar prueba que la tarea espera a otro consumidor.
    worker = createImageWorker({ ...config, name, jobs: f.jobs });
    assert.deepEqual(await queued.waitUntilFinished(events, 20000), { id: staged.id, status: 'converted' });
    assert.equal((await f.jobs.get(f.users[0], staged.id)).status, 'converted');
    assert.equal((await sharp(jobPaths(f.storageRoot, staged.id).result).metadata()).format, 'webp');

    const invalid = await f.stage(Buffer.from('imagen falsa'));
    const rejected = await enqueueImageJob(queue, invalid.id);
    await assert.rejects(rejected.waitUntilFinished(events, 20000), /UNSUPPORTED_IMAGE/);
    assert.equal((await f.jobs.get(f.users[0], invalid.id)).status, 'failed');
    assert.equal((await f.jobs.get(f.users[0], invalid.id)).attempts, 1);
  } finally {
    // Cerrar consumidores antes de eliminar PostgreSQL; solo borrar nuestra cola.
    await worker?.close();
    await events.close();
    try { await queue.obliterate({ force: true }); }
    finally { await queue.close(); }
  }
});
