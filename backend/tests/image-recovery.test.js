import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { QueueEvents } from 'bullmq';
import { createApp } from '../src/app.js';
import { AppError } from '../src/lib/app-error.js';
import { createTokenService } from '../src/modules/auth/token.js';
import { prepareImage, storageKeyFor } from '../src/modules/storage/storage.files.js';
import { createImageJobs, jobPaths } from '../src/workers/image-jobs.js';
import { statOrNull } from '../src/workers/image-job-files.js';
import { withJobLock } from '../src/workers/job-lock.js';
import { createImageRecovery, ensureImageQueued } from '../src/workers/image-recovery.js';
import { createImageQueue, createImageWorker, enqueueImageJob, readWorkerConfig } from '../src/workers/image-queue.js';
import { fixture } from './helpers/worker-fixture.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL de pruebas.', timeout: 60000 };
const redisOptions = { ...options, skip: (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) && 'Requiere PostgreSQL y Redis explícitos.' };
const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#2678a1' } }).png().toBuffer();
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const expire = (f, id) => f.database.query("UPDATE image_processing_jobs SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);

async function withRedis(f, run) {
  const config = readWorkerConfig({ REDIS_URL: process.env.TEST_REDIS_URL });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(config.connection.host));
  const name = `smartstorage-recovery-test-${randomUUID()}`;
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

test('S3-05: reponer un COMMIT sin envío a Redis, incluso con dos reconciliadores', redisOptions, async (t) => {
  const f = await fixture(t);
  await withRedis(f, async ({ queue, recovery, events, startWorker }) => {
    const job = await f.stage(await png());
    assert.equal(await queue.getJob(job.id), undefined);
    await Promise.all([recovery.runOnce(), createImageRecovery({ ...f, queue }).runOnce()]);
    assert.equal(await queue.getWaitingCount(), 1);
    startWorker();
    assert.deepEqual(await (await queue.getJob(job.id)).waitUntilFinished(events, 15000), { id: job.id, status: 'converted' });
    await recovery.runOnce();
    assert.equal((await f.jobs.get(f.users[0], job.id)).attempts, 1);
  });
});

for (const phase of ['processing', 'result']) {
  test(`S3-05: matar proceso en ${phase} y recuperar con otro consumidor real`, redisOptions, async (t) => {
    const f = await fixture(t);
    await withRedis(f, async ({ name, queue, events, recovery, startWorker }) => {
      const job = await f.stage(await png());
      const queued = await enqueueImageJob(queue, job.id);
      const child = fork(new URL('./helpers/worker-crash-child.mjs', import.meta.url), [], { windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, TEST_SCHEMA: f.schema,
          TEST_STORAGE_ROOT: f.storageRoot, TEST_QUEUE: name, CRASH_PHASE: phase } });
      let childErrors = '';
      child.stderr.on('data', (data) => { childErrors += data; });
      const exited = once(child, 'exit');
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try { assert.equal((await once(child, 'message', { signal: controller.signal }))[0].phase, 'checkpoint', childErrors); }
        finally { clearTimeout(timeout); }
        assert.equal((await f.jobs.get(f.users[0], job.id)).status, 'processing');
        const before = phase === 'result' ? await readFile(jobPaths(f.storageRoot, job.id).result) : null;
        child.kill('SIGKILL');
        await exited;
        await recovery.runOnce();
        startWorker();
        assert.deepEqual(await queued.waitUntilFinished(events, 15000), { id: job.id, status: 'converted' });
        assert.equal((await f.jobs.get(f.users[0], job.id)).attempts, phase === 'result' ? 1 : 2);
        if (before) assert.deepEqual(await readFile(jobPaths(f.storageRoot, job.id).result), before);
        assert.deepEqual((await readdir(jobPaths(f.storageRoot, job.id).directory)).sort(), ['result.json', 'result.webp']);
        assert.equal((await f.database.query('SELECT count(*)::int AS n FROM stored_objects')).rows[0].n, 0);
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
    });
  });
}

test('S3-05: Redis perdido se reconstruye y el contador persistente limita intentos', redisOptions, async (t) => {
  const f = await fixture(t, { convert: async () => { throw new AppError(503, 'STORAGE_UNAVAILABLE', 'fallo inyectado'); } });
  await withRedis(f, async ({ queue, recovery }) => {
    const job = await f.stage(await png());
    for (let i = 0; i < 3; i++) {
      await recovery.runOnce();
      assert.ok(await queue.getJob(job.id));
      // Pérdida de esta entrada Redis; no vaciar bases compartidas.
      await (await queue.getJob(job.id)).remove();
      await assert.rejects(f.jobs.process(job.id), { code: 'STORAGE_UNAVAILABLE' });
    }
    await recovery.runOnce();
    assert.equal((await f.jobs.get(f.users[0], job.id)).status, 'failed');
    assert.equal((await f.jobs.get(f.users[0], job.id)).attempts, 3);
    assert.equal(await queue.getJob(job.id), undefined);
    assert.equal(await statOrNull(jobPaths(f.storageRoot, job.id).directory), null);
  });
});

test('S3-05: expire limpia pendientes y convertidos; respeta una conversión activa', options, async (t) => {
  const entered = deferred(); const release = deferred();
  const f = await fixture(t, { convert: async (...args) => { entered.resolve(); await release.promise; return prepareImage(...args); } });
  const active = await f.stage(await png());
  const converting = f.jobs.process(active.id);
  await entered.promise;
  try {
    await expire(f, active.id);
    assert.deepEqual(await f.jobs.recover(active.id, assert.fail), { skipped: true });
    assert.ok(await readFile(jobPaths(f.storageRoot, active.id).original));
  } finally { release.resolve(); await converting; }
  await f.jobs.recover(active.id, assert.fail);
  assert.equal((await f.jobs.get(f.users[0], active.id)).errorCode, 'JOB_EXPIRED');
  assert.equal(await statOrNull(jobPaths(f.storageRoot, active.id).directory), null);
  const pending = await f.stage(await png());
  await expire(f, pending.id);
  await f.jobs.recover(pending.id, assert.fail);
  assert.equal((await f.jobs.get(f.users[0], pending.id)).attempts, 0);
  assert.equal(await statOrNull(jobPaths(f.storageRoot, pending.id).directory), null);
});

test('S3-05: original ausente y recibo corrupto terminan con error explícito y limpian', options, async (t) => {
  const f = await fixture(t);
  const missing = await f.stage(await png());
  await rm(jobPaths(f.storageRoot, missing.id).original);
  await f.jobs.recover(missing.id, assert.fail);
  assert.equal((await f.jobs.get(f.users[0], missing.id)).errorCode, 'JOB_INPUT_MISSING');
  const corrupt = await f.stage(await png());
  await f.jobs.process(corrupt.id);
  await writeFile(jobPaths(f.storageRoot, corrupt.id).result, 'corrupto');
  await f.jobs.recover(corrupt.id, assert.fail);
  assert.equal((await f.jobs.get(f.users[0], corrupt.id)).errorCode, 'JOB_RESULT_INVALID');
  assert.equal(await statOrNull(jobPaths(f.storageRoot, corrupt.id).directory), null);
  const manifest = await f.stage(await png());
  await f.jobs.process(manifest.id);
  await writeFile(jobPaths(f.storageRoot, manifest.id).receipt, 'null');
  await f.jobs.recover(manifest.id, assert.fail);
  assert.equal((await f.jobs.get(f.users[0], manifest.id)).errorCode, 'JOB_RESULT_INVALID');
  const interruptedRename = await f.stage(await png());
  await f.jobs.process(interruptedRename.id);
  const files = jobPaths(f.storageRoot, interruptedRename.id);
  await rename(files.result, files.prepared);
  await f.database.query("UPDATE image_processing_jobs SET status = 'processing', converted_at = NULL WHERE id=$1", [interruptedRename.id]);
  await f.jobs.recover(interruptedRename.id, assert.fail);
  assert.equal((await f.jobs.get(f.users[0], interruptedRename.id)).status, 'converted');
  assert.equal((await f.jobs.get(f.users[0], interruptedRename.id)).attempts, 1);
  assert.equal(await statOrNull(files.prepared), null);
  assert.ok(await statOrNull(files.result));
});

test('S3-05: barrido de huérfanos conserva carpetas recientes, bloqueadas y destinos de enlaces', options, async (t) => {
  const f = await fixture(t);
  const old = new Date(Date.now() - 2 * 86400000);
  const orphan = randomUUID(), fresh = randomUUID(), busy = randomUUID(), linked = randomUUID();
  for (const id of [orphan, fresh, busy]) {
    const files = jobPaths(f.storageRoot, id);
    await mkdir(files.directory, { recursive: true });
    await writeFile(files.original, 'temporal');
    if (id !== fresh) await utimes(files.directory, old, old);
  }
  const outside = path.join(f.storageRoot, 'objetos-definitivos');
  await mkdir(outside);
  await writeFile(path.join(outside, 'compartido.webp'), 'NO BORRAR');
  await symlink(outside, jobPaths(f.storageRoot, linked).directory, 'junction');
  const entered = deferred(), release = deferred();
  const holding = withJobLock(f.database, busy, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  try {
    const recovery = createImageRecovery({ ...f, queue: { getJob: assert.fail } });
    assert.equal((await recovery.runOnce()).orphansRemoved, 1);
    assert.ok(await statOrNull(jobPaths(f.storageRoot, fresh).original));
    assert.ok(await statOrNull(jobPaths(f.storageRoot, busy).original));
    assert.equal(await readFile(path.join(outside, 'compartido.webp'), 'utf8'), 'NO BORRAR');
  } finally { release.resolve(); await holding; }
});

test('S3-05: endpoints JWT, aislamiento, paginación y estado para el frontend', options, async (t) => {
  const f = await fixture(t);
  const first = await f.stage(await png());
  const second = await f.stage(await png());
  await f.stage(await png(), f.users[1]);
  // Empate con microsegundos para comprobar cursor estable.
  await f.database.query("UPDATE image_processing_jobs SET created_at = '2026-10-04T12:00:00.123456Z'");
  const secret = 'worker-route-secret-longer-than-thirty-two-characters';
  const tokens = createTokenService({ secret, expiresIn: '1h' });
  const server = createApp({ database: f.database, storageRoot: f.storageRoot, storageDemo: false, jwtSecret: secret }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/jobs`;
    const headers = { Authorization: `Bearer ${tokens.issue(f.users[0]).token}` };
    assert.equal((await fetch(base)).status, 401);
    const response = await fetch(`${base}?limit=1`, { headers });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const { data: page } = await response.json();
    const contract = JSON.parse(await readFile(new URL('../../docs/contracts/jobs.openapi.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(page.items[0]).sort(), [...contract.components.schemas.ImageJob.required].sort());
    const { data: next } = await (await fetch(`${base}?limit=1&cursor=${page.nextCursor}`, { headers })).json();
    assert.deepEqual(new Set([page.items[0].id, next.items[0].id]), new Set([first.id, second.id]));
    assert.equal(next.nextCursor, null);
    assert.equal(page.items[0].available, false);
    assert.equal(page.items[0].downloadUrl, null);
    assert.equal(JSON.stringify(page).includes(f.storageRoot), false);
    assert.equal(JSON.stringify(page).includes('original_hash'), false);
    assert.equal((await fetch(`${base}?limit=200`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/invalid`, { headers })).status, 400);
    const other = { Authorization: `Bearer ${tokens.issue(f.users[1]).token}` };
    assert.equal((await fetch(`${base}/${first.id}`, { headers: other })).status, 404);
    assert.equal((await fetch(base, { method: 'POST', headers })).status, 503);
    await f.jobs.process(first.id);
    const { data: converted } = await (await fetch(`${base}/${first.id}`, { headers })).json();
    assert.equal(converted.status, 'converted');
    assert.equal(converted.available, false);
    await f.database.query('UPDATE users SET active = FALSE WHERE id = $1', [f.users[0]]);
    const disabled = await fetch(`${base}/${first.id}`, { headers });
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).error.code, 'ACCOUNT_DISABLED');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('S3-05: contrato doble reserva/confirmación/liberación comparte transacción y UUID', options, async (t) => {
  let f;
  let rejectReserve = true, rejectConfirm = true, rejectRelease = true;
  const lifecycle = {
    async reserve(client, job) {
      await client.query("INSERT INTO test_quota (id, state) VALUES ($1, 'reserved')", [job.jobId]);
      if (rejectReserve) throw new AppError(409, 'QUOTA_EXCEEDED', 'Sin cupo de prueba.');
    },
    async confirm(client, job) {
      await client.query("UPDATE test_quota SET state = 'confirmed', confirmations = confirmations + 1 WHERE id = $1 AND state = 'reserved'", [job.jobId]);
      if (rejectConfirm) throw new Error('Fallo después de cambiar cuota, antes de COMMIT.');
      const key = storageKeyFor(job.originalHash);
      await mkdir(path.dirname(path.join(f.storageRoot, key)), { recursive: true });
      await copyFile(job.resultPath, path.join(f.storageRoot, key));
      await client.query(`INSERT INTO stored_objects (hash_sha256, original_size_bytes, storage_key, status)
        VALUES ($1, $2, $3, 'ready') ON CONFLICT DO NOTHING`, [job.originalHash, job.originalSizeBytes, key]);
      await client.query(`INSERT INTO images (id, user_id, object_hash, original_name) VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [job.jobId, job.userId, job.originalHash, job.originalName]);
      return { imageId: job.jobId };
    },
    async release(client, job) {
      assert.equal(job.reason, 'JOB_EXPIRED');
      await client.query("UPDATE test_quota SET state = 'released', releases = releases + 1 WHERE id = $1 AND state = 'reserved'", [job.jobId]);
      if (rejectRelease) throw new Error('Fallo después de liberar, antes de COMMIT.');
    },
  };
  f = await fixture(t, { lifecycle });
  await f.database.query(`CREATE TABLE test_quota (id UUID PRIMARY KEY, state TEXT NOT NULL,
    confirmations INT NOT NULL DEFAULT 0, releases INT NOT NULL DEFAULT 0)`);
  await assert.rejects(f.stage(await png()), { code: 'QUOTA_EXCEEDED' });
  assert.equal((await f.database.query('SELECT count(*)::int AS n FROM image_processing_jobs')).rows[0].n, 0);
  assert.equal((await f.database.query('SELECT count(*)::int AS n FROM test_quota')).rows[0].n, 0);
  assert.deepEqual(await readdir(path.join(f.storageRoot, '.tmp', 'jobs')), []);
  rejectReserve = false;
  const job = await f.stage(await png());
  await assert.rejects(f.jobs.process(job.id), /antes de COMMIT/);
  assert.equal((await f.jobs.get(f.users[0], job.id)).status, 'converted');
  assert.equal((await f.database.query('SELECT confirmations FROM test_quota WHERE id=$1', [job.id])).rows[0].confirmations, 0);
  rejectConfirm = false;
  const restarted = createImageJobs({ ...f, lifecycle });
  await restarted.recover(job.id, assert.fail);
  await restarted.recover(job.id, assert.fail);
  const state = await restarted.get(f.users[0], job.id);
  assert.equal(state.status, 'published');
  assert.equal(state.available, true);
  assert.equal(state.attempts, 1);
  assert.equal((await f.database.query('SELECT count(*)::int AS n FROM images')).rows[0].n, 1);
  assert.equal((await f.database.query('SELECT confirmations FROM test_quota WHERE id=$1', [job.id])).rows[0].confirmations, 1);
  assert.equal(await statOrNull(jobPaths(f.storageRoot, job.id).directory), null);
  const hash = (await f.database.query('SELECT object_hash FROM images WHERE id=$1', [job.id])).rows[0].object_hash;
  const published = await readFile(path.join(f.storageRoot, storageKeyFor(hash)));
  await expire(f, job.id);
  await restarted.recover(job.id, assert.fail);
  assert.deepEqual(await readFile(path.join(f.storageRoot, storageKeyFor(hash))), published);

  const expired = await f.stage(await png());
  await expire(f, expired.id);
  // Un ejecutable sin adaptador real jamás acusa una liberación ficticia.
  await createImageJobs(f).recover(expired.id, assert.fail);
  assert.equal((await restarted.get(f.users[0], expired.id)).quotaState, 'pending');
  await assert.rejects(restarted.recover(expired.id, assert.fail), /antes de COMMIT/);
  assert.equal((await restarted.get(f.users[0], expired.id)).quotaState, 'pending');
  assert.equal(await statOrNull(jobPaths(f.storageRoot, expired.id).directory), null);
  rejectRelease = false;
  await restarted.recover(expired.id, assert.fail);
  await restarted.recover(expired.id, assert.fail);
  const ledger = (await f.database.query('SELECT * FROM test_quota WHERE id=$1', [expired.id])).rows[0];
  assert.equal(ledger.releases, 1);
  assert.equal(ledger.confirmations, 0);
  assert.equal((await restarted.get(f.users[0], expired.id)).quotaState, 'settled');
});

test('S3-05: reintenta entrega fallida en Redis sin adelantar un backoff pendiente', redisOptions, async (t) => {
  const f = await fixture(t);
  await withRedis(f, async ({ queue, events, recovery, config, name, startWorker }) => {
    const staged = await f.stage(await png());
    const delivery = await queue.add('convert', { id: staged.id }, { jobId: staged.id, attempts: 1 });
    const broken = createImageWorker({ ...config, name, jobs: { process: async () => { throw new Error('Redis agotó la entrega antes de tocar PG'); } } });
    try { await assert.rejects(delivery.waitUntilFinished(events, 15000), /PROCESSING_UNAVAILABLE/); }
    finally { await broken.close(); }
    await recovery.runOnce();
    assert.equal(await delivery.getState(), 'waiting');
    startWorker();
    await delivery.waitUntilFinished(events, 15000);
    assert.equal((await f.jobs.get(f.users[0], staged.id)).attempts, 1);
    const delayedId = randomUUID();
    const delayed = await queue.add('convert', { id: delayedId }, { jobId: delayedId, delay: 60000 });
    await ensureImageQueued(queue, delayedId);
    assert.equal(await delayed.getState(), 'delayed');
  });
});
