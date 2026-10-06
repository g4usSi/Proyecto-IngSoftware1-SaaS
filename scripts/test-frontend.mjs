import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';

// Frontend real con API interceptada: no usa .env, cuentas, correo ni archivos del usuario.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/playwright/frontend-regression');
await mkdir(output, { recursive: true });
const web = await createServer({ root: path.join(root, 'frontend'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
try {
  await web.listen();
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true,
    channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff7b32' } }).png().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Prueba Frontend', email: 'frontend@example.com', role: 'client', emailVerified: true };
  const date = new Date().toISOString();
  const missing = { id: 'missing-file', originalName: 'ausente.png', originalSizeBytes: '500', createdAt: date, status: 'unavailable' };
  let uploads = 0;
  let files = [];
  let loginError;
  let expired = false;
  let details = 0;
  let pollsFail = true;
  let verifications = 0;
  const resends = [];
  const job = { id: '22222222-2222-4222-8222-222222222222', originalName: 'proceso.png', status: 'queued',
    attempts: 1, maxAttempts: 3, createdAt: date, updatedAt: date, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    nextPollAfterMs: 1000, available: false, imageId: null, errorCode: null };
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = (data, status = 200) => route.fulfill({ status, json: { data } });
    const fail = (code, status, message = 'Error de prueba') => route.fulfill({ status, json: { error: { code, message } } });
    if (url.pathname.endsWith('/login')) return loginError
      ? fail(loginError, 403, 'Verifica tu correo para continuar.')
      : ok({ token: 'test-token', expiresAt: new Date(Date.now() + 3600000).toISOString(), user });
    if (url.pathname.endsWith('/register')) return ok({ ...user, emailVerified: false }, 201);
    if (url.pathname.endsWith('/resend-verification')) { resends.push(request.postDataJSON().email); return ok({ message: 'Si existe la cuenta, se envió el enlace.' }); }
    if (url.pathname.endsWith('/verify-email')) { verifications++; return ok({ verified: true }); }
    if (url.pathname.endsWith('/forgot-password')) return ok({ message: 'Si el correo está registrado, recibirás instrucciones.' });
    if (url.pathname.endsWith('/reset-password')) return ok({ reset: true });
    if (url.pathname.endsWith('/download')) return route.fulfill({ status: 200, contentType: 'image/webp', body: webp });
    if (url.pathname === '/api/files' && request.method() === 'POST') {
      uploads++;
      const image = { id: `upload-${uploads}`, originalName: `imagen-${uploads}.png`, createdAt: date,
        originalSizeBytes: String(png.length), optimizedSizeBytes: String(webp.length), status: 'ready' };
      files.unshift(image);
      return ok({ image }, 201);
    }
    if (url.pathname === '/api/files') return expired ? fail('TOKEN_EXPIRED', 401) : ok({ items: files, unavailableItems: [missing], nextCursor: null });
    if (url.pathname === '/api/jobs') return ok({ items: [job], nextCursor: null });
    if (url.pathname.startsWith('/api/jobs/')) {
      details++;
      if (pollsFail && details === 2) return fail('TEMPORARY_ERROR', 503);
      return ok(details < 3 ? job : details === 3 ? { ...job, status: 'converted' }
        : { ...job, status: 'published', available: true, imageId: 'ready-image', nextPollAfterMs: null });
    }
    return ok({ status: 'ok' });
  });
  async function step(name, run) { await run(); console.log(`OK: ${name}`); }
  async function screenshot(name, fullPage = false) {
    await page.screenshot({ path: path.join(output, name), fullPage, animations: 'disabled' });
  }
  async function login() {
    await page.goto(`${base}/login`);
    await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(user.email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Revision#123');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('link', { name: 'Procesos', exact: true }).waitFor();
  }
  async function drop(selector, count = 1) {
    const transfer = await page.evaluateHandle(({ data, count }) => {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      for (let i = 0; i < count; i++) dt.items.add(new File([bytes], `imagen-${i}.png`, { type: 'image/png' }));
      return dt;
    }, { data: png.toString('base64'), count });
    const target = page.locator(selector);
    await target.dispatchEvent('dragenter', { dataTransfer: transfer });
    await target.dispatchEvent('dragover', { dataTransfer: transfer });
    await page.locator('.page-drop.is-active').waitFor();
    await target.dispatchEvent('drop', { dataTransfer: transfer });
    await page.locator('.page-drop.is-active').waitFor({ state: 'hidden' });
    await transfer.dispose();
  }

  await step('Sin sesión: aviso y regreso al inicio; sin llamadas a demo', async () => {
    const demoRequests = [];
    const record = (request) => { if (request.url().includes('/dev/storage-demo')) demoRequests.push(request.url()); };
    page.on('request', record);
    await page.goto(`${base}/app/storage`);
    await page.getByRole('heading', { name: 'Página no disponible' }).waitFor();
    assert.equal(await page.locator('.app-sidebar').count(), 0);
    await page.waitForURL(`${base}/`, { timeout: 6000 });
    await page.locator('.landing').waitFor();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.getByRole('link', { name: /demo local/i }).count(), 0);
    assert.equal(demoRequests.length, 0);
    page.off('request', record);
  });
  await step('Registro permite volver al formulario de login', async () => {
    await page.goto(`${base}/register`);
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(user.name);
    await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(user.email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Revision#123');
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await page.getByRole('link', { name: 'Ir a iniciar sesión' }).click();
    await page.getByRole('heading', { name: 'Bienvenido de vuelta' }).waitFor();
  });
  await step('Reenvío permite corregir el destinatario', async () => {
    await page.goto(`${base}/verify-email`);
    await page.getByRole('textbox').fill('primero@example.com');
    await page.getByRole('button', { name: 'Reenviar correo de verificación' }).click();
    await page.getByRole('button', { name: 'Enlace reenviado' }).waitFor();
    await page.getByRole('textbox').fill('corregido@example.com');
    await page.getByRole('button', { name: 'Reenviar correo de verificación' }).click();
    await page.getByRole('button', { name: 'Enlace reenviado' }).waitFor();
    assert.deepEqual(resends, ['primero@example.com', 'corregido@example.com']);
  });
  await step('Verificación no consume dos veces en StrictMode y acepta un nuevo token', async () => {
    await page.goto(`${base}/verify-email?token=primero`);
    await page.getByRole('heading', { name: '¡Correo verificado!' }).waitFor();
    assert.equal(verifications, 1);
    const verifiedAgain = page.waitForResponse((r) => r.url().endsWith('/auth/verify-email'));
    await page.evaluate(() => { history.pushState(null, '', '/verify-email?token=segundo'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await verifiedAgain;
    assert.equal(verifications, 2);
  });
  await step('Contraseñas de recuperación: confirmación independiente y envío válido', async () => {
    await page.goto(`${base}/reset-password?token=prueba`);
    await page.getByRole('textbox', { name: 'Nueva contraseña', exact: true }).fill('Revision#123');
    await page.getByRole('textbox', { name: 'Repite la contraseña', exact: true }).fill('Distinta#123');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await page.getByText('Las contraseñas no coinciden.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Repite la contraseña', exact: true }).fill('Revision#123');
    assert.equal(await page.locator('input[autocomplete="new-password"]').count(), 2);
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await page.getByRole('heading', { name: 'Contraseña actualizada' }).waitFor();
  });
  await step('Login escrito manualmente, control de contraseña y vista móvil', async () => {
    await page.goto(`${base}/login`);
    await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).pressSequentially(user.email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).pressSequentially('Revision#123');
    await screenshot('login-desktop.png');
    await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
    assert.equal(await page.locator('input[name="password"]').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
    loginError = 'EMAIL_NOT_VERIFIED';
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('button', { name: 'Reenviar correo de verificación' }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    await screenshot('login-mobile.png', true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    loginError = null;
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step('Soltar en layout y zona de subida: una petición por archivo y overlay cerrado', async () => {
    await login();
    await drop('main');
    await page.getByRole('heading', { name: 'Subidas de esta sesión' }).waitFor();
    assert.equal(uploads, 1);
    await drop('.dropzone', 2);
    await page.waitForFunction(() => document.querySelectorAll('.upload-item.is-done').length === 3);
    assert.equal(uploads, 3);
    assert.equal(await page.locator('.upload-item.is-done').count(), 3);
    await screenshot('upload.png', true);
  });
  await step('Escape cancela el aviso de arrastre sin subir archivos', async () => {
    const transfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['test'], 'cancelada.png', { type: 'image/png' })); return dt;
    });
    await page.locator('main').dispatchEvent('dragenter', { dataTransfer: transfer });
    await page.locator('.page-drop.is-active').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.page-drop.is-active').waitFor({ state: 'hidden' });
    assert.equal(uploads, 3);
    await transfer.dispose();
  });
  await step('Galería muestra archivos sanos y enumera los no disponibles', async () => {
    await page.getByRole('link', { name: /^Mis imágenes/ }).click();
    await page.getByText('ausente.png', { exact: true }).waitFor();
    assert.equal(await page.locator('.img-card:not(.is-skeleton)').count(), 3);
    await screenshot('gallery.png', true);
  });
  await step('Procesos siguen tras estado sin cambios y error temporal, y paran al publicar', async () => {
    await page.getByRole('link', { name: 'Procesos', exact: true }).click();
    await page.getByRole('button', { name: 'Descargar WebP' }).waitFor({ timeout: 16000 });
    assert.equal(details, 4);
    await page.waitForTimeout(1500);
    assert.equal(details, 4);
    await screenshot('jobs.png');
    pollsFail = false;
  });
  await step('Salir de Procesos cancela las consultas programadas', async () => {
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    details = 0;
    await page.getByRole('link', { name: 'Procesos', exact: true }).click();
    await page.getByText('proceso.png', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    const before = details;
    await page.waitForTimeout(1500);
    assert.equal(details, before);
  });
  await step('Una respuesta 401 retira el panel y vuelve al inicio', async () => {
    expired = true;
    await page.getByRole('link', { name: /^Mis imágenes/ }).click();
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await page.getByRole('heading', { name: 'Página no disponible' }).waitFor();
    await page.waitForURL(`${base}/`, { timeout: 6000 });
  });
  assert.deepEqual(errors, [], 'El navegador no debe reportar errores de JavaScript');
  console.log('12 comprobaciones de frontend correctas. Capturas: output/playwright/frontend-regression');
} finally {
  await browser?.close();
  await web.close();
}
