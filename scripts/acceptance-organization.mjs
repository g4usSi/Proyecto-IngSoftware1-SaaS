import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createApp } from '../backend/src/app.js';
import { createManagedImageJobs } from '../backend/src/workers/image-lifecycle.js';

// El supervisor crea y elimina la BD. No usar cuentas, almacenamiento ni SMTP del usuario.
const testUrl = new URL(process.env.TEST_DATABASE_URL || 'postgresql://invalid/invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname) && testUrl.port === '5433' &&
  /^\/smartstorage_codex_check_[a-f0-9]{20}$/.test(testUrl.pathname), 'Ejecuta npm run test:organization-browser para crear una base aislada.');
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
const output = path.join(root, 'output', 'playwright', 'organization', runId);
await mkdir(output, { recursive: true });
const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-organization-'));
const database = new pg.Pool({ connectionString: testUrl.toString(), max: 8 });
const evidence = { startedAt: new Date().toISOString(), browser: process.env.E2E_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
  scope: 'UI real → HTTP real → PostgreSQL/Sharp/publicación real. Entrega al consumidor en memoria; esta suite no valida Redis ni SMTP real.', steps: [], sourceSha256: {} };
for (const file of ['scripts/acceptance-organization.mjs', 'scripts/test-storage.mjs',
  'frontend/src/features/storage/library.jsx', 'frontend/src/features/storage/AlbumsPage.jsx',
  'frontend/src/features/storage/TrashPage.jsx', 'frontend/src/features/auth/ChangePasswordPage.jsx',
  'backend/src/modules/storage/storage.service.js', 'backend/src/workers/image-lifecycle.js']) {
  evidence.sourceSha256[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const password = `Acceptance#1${randomBytes(8).toString('hex')}`;
const newPassword = `Updated#2${randomBytes(8).toString('hex')}`;
const verification = new Map();
const corsOrigins = [];
const jobs = createManagedImageJobs({ database, storageRoot });
const pendingJobs = new Set();
const pageErrors = [];
const workerErrors = [];
const requests = [];
let workerPaused = true;
let workerTask = null;
let workerTimer;
let api;
let web;
let browser;
let apiOrigin;
let base;
let pageA;
let pageB;
let sessionA;
let sessionB;
let imageA;
let imageB;
let jobA;
let albumId;
const shared = { name: 'compartida.png', mimeType: 'image/png', buffer: await sharp({ create: {
  width: 320, height: 240, channels: 3, background: '#257c91',
} }).png().toBuffer() };

async function step(name, work) {
  try { await work(); evidence.steps.push({ name, result: 'passed' }); console.log(`OK: ${name}`); }
  catch (error) { evidence.steps.push({ name, result: 'failed', message: error.message }); throw error; }
}

async function until(work, description, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tiempo agotado: ${description}`);
}

async function apiRequest(route, token, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiOrigin}/api${route}`, { method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return response;
}

async function apiData(route, token) {
  const response = await apiRequest(route, token);
  assert.equal(response.status, 200, route);
  return (await response.json()).data;
}

function responseFor(page, route, method = 'POST') {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api${route}` && response.request().method() === method);
}

async function navigate(page, name) {
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name, exact: false }).click();
}

async function gallery(page, count) {
  await navigate(page, /^Mis imágenes/);
  await until(async () => await page.locator('.gallery').getAttribute('aria-busy') === 'false' &&
    await page.locator('.img-card:not(.is-skeleton)').count() === count, `${count} imágenes en la galería`);
}

async function register(page, name, email) {
  await page.goto(`${base}/register`);
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  const submitted = responseFor(page, '/auth/register');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  assert.equal((await submitted).status(), 201);
  await page.getByRole('heading', { name: 'Revisa tu correo' }).waitFor();
  await until(() => verification.has(email), 'correo de verificación capturado');
  const link = new URL(verification.get(email));
  await page.goto(`${base}${link.pathname}${link.search}`);
  await page.getByRole('heading', { name: '¡Correo verificado!' }).waitFor();
  return login(page, email);
}

async function login(page, email, secret = password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(secret);
  const signedIn = responseFor(page, '/auth/login');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const response = await signedIn;
  assert.equal(response.status(), 200);
  await page.locator('.account-trigger').waitFor();
  return (await response.json()).data;
}

async function upload(page, file = shared) {
  await navigate(page, /^Subir$/);
  const accepted = responseFor(page, '/jobs');
  await page.locator('input[type=file]').setInputFiles(file);
  const response = await accepted;
  assert.equal(response.status(), 202);
  assert.match(response.request().headers()['idempotency-key'], /^[\da-f-]{36}$/i);
  return (await response.json()).data;
}

async function sendToTrash(page) {
  const response = responseFor(page, `/files/${imageA.id}/trash`);
  await page.getByRole('button', { name: `Enviar ${shared.name} a la papelera`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar a la papelera', exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}

async function purge(page, image) {
  await navigate(page, /^Papelera$/);
  const response = responseFor(page, `/files/${image.id}`, 'DELETE');
  await page.getByRole('button', { name: `Eliminar definitivamente ${shared.name}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar definitivamente', exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'La papelera está vacía' }).waitFor();
}

async function screenshot(page, filename) {
  await page.screenshot({ path: path.join(output, filename), fullPage: true, animations: 'disabled' });
}

try {
  for (const filename of (await readdir(path.join(root, 'backend/migrations'))).filter((file) => /^\d+[-_].*\.sql$/.test(file)).sort()) {
    await database.query(await readFile(path.join(root, 'backend/migrations', filename), 'utf8'));
  }
  api = createApp({ database, storageRoot, jwtSecret: randomBytes(48).toString('hex'), storageDemo: false, corsOrigins,
    mailer: { async sendEmailVerification({ to, verifyLink }) { verification.set(to, verifyLink); }, async sendPasswordReset() {} },
    enqueueJob: async (id) => { pendingJobs.add(id); },
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  apiOrigin = `http://127.0.0.1:${api.address().port}`;
  web = await createServer({ root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.js'),
    logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, open: false,
      proxy: { '/api': { target: apiOrigin, changeOrigin: true } } },
  });
  await web.listen();
  base = `http://127.0.0.1:${web.httpServer.address().port}`;
  corsOrigins.push(base);
  workerTimer = setInterval(() => {
    if (workerPaused || workerTask || !pendingJobs.size) return;
    const [id] = pendingJobs; pendingJobs.delete(id);
    workerTask = jobs.process(id).catch((error) => { workerErrors.push({ code: error.code, message: error.message }); })
      .finally(() => { workerTask = null; });
  }, 100);
  browser = await chromium.launch({ headless: true,
    ...(process.env.E2E_BROWSER_CHANNEL || process.platform === 'win32' ? { channel: evidence.browser } : {}) });
  for (const label of ['A', 'B']) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-GT', timezoneId: 'America/Guatemala', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => { const pathname = new URL(request.url()).pathname; if (pathname.startsWith('/api/')) requests.push({ method: request.method(), pathname }); });
    if (label === 'A') pageA = page; else pageB = page;
  }

  await step('Registro, verificación con token real y login de dos cuentas', async () => {
    sessionA = await register(pageA, 'Aceptación A', 'organization-a@example.test');
    sessionB = await register(pageB, 'Aceptación B', 'organization-b@example.test');
    assert.notEqual(sessionA.user.id, sessionB.user.id);
    assert.equal((await apiData('/quotas/me', sessionA.token)).usedBytes, '0');
  });

  await step('La UI admite un trabajo 202, conserva reserva y publica WebP con el worker real', async () => {
    jobA = await upload(pageA);
    assert.equal(jobA.status, 'queued');
    assert.equal(jobA.available, false);
    assert.equal((await apiData('/files', sessionA.token)).items.length, 0);
    const quota = await apiData('/quotas/me', sessionA.token);
    assert.equal(quota.reservedBytes, String(shared.buffer.length));
    assert.equal(quota.daily.uploadsReserved, '1');
    await screenshot(pageA, '01-admision-reserva.png');
    workerPaused = false;
    await pageA.locator('.upload-item.is-done').waitFor();
    const published = await apiData(`/jobs/${jobA.id}`, sessionA.token);
    assert.equal(published.status, 'published');
    assert.equal(published.available, true);
    imageA = (await apiData('/files', sessionA.token)).items[0];
    assert.equal(imageA.id, published.imageId);
    await gallery(pageA, 1);
    await pageA.locator('.img-card .thumb.is-loaded').waitFor();
    const download = pageA.waitForEvent('download');
    await pageA.getByRole('button', { name: `Descargar ${shared.name} en WebP` }).click();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'compartida.webp');
    const destination = path.join(output, 'descarga.webp');
    await file.saveAs(destination);
    assert.equal((await sharp(destination).metadata()).format, 'webp');
    const completeQuota = await apiData('/quotas/me', sessionA.token);
    assert.equal(completeQuota.usedBytes, String(shared.buffer.length));
    assert.equal(completeQuota.reservedBytes, '0');
    assert.equal(completeQuota.daily.uploadsUsed, '1');
  });

  await step('Privacidad entre cuentas y deduplicación física de la misma imagen', async () => {
    await gallery(pageB, 0);
    for (const [route, method] of [[`/files/${imageA.id}/download`, 'GET'], [`/files/${imageA.id}/trash`, 'POST'],
      [`/files/${imageA.id}/restore`, 'POST'], [`/files/${imageA.id}`, 'DELETE'], [`/jobs/${jobA.id}`, 'GET']]) {
      assert.equal((await apiRequest(route, sessionB.token, { method })).status, 404, `${method} ${route}`);
    }
    await upload(pageB);
    await pageB.locator('.upload-item.is-done').waitFor();
    await gallery(pageB, 1);
    imageB = (await apiData('/files', sessionB.token)).items[0];
    const counts = (await database.query('SELECT (SELECT COUNT(*)::int FROM images) AS images, (SELECT COUNT(*)::int FROM stored_objects) AS objects')).rows[0];
    assert.deepEqual(counts, { images: 2, objects: 1 });
    const a = await apiRequest(`/files/${imageA.id}/download`, sessionA.token);
    const b = await apiRequest(`/files/${imageB.id}/download`, sessionB.token);
    assert.deepEqual(Buffer.from(await a.arrayBuffer()), Buffer.from(await b.arrayBuffer()));
  });

  await step('Crear álbum y mover imagen desde la galería con aislamiento por propietario', async () => {
    await navigate(pageA, /^Álbumes$/);
    await pageA.getByRole('button', { name: 'Crear álbum', exact: true }).click();
    await pageA.getByLabel('Nombre del álbum').fill('Vacaciones');
    const created = responseFor(pageA, '/albums');
    await pageA.getByRole('dialog').getByRole('button', { name: 'Guardar álbum' }).click();
    const response = await created;
    assert.equal(response.status(), 201);
    albumId = (await response.json()).data.album.id;
    await pageA.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual((await apiData('/albums', sessionB.token)).items, []);
    // Filtrar no revela si un álbum ajeno existe: devuelve la colección propia vacía.
    assert.deepEqual((await apiData(`/files?folderId=${albumId}`, sessionB.token)).items, []);
    assert.equal((await apiRequest(`/albums/${albumId}`, sessionB.token, { method: 'PATCH', body: { name: 'Ajeno' } })).status, 404);
    assert.equal((await apiRequest(`/files/${imageB.id}`, sessionB.token, { method: 'PATCH', body: { folderId: albumId } })).status, 404);
    await gallery(pageA, 1);
    await pageA.getByRole('button', { name: `Mover ${shared.name} a un álbum` }).click();
    await pageA.getByLabel('Álbum de destino').selectOption(albumId);
    const moved = responseFor(pageA, `/files/${imageA.id}`, 'PATCH');
    await pageA.getByRole('dialog').getByRole('button', { name: 'Mover', exact: true }).click();
    assert.equal((await moved).status(), 200);
    await pageA.getByRole('dialog').waitFor({ state: 'hidden' });
    await navigate(pageA, /^Álbumes$/);
    await pageA.getByLabel('Álbum', { exact: true }).selectOption(albumId);
    await pageA.getByRole('heading', { name: 'Vacaciones', exact: true }).waitFor();
    await pageA.getByRole('button', { name: `Ver ${shared.name}`, exact: true }).waitFor();
    assert.equal((await apiData(`/files?folderId=${albumId}`, sessionA.token)).items[0].id, imageA.id);
    await screenshot(pageA, '02-album.png');
  });

  await step('Renombrar álbum mantiene sus imágenes', async () => {
    await pageA.getByRole('button', { name: 'Renombrar', exact: true }).click();
    await pageA.getByLabel('Nombre del álbum').fill('Viajes');
    const renamed = responseFor(pageA, `/albums/${albumId}`, 'PATCH');
    await pageA.getByRole('dialog').getByRole('button', { name: 'Guardar álbum' }).click();
    assert.equal((await renamed).status(), 200);
    await pageA.getByRole('heading', { name: 'Viajes', exact: true }).waitFor();
    assert.equal((await apiData(`/files?folderId=${albumId}`, sessionA.token)).items.length, 1);
  });

  await step('Papelera retiene capacidad y consumo; restaurar recupera el álbum y la descarga', async () => {
    await sendToTrash(pageA);
    await navigate(pageA, /^Papelera$/);
    await pageA.getByRole('button', { name: `Restaurar ${shared.name}`, exact: true }).waitFor();
    assert.equal((await apiData('/files', sessionA.token)).items.length, 0);
    assert.equal((await apiData('/files?trash=true', sessionA.token)).items.length, 1);
    assert.equal((await apiRequest(`/files/${imageA.id}/download`, sessionA.token)).status, 404);
    assert.equal((await apiRequest(`/files/${imageB.id}/download`, sessionB.token)).status, 200);
    assert.equal((await apiData(`/jobs/${jobA.id}`, sessionA.token)).available, false);
    const quota = await apiData('/quotas/me', sessionA.token);
    assert.equal(quota.usedBytes, String(shared.buffer.length));
    assert.equal(quota.daily.uploadsUsed, '1');
    await screenshot(pageA, '03-papelera.png');
    await pageA.setViewportSize({ width: 375, height: 812 });
    assert.ok(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Papelera móvil no debe desbordarse');
    await screenshot(pageA, '03-papelera-movil.png');
    const restored = responseFor(pageA, `/files/${imageA.id}/restore`);
    await pageA.getByRole('button', { name: `Restaurar ${shared.name}`, exact: true }).click();
    assert.equal((await restored).status(), 200);
    await pageA.getByRole('heading', { name: 'La papelera está vacía' }).waitFor();
    await pageA.setViewportSize({ width: 1366, height: 900 });
    assert.equal((await apiData(`/files?folderId=${albumId}`, sessionA.token)).items[0].id, imageA.id);
    assert.equal((await apiRequest(`/files/${imageA.id}/download`, sessionA.token)).status, 200);
  });

  await step('Eliminar álbum conserva las imágenes y las deja sin álbum', async () => {
    await navigate(pageA, /^Álbumes$/);
    await pageA.getByLabel('Álbum', { exact: true }).selectOption(albumId);
    await pageA.getByRole('button', { name: 'Eliminar álbum', exact: true }).click();
    const removed = responseFor(pageA, `/albums/${albumId}`, 'DELETE');
    await pageA.getByRole('dialog').getByRole('button', { name: 'Eliminar álbum', exact: true }).click();
    assert.equal((await removed).status(), 200);
    await pageA.getByRole('dialog').waitFor({ state: 'hidden' });
    await pageA.getByRole('button', { name: `Ver ${shared.name}`, exact: true }).waitFor();
    assert.equal((await apiData('/files?folderId=none', sessionA.token)).items[0].id, imageA.id);
    assert.deepEqual((await apiData('/albums', sessionA.token)).items, []);
  });

  await step('Purga libera capacidad sin devolver consumo y conserva el objeto de otra cuenta', async () => {
    await gallery(pageA, 1);
    await sendToTrash(pageA);
    await purge(pageA, imageA);
    const quota = await apiData('/quotas/me', sessionA.token);
    assert.equal(quota.usedBytes, '0');
    assert.equal(quota.reservedBytes, '0');
    assert.equal(quota.daily.uploadsUsed, '1');
    assert.equal((await apiRequest(`/files/${imageA.id}/restore`, sessionA.token, { method: 'POST' })).status, 404);
    assert.equal((await apiRequest(`/files/${imageB.id}/download`, sessionB.token)).status, 200);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM stored_objects')).rows[0].count, 1);
    await pageB.getByRole('button', { name: `Enviar ${shared.name} a la papelera`, exact: true }).click();
    await pageB.getByRole('dialog').getByRole('button', { name: 'Enviar a la papelera', exact: true }).click();
    await pageB.getByRole('dialog').waitFor({ state: 'hidden' });
    await purge(pageB, imageB);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM stored_objects')).rows[0].count, 0);
    const physical = (await readdir(storageRoot, { withFileTypes: true })).filter((entry) => /^[a-f0-9]{2}$/.test(entry.name));
    for (const directory of physical) assert.deepEqual(await readdir(path.join(storageRoot, directory.name)), []);
  });

  await step('Límite diario real rechaza la admisión y la UI conserva el error', async () => {
    await database.query("UPDATE plans SET daily_upload_limit=1 WHERE code='free'");
    await navigate(pageA, /^Subir$/);
    const rejected = responseFor(pageA, '/jobs');
    await pageA.locator('input[type=file]').setInputFiles(shared);
    const response = await rejected;
    assert.equal(response.status(), 429);
    assert.equal((await response.json()).error.code, 'DAILY_UPLOAD_LIMIT_EXCEEDED');
    await pageA.locator('.upload-item.is-error').waitFor();
    assert.equal((await apiData('/quotas/me', sessionA.token)).reservedBytes, '0');
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM image_processing_jobs')).rows[0].count, 2);
    await database.query("UPDATE plans SET daily_upload_limit=10 WHERE code='free'");
  });

  await step('Cambiar contraseña valida confirmación y conserva sesión ante contraseña actual incorrecta', async () => {
    await pageB.locator('.account-trigger').click();
    await pageB.getByRole('menuitem', { name: 'Cambiar contraseña', exact: true }).click();
    await pageB.getByLabel('Contraseña actual', { exact: true }).fill('Incorrecta#1');
    await pageB.getByLabel('Nueva contraseña', { exact: true }).fill(newPassword);
    await pageB.getByLabel('Repite la nueva contraseña', { exact: true }).fill('Distinta#1');
    await pageB.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    await pageB.getByText('Repite la nueva contraseña; ambas deben coincidir.', { exact: true }).waitFor();
    await pageB.getByLabel('Repite la nueva contraseña', { exact: true }).fill(newPassword);
    const wrong = responseFor(pageB, '/auth/change-password');
    await pageB.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    assert.equal((await wrong).status(), 400);
    await pageB.getByText('La contraseña actual es incorrecta.', { exact: true }).waitFor();
    assert.equal(await pageB.locator('.app-shell').count(), 1);
    await pageB.getByLabel('Contraseña actual', { exact: true }).fill(password);
    const changed = responseFor(pageB, '/auth/change-password');
    await pageB.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    assert.equal((await changed).status(), 200);
    await pageB.getByText('Contraseña actualizada. Tus sesiones siguen abiertas.', { exact: true }).waitFor();
    for (const field of ['Contraseña actual', 'Nueva contraseña', 'Repite la nueva contraseña']) assert.equal(await pageB.getByLabel(field, { exact: true }).inputValue(), '');
    assert.equal((await apiRequest('/auth/me', sessionB.token)).status, 200);
    await screenshot(pageB, '04-seguridad.png');
  });

  await step('Móvil sin desbordamiento, logout real y recarga con nuevo login', async () => {
    await pageB.setViewportSize({ width: 375, height: 812 });
    assert.ok(await pageB.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Seguridad móvil no debe desbordarse');
    await screenshot(pageB, '05-seguridad-movil.png');
    await pageB.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await navigate(pageB, /^Álbumes$/);
    await pageB.getByRole('button', { name: 'Crear álbum', exact: true }).click();
    assert.ok(await pageB.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Álbumes móvil no debe desbordarse');
    await screenshot(pageB, '06-album-movil.png');
    await pageB.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await pageB.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await pageB.locator('.account-trigger').click();
    const loggedOut = responseFor(pageB, '/auth/logout');
    await pageB.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }).click();
    assert.equal((await loggedOut).status(), 200);
    await pageB.waitForURL(`${base}/`);
    assert.equal((await apiRequest('/auth/me', sessionB.token)).status, 401);
    await pageB.setViewportSize({ width: 1366, height: 900 });
    sessionB = await login(pageB, 'organization-b@example.test', newPassword);
    await gallery(pageB, 0);
    await pageB.reload();
    await pageB.getByRole('heading', { name: 'Página no disponible' }).waitFor();
    await pageB.waitForURL(`${base}/`, { timeout: 6_000 });
    sessionB = await login(pageB, 'organization-b@example.test', newPassword);
    await gallery(pageB, 0);
  });

  assert.deepEqual(pageErrors, [], 'Sin errores JavaScript en navegador');
  assert.deepEqual(workerErrors, [], 'Sin errores del consumidor real');
  assert.equal(requests.filter((request) => request.pathname === '/api/files' && request.method === 'POST').length, 0, 'La UI no debe usar carga síncrona');
  evidence.result = 'passed';
  console.log(`${evidence.steps.length} comprobaciones completas. Evidencia: ${path.relative(root, output)}`);
} catch (error) {
  evidence.result = 'failed'; evidence.error = error.message;
  for (const [name, page] of [['a', pageA], ['b', pageB]]) if (page && !page.isClosed()) await screenshot(page, `failure-${name}.png`).catch(() => {});
  throw error;
} finally {
  clearInterval(workerTimer);
  await workerTask;
  evidence.completedAt = new Date().toISOString();
  evidence.pageErrors = pageErrors;
  evidence.workerErrors = workerErrors;
  await writeFile(path.join(output, 'resultado.json'), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await web?.close();
  if (api) { const stopped = new Promise((resolve) => api.close(resolve)); api.closeAllConnections(); await stopped; }
  await database.end();
  // El único borrado recursivo apunta al directorio creado para esta ejecución.
  assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
  assert.match(path.basename(storageRoot), /^smartstorage-organization-[\w-]+$/);
  await rm(storageRoot, { recursive: true, force: true });
}
