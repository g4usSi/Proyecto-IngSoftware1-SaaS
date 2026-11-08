// Medición de los requisitos de rendimiento y disponibilidad (RNF-AUT-03/04, RNF-STO-01/05, RNF-PAG-02/04).
// La ejecuta scripts/test-storage.mjs --bench sobre una base temporal propia: no toca datos del equipo.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SmartStorageClient } from '../sdk/src/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const pg = requireBackend('pg');
const sharp = requireBackend('sharp');
const { createApp } = await import('../backend/src/app.js');
const { createTokenService } = await import('../backend/src/modules/auth/token.js');
const { createManagedImageJobs } = await import('../backend/src/workers/image-lifecycle.js');

const RUNS = { login: 30, reads: 30, images: 20 };
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]; };
const stats = (values) => ({ runs: values.length, p50: Math.round(percentile(values, 50)), p95: Math.round(percentile(values, 95)), max: Math.round(Math.max(...values)) });
const timed = async (fn) => { const start = performance.now(); await fn(); return performance.now() - start; };

const schema = `bench_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const database = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 8 });
const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-bench-'));
let server;
try {
  const migrations = path.join(root, 'backend/migrations');
  for (const file of (await readdir(migrations)).filter((f) => /^\d+[-_].*\.sql$/.test(f)).sort()) {
    await database.query(await readFile(path.join(migrations, file), 'utf8'));
  }
  const secret = `bench-${randomUUID()}-secret-de-medicion`;
  const managed = createManagedImageJobs({ database, storageRoot });
  // Procesamiento inmediato del trabajo: mide admisión, conversión Sharp y publicación sin espera de cola.
  server = createApp({ database, storageRoot, storageDemo: false, jwtSecret: secret, mailer: { sendEmailVerification: async () => {}, sendPasswordReset: async () => {}, sendInvoice: async () => {} },
    enqueueJob: async (id) => { await managed.process(id); } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const json = async (route, { method = 'GET', body, token, key } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
    return (await response.json()).data;
  };

  // Disponibilidad: sondeo continuo de salud, base de datos y cuota durante toda la medición.
  const probes = { health: [0, 0], ready: [0, 0], quota: [0, 0] };
  let probing = true;
  let quotaToken;
  const prober = (async () => {
    while (probing) {
      for (const [name, route] of [['health', '/health'], ['ready', '/ready'], ['quota', '/quotas/me']]) {
        if (name === 'quota' && !quotaToken) continue;
        probes[name][1] += 1;
        try {
          const response = await fetch(`${base}${route}`, { headers: name === 'quota' ? { Authorization: `Bearer ${quotaToken}` } : {}, signal: AbortSignal.timeout(2000) });
          if (response.ok) probes[name][0] += 1;
          await response.arrayBuffer();
        } catch { /* cuenta como fallo */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  const startedAt = new Date();

  // RNF-AUT-03: inicio de sesión.
  const email = `bench-${randomUUID()}@medicion.test`;
  const password = 'Medicion#2026';
  await json('/auth/register', { method: 'POST', body: { name: 'Cuenta de medición', email, password } });
  await database.query('UPDATE users SET email_verified = TRUE WHERE email = $1', [email]);
  const login = [];
  let token;
  for (let i = 0; i < RUNS.login; i += 1) login.push(await timed(async () => { token = (await json('/auth/login', { method: 'POST', body: { email, password } })).token; }));
  quotaToken = token;

  // RNF-PAG-02: suscripción, historial de pagos y datos de las gráficas de consumo.
  await json('/subscriptions/checkout', { method: 'POST', token, key: randomUUID(), body: { planCode: 'pro', card: { number: '4242424242424242' } } });
  for (let i = 0; i < 12; i += 1) await json('/subscriptions/renew', { method: 'POST', token, key: randomUUID(), body: { card: { number: '4242424242424242' } } });
  const reads = { subscription: [], payments: [], summary: [], quota: [] };
  for (let i = 0; i < RUNS.reads; i += 1) {
    reads.subscription.push(await timed(() => json('/subscriptions/me', { token })));
    reads.payments.push(await timed(() => json('/payments?page=1&limit=10', { token })));
    reads.summary.push(await timed(() => json('/files/summary', { token })));
    reads.quota.push(await timed(() => json('/quotas/me', { token })));
  }

  // RNF-STO-01: optimización de imágenes de ~10 MB, a través del SDK con una clave de API.
  const { secret: apiKey } = await json('/keys', { method: 'POST', token, body: { name: 'Medición' } });
  const client = new SmartStorageClient({ apiKey, baseUrl: base, timeoutMs: 60_000 });
  const images = [];
  const sizes = [];
  for (let i = 0; i < RUNS.images; i += 1) {
    // Ruido distinto en cada corrida: evita la deduplicación y comprime poco, como una foto pesada.
    const noise = Buffer.alloc(1900 * 1900 * 3);
    for (let b = 0; b < noise.length; b += 1) noise[b] = (b * 2654435761 + i * 97 + (b >> 7) * 31) & 0xff;
    const input = await sharp(noise, { raw: { width: 1900, height: 1900, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
    sizes.push(input.length);
    images.push(await timed(async () => {
      const job = await client.uploadImage(input, { filename: `medicion-${i}.jpg`, timeoutMs: 60_000 });
      if (job.status !== 'published') throw new Error('La imagen no se publicó.');
    }));
  }

  // Sondeo prolongado opcional (BENCH_AVAILABILITY_MINUTES) con uso del SDK cada pocos segundos.
  const extraMinutes = Number(process.env.BENCH_AVAILABILITY_MINUTES ?? 0);
  const until = Date.now() + extraMinutes * 60_000;
  while (Date.now() < until) {
    await client.quota().catch(() => {});
    await client.listImages({ limit: 5 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  probing = false;
  await prober;
  const finishedAt = new Date();
  const availability = Object.fromEntries(Object.entries(probes).map(([name, [ok, total]]) => [name, { ok, total, percent: total ? Number(((ok / total) * 100).toFixed(2)) : null }]));
  const result = {
    executedAt: startedAt.toISOString(),
    durationSeconds: Math.round((finishedAt - startedAt) / 1000),
    environment: { node: process.version, os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9) },
    availabilityMinutes: Number(((finishedAt - startedAt) / 60000).toFixed(1)),
    note: 'Medición local con PostgreSQL real; el procesamiento corre en el mismo proceso (sin espera de cola Redis). Tiempos en milisegundos.',
    'RNF-AUT-03 inicio de sesión (meta < 2000 ms)': stats(login),
    'RNF-PAG-02 lecturas de suscripción, pagos y consumo (meta < 2000 ms)': Object.fromEntries(Object.entries(reads).map(([name, values]) => [name, stats(values)])),
    'RNF-STO-01 optimización de imagen (meta p95 < 10000 ms)': { ...stats(images), averageInputMB: Number((sizes.reduce((a, b) => a + b, 0) / sizes.length / 1e6).toFixed(2)) },
    'RNF-AUT-04, RNF-STO-05 y RNF-PAG-04 disponibilidad durante la medición': availability,
  };
  console.log(JSON.stringify(result, null, 2));
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(startedAt);
  const out = path.join(root, 'docs/evidencias', `${localDate}-rendimiento`);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'resultado.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Resultado guardado en ${path.relative(root, out)}/resultado.json`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(storageRoot, { recursive: true, force: true });
}
