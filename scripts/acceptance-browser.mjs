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
import { expect } from 'playwright/test';
import { createServer } from 'vite';
import { createApp } from '../backend/src/app.js';

// Ejecutar mediante test:browser: el supervisor crea y elimina esta BD propia.
const testUrl = new URL(process.env.TEST_DATABASE_URL || 'postgresql://invalid/invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname) && testUrl.port === '5433' &&
  /^\/smartstorage_codex_check_[a-f0-9]{20}$/.test(testUrl.pathname), 'Usa npm run test:browser para crear una base aislada.');
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
const output = path.join(root, 'tmp', 'acceptance-browser', runId);
await mkdir(output, { recursive: true });
const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-browser-'));
const database = new pg.Pool({ connectionString: testUrl.toString(), max: 5 });
const evidence = { startedAt: new Date().toISOString(), browser: process.env.E2E_BROWSER_CHANNEL || 'chromium', steps: [] };
evidence.sourceSha256 = {};
for (const file of ['scripts/acceptance-browser.mjs', 'scripts/test-storage.mjs', 'package-lock.json',
  'frontend/src/features/storage/OverviewPage.jsx', 'frontend/src/features/storage/InsightsPage.jsx']) {
  evidence.sourceSha256[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const password = `Acceptance#1${randomBytes(8).toString('hex')}`;
const jwtSecret = randomBytes(48).toString('hex');
const corsOrigins = [];
const pageErrors = [];
let api;
let web;
let browser;
let apiOrigin;
let base;
let pageA;
let pageB;
const check = expect.configure({ timeout: 15_000 });

async function startApi(port = 0) {
  api = createApp({ database, storageRoot, jwtSecret, storageDemo: false, corsOrigins }).listen(port, '127.0.0.1');
  await once(api, 'listening');
  apiOrigin = `http://127.0.0.1:${api.address().port}`;
}

async function stopApi() {
  if (!api) return;
  const stopped = new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  api.closeAllConnections();
  await stopped;
  api = undefined;
}

async function step(name, work) {
  try {
    await work();
    evidence.steps.push({ name, result: 'passed' });
    console.log(`OK: ${name}`);
  } catch (error) {
    evidence.steps.push({ name, result: 'failed', message: error.message });
    throw error;
  }
}

async function fillAccount(page, name, email) {
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
}

async function submitRegistration(page) {
  const signedIn = page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  const response = await signedIn;
  assert.equal(response.status(), 200);
  const session = (await response.json()).data;
  await check(page.getByRole('button', { name: `${session.user.name} Plan Free`, exact: true })).toBeVisible();
  return session;
}

async function login(page, email) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  const session = (await result.json()).data;
  await check(page.getByRole('button', { name: `${session.user.name} Plan Free`, exact: true })).toBeVisible();
  return session;
}

async function freePlan(userId) {
  const result = await database.query(`SELECT p.code, p.capacity_bytes::text, p.daily_upload_limit, p.daily_bytes_limit::text
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = $1 AND s.status = 'active'`, [userId]);
  assert.deepEqual(result.rows, [{ code: 'free', capacity_bytes: '2000000000', daily_upload_limit: 10, daily_bytes_limit: '200000000' }]);
}

async function gallery(page, expectedCount) {
  await page.getByRole('link', { name: /^Mis imágenes/ }).click();
  await check(page.locator('.img-card:not(.is-skeleton)')).toHaveCount(expectedCount);
}

async function download(page, filename, outputName) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Descargar ${filename} en WebP`, exact: true }).click();
  const file = await pending;
  assert.equal(file.suggestedFilename(), filename.replace(/\.[^.]+$/, '.webp'));
  const target = path.join(output, outputName);
  await file.saveAs(target);
  assert.equal((await sharp(target).metadata()).format, 'webp');
  return readFile(target);
}

async function apiGet(route, token) {
  return fetch(`${apiOrigin}/api${route}`, { headers: { Authorization: `Bearer ${token}` } });
}

try {
  for (const filename of (await readdir(path.join(root, 'backend/migrations'))).filter((f) => /^\d+[-_].*\.sql$/.test(f)).sort()) {
    await database.query(await readFile(path.join(root, 'backend/migrations', filename), 'utf8'));
  }
  await startApi();
  web = await createServer({
    root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.js'),
    logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, open: false,
      proxy: { '/api': { target: apiOrigin, changeOrigin: true } } },
  });
  await web.listen();
  base = `http://127.0.0.1:${web.httpServer.address().port}`;
  corsOrigins.push(base);
  browser = await chromium.launch({ headless: true, ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}) });
  const contextA = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-GT', timezoneId: 'America/Guatemala', reducedMotion: 'reduce' });
  const contextB = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-GT', timezoneId: 'America/Guatemala', reducedMotion: 'reduce' });
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  for (const page of [pageA, pageB]) {
    page.setDefaultTimeout(15_000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
  }
  let sessionA;
  let sessionB;
  let imageA;
  let downloadedA;
  const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#257c91' } }).png().toBuffer();
  const jpg = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#ecb44e' } }).jpeg().toBuffer();
  const shared = { name: 'compartida.png', mimeType: 'image/png', buffer: png };

  await step('Registro A con validación visible y plan Free real', async () => {
    await pageA.goto(`${base}/register`);
    await pageA.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await check(pageA.getByText('Escribe tu nombre.', { exact: true })).toBeVisible();
    await fillAccount(pageA, 'Aceptación A', 'acceptance-a@example.test');
    sessionA = await submitRegistration(pageA);
    await freePlan(sessionA.user.id);
    await gallery(pageA, 0);
    await check(pageA.getByRole('heading', { name: 'Tu biblioteca está vacía' })).toBeVisible();
  });

  await step('Registro B rechaza correo duplicado y crea una cuenta independiente', async () => {
    await pageB.goto(`${base}/register`);
    await fillAccount(pageB, 'Aceptación B', 'acceptance-a@example.test');
    const duplicate = pageB.waitForResponse((r) => r.url().endsWith('/api/auth/register'));
    await pageB.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    assert.equal((await duplicate).status(), 409);
    await check(pageB.locator('[name="email"]')).toHaveAttribute('aria-invalid', 'true');
    await pageB.getByLabel('Correo electrónico', { exact: true }).fill('acceptance-b@example.test');
    sessionB = await submitRegistration(pageB);
    await freePlan(sessionB.user.id);
  });

  await step('Carga múltiple A convierte PNG/JPG y muestra miniaturas y descarga WebP', async () => {
    await pageA.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Subir', exact: true }).click();
    await pageA.locator('input[type=file]').setInputFiles([shared, { name: 'solo-a.jpg', mimeType: 'image/jpeg', buffer: jpg }]);
    await check(pageA.locator('.upload-item.is-done')).toHaveCount(2);
    await gallery(pageA, 2);
    await check(pageA.locator('.img-card .thumb.is-loaded')).toHaveCount(2);
    downloadedA = await download(pageA, 'compartida.png', 'cuenta-a.webp');
    const metadata = await sharp(downloadedA).metadata();
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 240);
    const response = await apiGet('/files', sessionA.token);
    assert.equal(response.status, 200);
    imageA = (await response.json()).data.items.find((i) => i.originalName === 'compartida.png');
    await pageA.screenshot({ path: path.join(output, '01-cuenta-a.png'), fullPage: true, animations: 'disabled' });
  });

  await step('B no ve archivos A; subir el mismo PNG comparte un único objeto físico', async () => {
    await gallery(pageB, 0);
    await check(pageB.getByRole('heading', { name: 'Tu biblioteca está vacía' })).toBeVisible();
    assert.equal((await apiGet(`/files/${imageA.id}/download`, sessionB.token)).status, 404);
    assert.equal((await apiGet('/admin/storage/stats', sessionB.token)).status, 403);
    await pageB.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Subir', exact: true }).click();
    await pageB.locator('input[type=file]').setInputFiles(shared);
    await check(pageB.locator('.upload-item.is-done')).toHaveCount(1);
    await gallery(pageB, 1);
    const downloadedB = await download(pageB, 'compartida.png', 'cuenta-b.webp');
    assert.deepEqual(downloadedB, downloadedA);
    const counts = (await database.query('SELECT (SELECT COUNT(*)::int FROM images) AS images, (SELECT COUNT(*)::int FROM stored_objects) AS objects')).rows[0];
    assert.deepEqual(counts, { images: 3, objects: 2 });
    const references = await database.query('SELECT COUNT(*)::int AS count FROM images WHERE object_hash = (SELECT object_hash FROM images WHERE id = $1)', [imageA.id]);
    assert.equal(references.rows[0].count, 2);
    assert.deepEqual(await readdir(path.join(storageRoot, '.tmp')), []);
    await pageB.screenshot({ path: path.join(output, '02-cuenta-b.png'), fullPage: true, animations: 'disabled' });
  });

  await step('Archivo falso y cuota excedida muestran error sin crear imágenes', async () => {
    await pageB.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Subir', exact: true }).click();
    await pageB.locator('input[type=file]').setInputFiles({ name: 'falsa.png', mimeType: 'image/png', buffer: Buffer.from('no es una imagen') });
    await check(pageB.locator('.upload-item.is-error')).toHaveCount(1);
    await check(pageB.getByText('Solo se admiten imágenes JPG, PNG o WebP de contenido válido.', { exact: true })).toBeVisible();
    // Cambiar solo el plan de la BD temporal permite comprobar la frontera real sin cargar 2 GB.
    await database.query('UPDATE plans SET daily_upload_limit = 1 WHERE code = $1', ['free']);
    await pageB.locator('input[type=file]').setInputFiles(shared);
    await check(pageB.locator('.upload-item.is-error')).toHaveCount(2);
    await check(pageB.getByText('Se alcanzó el número de subidas permitido para hoy.', { exact: true })).toBeVisible();
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM images WHERE user_id = $1', [sessionB.user.id])).rows[0].count, 1);
    await database.query('UPDATE plans SET daily_upload_limit = 10 WHERE code = $1', ['free']);
    await pageB.screenshot({ path: path.join(output, '03-errores-reales.png'), fullPage: true, animations: 'disabled' });
  });

  await step('Ahorro administrativo usa referencias lógicas y bytes reales en disco', async () => {
    // Privilegio elevado solo en esta BD temporal; el registro público continúa creando clientes.
    await database.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', sessionA.user.id]);
    const response = await apiGet('/admin/storage/stats', sessionA.token);
    assert.equal(response.status, 200);
    const stats = (await response.json()).data;
    const originals = 2n * BigInt(png.length) + BigInt(jpg.length);
    const objects = (await database.query('SELECT storage_key FROM stored_objects')).rows;
    let physical = 0n;
    for (const object of objects) physical += BigInt((await readFile(path.join(storageRoot, object.storage_key))).length);
    assert.equal(stats.originalSizeBytes, originals.toString());
    assert.equal(stats.optimizedSizeBytes, physical.toString());
    assert.equal(stats.savedBytes, (originals - physical).toString());
    assert.equal(stats.imageCount, '3');
    assert.equal(stats.objectCount, '2');
    await database.query('UPDATE users SET role = $1 WHERE id = $2', ['client', sessionA.user.id]);
  });

  await step('Reinicio de API conserva galería privada y descarga', async () => {
    const port = api.address().port;
    await stopApi();
    await startApi(port);
    await gallery(pageA, 2);
    await pageA.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await check(pageA.locator('.gallery')).toHaveAttribute('aria-busy', 'false');
    await check(pageA.locator('.img-card:not(.is-skeleton)')).toHaveCount(2);
    assert.deepEqual(await download(pageA, 'compartida.png', 'tras-reinicio.webp'), downloadedA);
    await pageB.reload();
    await check(pageB.getByRole('heading', { name: 'Tu biblioteca te espera' })).toBeVisible();
    sessionB = await login(pageB, 'acceptance-b@example.test');
    await gallery(pageB, 1);
  });

  await step('Logout desde la interfaz revoca JWT y el login rechaza contraseña incorrecta', async () => {
    await pageA.getByRole('button', { name: 'Aceptación A Plan Free', exact: true }).click();
    const revoked = pageA.waitForResponse((r) => r.url().endsWith('/api/auth/logout'));
    await pageA.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }).click();
    assert.equal((await revoked).status(), 200);
    await check(pageA.getByRole('heading', { name: 'Bienvenido de vuelta' })).toBeVisible();
    assert.equal((await apiGet('/files', sessionA.token)).status, 401);
    await pageA.getByLabel('Correo electrónico', { exact: true }).fill('acceptance-a@example.test');
    await pageA.getByLabel('Contraseña', { exact: true }).fill('Clave#Incorrecta1');
    await pageA.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await check(pageA.getByText('Correo electrónico o contraseña incorrectos.', { exact: true })).toBeVisible();
    sessionA = await login(pageA, 'acceptance-a@example.test');
    await gallery(pageA, 2);
    await pageA.setViewportSize({ width: 390, height: 844 });
    await check(pageA.getByRole('heading', { name: 'Mis imágenes', exact: true })).toBeVisible();
    await pageA.screenshot({ path: path.join(output, '04-movil.png'), fullPage: true, animations: 'disabled' });
  });

  await step('La interfaz informa aumento de peso cuando la conversión produce un WebP mayor', async () => {
    await pageB.goto(`${base}/register`);
    await fillAccount(pageB, 'Aceptación C', 'acceptance-c@example.test');
    await submitRegistration(pageB);
    const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).webp({ lossless: true }).toBuffer();
    const converted = await sharp(tiny).webp({ quality: 80 }).toBuffer();
    assert.ok(converted.length > tiny.length, 'La imagen de regresión debe crecer al reconvertirse.');
    const extra = converted.length - tiny.length;
    const percent = Math.round(extra / tiny.length * 100);
    await pageB.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Subir', exact: true }).click();
    await pageB.locator('input[type=file]').setInputFiles({ name: 'minima.webp', mimeType: 'image/webp', buffer: tiny });
    await check(pageB.locator('.upload-item.is-done')).toHaveCount(1);
    await pageB.getByRole('link', { name: 'Resumen', exact: true }).click();
    await check(pageB.locator('.saving-text')).toHaveText(`Tus WebP pesan ${extra} B más que los originales.`);
    await check(pageB.getByRole('img', { name: `${percent} % más peso que los originales`, exact: true })).toBeVisible();
    await pageB.getByRole('link', { name: 'Ahorro', exact: true }).click();
    const extraCard = pageB.locator('.stat-card').filter({ hasText: 'Espacio adicional' });
    await check(extraCard.locator('.stat-value')).toHaveText(`${extra} B`);
    await check(extraCard.locator('.stat-hint')).toHaveText(`${percent} % más`);
    await check(pageB.locator('.stat-card').filter({ has: pageB.getByText('En WebP', { exact: true }) }).locator('.stat-value')).toHaveText(`${converted.length} B`);
    await check(pageB.getByText('Aún no hay imágenes que reduzcan su peso.', { exact: true })).toBeVisible();
    await pageB.screenshot({ path: path.join(output, '05-aumento-real.png'), fullPage: true, animations: 'disabled' });
  });

  await step('Sin errores de ejecución de JavaScript en el navegador', async () => {
    assert.deepEqual(pageErrors, []);
  });
  evidence.result = 'passed';
} catch (error) {
  evidence.result = 'failed';
  // No guardar trazas de red: contienen JWT y contraseñas de las cuentas temporales.
  await pageA?.screenshot({ path: path.join(output, 'fallo-a.png'), fullPage: true }).catch(() => {});
  await pageB?.screenshot({ path: path.join(output, 'fallo-b.png'), fullPage: true }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'resultado.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidencia: ${output}`);
  await browser?.close();
  await web?.close();
  await stopApi();
  await database.end();
  assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
  assert.match(path.basename(storageRoot), /^smartstorage-browser-[\w-]+$/);
  await rm(storageRoot, { recursive: true, force: true });
}
