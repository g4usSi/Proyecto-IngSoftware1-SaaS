import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { QueueEvents } from 'bullmq';
import { fixture as workerFixture } from './helpers/worker-fixture.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/lib/app-error.js';
import { createTokenService } from '../src/modules/auth/token.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { storageKeyFor } from '../src/modules/storage/storage.files.js';
import { createManagedImageJobs } from '../src/workers/image-lifecycle.js';
import { createImageRecovery } from '../src/workers/image-recovery.js';
import { createImageQueue, createImageWorker, enqueueImageJob, readWorkerConfig } from '../src/workers/image-queue.js';
import { jobPaths } from '../src/workers/image-jobs.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 60000 };
const redisOptions = { ...options, skip: (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) && 'Requiere PostgreSQL y Redis explícitos.' };
const png = (background = '#2678a1') => sharp({ create: { width: 40, height: 30, channels: 3, background } }).png().toBuffer();
async function fixture(t, extra = {}) {
  const f = await workerFixture(t);
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  f.jobs = createManagedImageJobs({ ...f, ...extra });
  f.storage = createStorageService(f);
  f.file = async (buffer) => {
    const filename = path.join(f.storageRoot, `${randomUUID()}.png`);
    await writeFile(filename, buffer);
    return { path: filename, size: buffer.length, originalname: 'prueba.png' };
  };
  f.stage = async (buffer, ownerId = f.users[0], folderId = null) => f.jobs.stage({ ownerId, file: await f.file(buffer), folderId });
  f.upload = async (buffer, ownerId = f.users[0]) => f.storage.uploadFile(ownerId, await f.file(buffer), {});
  f.limits = async ({ capacity = 2000000000, count = null, bytes = null } = {}) => {
    await f.database.query("UPDATE plans SET capacity_bytes=$1,daily_upload_limit=$2,daily_bytes_limit=$3 WHERE code='free'", [capacity, count, bytes]);
  };
  return f;
}

async function withRedis(f, run) {
  const config = readWorkerConfig({ REDIS_URL: process.env.TEST_REDIS_URL });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(config.connection.host));
  const name = `smartstorage-async-test-${randomUUID()}`;
  const queue = createImageQueue({ ...config, name });
  const events = new QueueEvents(name, { connection: config.connection });
  let worker;
  try {
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
    const recovery = createImageRecovery({ ...f, queue });
    await run({ config, name, queue, events, recovery,
      startWorker: () => { worker = createImageWorker({ ...config, name, jobs: f.jobs, lockDuration: 1000, stalledInterval: 1000 }); return worker; } });
  } finally {
    await worker?.close();
    await events.close();
    try { await queue.obliterate({ force: true }); } finally { await queue.close(); }
  }
}

test('S3-11: último cupo compartido entre subida síncrona y asíncrona', options, async (t) => {
  const f = await fixture(t);
  await f.limits({ count: 1 });
  const results = await Promise.allSettled([f.stage(await png()), f.upload(await png('#cc4433'))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'DAILY_UPLOAD_LIMIT_EXCEEDED');
  const accepted = results.find((r) => r.status === 'fulfilled').value;
  if (accepted.id) await f.jobs.process(accepted.id);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM images')).rows[0].n, 1);
  assert.equal((await f.database.query('SELECT upload_count FROM quota_daily_usage')).rows[0].upload_count, 1);
});

test('S3-11: capacidad reservada bloquea también la carga síncrona', options, async (t) => {
  const f = await fixture(t);
  const data = await png();
  await f.limits({ capacity: data.length });
  await f.stage(data);
  await assert.rejects(f.upload(data), { code: 'CAPACITY_EXCEEDED' });
});

test('S3-11: publicación idempotente, deduplicación privada y borrado de referencias', options, async (t) => {
  const f = await fixture(t);
  const data = await png();
  const a = await f.stage(data);
  const b = await f.stage(data, f.users[1]);
  await Promise.all([f.jobs.process(a.id), f.jobs.process(b.id)]);
  await f.jobs.process(a.id);
  const aState = await f.jobs.get(f.users[0], a.id);
  const bState = await f.jobs.get(f.users[1], b.id);
  assert.equal(aState.status, 'published');
  assert.equal(aState.available, true);
  assert.equal(aState.quotaState, 'settled');
  await assert.rejects(f.jobs.get(f.users[1], a.id), { code: 'JOB_NOT_FOUND' });
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM stored_objects')).rows[0].n, 1);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM images')).rows[0].n, 2);
  const object = (await f.database.query('SELECT * FROM stored_objects')).rows[0];
  const filename = path.join(f.storageRoot, storageKeyFor(object.hash_sha256));
  assert.equal((await sharp(await readFile(filename)).metadata()).format, 'webp');
  await assert.rejects(f.storage.deleteFile(f.users[1], aState.imageId), { code: 'FILE_NOT_FOUND' });
  await f.storage.deleteFile(f.users[0], aState.imageId);
  await stat(filename);
  await f.storage.deleteFile(f.users[1], bState.imageId);
  await assert.rejects(stat(filename), { code: 'ENOENT' });
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM stored_objects')).rows[0].n, 0);
  assert.deepEqual((await f.database.query('SELECT upload_count FROM quota_daily_usage')).rows.map((row) => row.upload_count), [1, 1]);
  assert.equal((await f.jobs.get(f.users[0], a.id)).available, false);
});

test('S3-11: borrar libera capacidad sin devolver cupo diario', options, async (t) => {
  const f = await fixture(t);
  const data = await png();
  await f.limits({ capacity: data.length, count: 1 });
  const { image } = await f.upload(data);
  await f.storage.deleteFile(f.users[0], image.id);
  await assert.rejects(f.stage(data), { code: 'DAILY_UPLOAD_LIMIT_EXCEEDED' });
  await f.limits({ capacity: data.length, count: 2 });
  await f.stage(data);
});

test('S3-11: rollback de borrado conserva referencia y objeto físico', options, async (t) => {
  const f = await fixture(t);
  const { image } = await f.upload(await png());
  const object = (await f.database.query('SELECT * FROM stored_objects')).rows[0];
  const filename = path.join(f.storageRoot, storageKeyFor(object.hash_sha256));
  await f.database.query(`CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected rollback'; END $$;
    CREATE TRIGGER reject_delete BEFORE DELETE ON stored_objects FOR EACH ROW EXECUTE FUNCTION reject_delete()`);
  await assert.rejects(f.storage.deleteFile(f.users[0], image.id), /injected rollback/);
  await stat(filename);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM images')).rows[0].n, 1);
});

test('S3-11: una limpieza física interrumpida queda registrada y se recupera', options, async (t) => {
  const f = await fixture(t);
  const { image } = await f.upload(await png());
  await f.database.query(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected cleanup failure'; END $$;
    CREATE TRIGGER reject_cleanup BEFORE DELETE ON storage_cleanup_tasks FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`);
  await f.storage.deleteFile(f.users[0], image.id);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM storage_cleanup_tasks')).rows[0].n, 1);
  await f.database.query('DROP TRIGGER reject_cleanup ON storage_cleanup_tasks');
  await createImageRecovery({ ...f, queue: { getJob: assert.fail } }).runOnce();
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM storage_cleanup_tasks')).rows[0].n, 0);
  assert.equal((await f.database.query('SELECT upload_count FROM quota_daily_usage')).rows[0].upload_count, 1);
});

test('S3-11: tres fallos liberan reserva y admiten un UUID nuevo', options, async (t) => {
  const f = await fixture(t, { convert: async () => { throw new AppError(503, 'STORAGE_UNAVAILABLE', 'fallo inyectado'); } });
  await f.limits({ count: 1 });
  const data = await png();
  const job = await f.stage(data);
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(f.jobs.process(job.id), { code: 'STORAGE_UNAVAILABLE' });
  const failed = await f.jobs.get(f.users[0], job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.quotaState, 'settled');
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_daily_usage')).rows[0].n, 0);
  f.jobs = createManagedImageJobs(f);
  const next = await f.stage(data);
  await f.jobs.process(next.id);
  assert.equal((await f.database.query('SELECT upload_count FROM quota_daily_usage')).rows[0].upload_count, 1);
});

test('S3-11: vencimiento libera incluso si se desactivó la cuenta', options, async (t) => {
  const f = await fixture(t);
  const job = await f.stage(await png());
  await f.database.query("UPDATE image_processing_jobs SET expires_at=now()-INTERVAL '1 second'");
  await f.database.query('UPDATE users SET active=FALSE WHERE id=$1', [f.users[0]]);
  await f.jobs.recover(job.id, assert.fail);
  await f.jobs.recover(job.id, assert.fail);
  const state = await f.jobs.get(f.users[0], job.id);
  assert.equal(state.status, 'failed');
  assert.equal(state.errorCode, 'JOB_EXPIRED');
  assert.equal(state.quotaState, 'settled');
  assert.equal((await f.database.query('SELECT status FROM quota_reservations')).rows[0].status, 'released');
});

test('S3-11: POST autenticado admite aunque se pierda envío a Redis; recupera y descarga', redisOptions, async (t) => {
  const f = await fixture(t);
  await withRedis(f, async ({ recovery, queue, events, startWorker }) => {
    const secret = 'async-test-secret-longer-than-thirty-two-characters';
    const token = createTokenService({ secret, expiresIn: '1h' }).issue(f.users[0]).token;
    const server = createApp({ ...f, storageDemo: false, jwtSecret: secret, enqueueJob: async () => { throw new Error('lost Redis'); } }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const headers = { Authorization: `Bearer ${token}` };
      const idempotencyKey = randomUUID();
      const upload = async () => {
        const body = new FormData();
        body.set('file', new Blob([await png()], { type: 'image/png' }), 'imagen.png');
        return body;
      };
      assert.equal((await fetch(`${base}/jobs`, { method: 'POST', body: await upload() })).status, 401);
      const accepted = await fetch(`${base}/jobs`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': idempotencyKey }, body: await upload() });
      assert.equal(accepted.status, 202);
      const { data: job } = await accepted.json();
      assert.equal(job.quotaState, 'pending');
      assert.equal(accepted.headers.get('location'), `/api/jobs/${job.id}`);
      const { data: quota } = await (await fetch(`${base}/quotas/me`, { headers })).json();
      assert.equal(quota.reservedBytes, String((await png()).length));
      assert.equal(quota.daily.uploadsReserved, '1');
      await recovery.runOnce();
      const queued = await queue.getJob(job.id);
      startWorker();
      assert.equal((await queued.waitUntilFinished(events, 15000)).status, 'published');
      const repeated = await fetch(`${base}/jobs`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': idempotencyKey }, body: await upload() });
      assert.equal(repeated.status, 202);
      assert.equal((await repeated.json()).data.id, job.id);
      assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_reservations')).rows[0].n, 1);
      const { data: state } = await (await fetch(`${base}/jobs/${job.id}`, { headers })).json();
      const downloaded = await fetch(`${base}/files/${state.imageId}/download`, { headers });
      assert.equal(downloaded.status, 200);
      assert.equal((await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata()).format, 'webp');
      assert.equal((await fetch(`${base}/files/${state.imageId}`, { method: 'DELETE', headers })).status, 200);
      const { data: after } = await (await fetch(`${base}/quotas/me`, { headers })).json();
      assert.equal(after.usedBytes, '0');
      assert.equal(after.reservedBytes, '0');
      assert.equal(after.daily.uploadsUsed, '1');
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});

for (const phase of ['beforeCommit', 'afterCommit']) {
  test(`S3-11: caída real ${phase} conserva una publicación y un consumo`, redisOptions, async (t) => {
    const f = await fixture(t);
    await withRedis(f, async ({ name, queue, events, recovery, startWorker }) => {
      const job = await f.stage(await png());
      const delivery = await enqueueImageJob(queue, job.id);
      const child = fork(new URL('./helpers/managed-crash-child.mjs', import.meta.url), [], { windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, TEST_SCHEMA: f.schema,
          TEST_STORAGE_ROOT: f.storageRoot, TEST_QUEUE: name, CRASH_PHASE: phase } });
      const exited = once(child, 'exit');
      let errors = '';
      child.stderr.on('data', (chunk) => { errors += chunk; });
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try { assert.equal((await once(child, 'message', { signal: controller.signal }))[0].phase, 'checkpoint', errors); }
        finally { clearTimeout(timeout); }
        child.kill('SIGKILL');
        await exited;
        await recovery.runOnce();
        startWorker();
        assert.equal((await delivery.waitUntilFinished(events, 15000)).status, 'published');
        await recovery.runOnce();
        const state = await f.jobs.get(f.users[0], job.id);
        assert.equal(state.status, 'published');
        assert.equal(state.attempts, 1);
        assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM images')).rows[0].n, 1);
        assert.equal((await f.database.query('SELECT upload_count FROM quota_daily_usage')).rows[0].upload_count, 1);
        await assert.rejects(stat(jobPaths(f.storageRoot, job.id).directory), { code: 'ENOENT' });
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
    });
  });
}
