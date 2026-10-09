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
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'],
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
  const albums = [];
  let moveFails = false;
  let auditFiles = false;
  let loginError;
  let expired = false;
  let details = 0;
  let pollsFail = true;
  let quotaFails = false;
  let accountPlan = { code: 'free', name: 'Free' };
  let quotaRequests = 0;
  let lostLookups = 0;
  const submissions = [];
  const admitted = new Map();
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
    if (url.pathname === '/api/files' && request.method() === 'POST') throw new Error('La interfaz debe admitir subidas mediante POST /jobs.');
    if (url.pathname === '/api/albums') {
      if (request.method() === 'POST') { const album = { id: `album-${albums.length}`, name: request.postDataJSON().name, imageCount: '0' }; albums.push(album); return ok({ album }, 201); }
      return ok({ items: albums.map((album) => ({ ...album, imageCount: String(files.filter((file) => file.folderId === album.id).length) })) });
    }
    if (url.pathname.startsWith('/api/files/') && request.method() === 'PATCH') {
      if (moveFails) return fail('TEMPORARY_ERROR', 503, 'No se pudo mover la imagen.');
      const file = files.find((file) => url.pathname.endsWith(`/${file.id}`));
      file.folderId = request.postDataJSON().folderId;
      return ok({ imageId: file.id, folderId: file.folderId });
    }
    if (url.pathname === '/api/files') {
      if (expired) return fail('TOKEN_EXPIRED', 401);
      const folder = url.searchParams.get('folderId');
      if (auditFiles && url.searchParams.has('cursor')) return ok({ items: [], unavailableItems: [{ ...missing, id: 'older-missing', originalName: 'antigua-ausente.png' }], nextCursor: null });
      return ok({ items: folder ? files.filter((file) => (file.folderId ?? 'none') === folder) : files, unavailableItems: folder ? [] : [missing], nextCursor: auditFiles && !folder ? 'older' : null });
    }
    if (url.pathname === '/api/quotas/me') {
      quotaRequests++;
      if (quotaFails) return fail('TEMPORARY_ERROR', 503, 'No se pudo consultar la cuota.');
      const pending = [...admitted.values()].filter((item) => item.status !== 'published').length;
      return ok({ plan: accountPlan, capacityBytes: '2000000000', usedBytes: '850000000',
        reservedBytes: String(pending * png.length), availableBytes: String(1150000000 - pending * png.length),
        daily: { date: '2026-10-07', uploadLimit: 10, uploadsUsed: String(uploads - pending), uploadsReserved: String(pending),
          bytesLimit: '200000000', bytesUsed: String((uploads - pending) * png.length), bytesReserved: String(pending * png.length) } });
    }
    if (url.pathname === '/api/jobs' && request.method() === 'POST') {
      const id = request.headers()['idempotency-key'];
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      const originalName = /filename="([^"]+)"/.exec(request.postData() ?? '')?.[1] ?? 'imagen.png';
      submissions.push({ id, originalName });
      if (!admitted.has(id)) {
        uploads++;
        admitted.set(id, { ...job, id, originalName, status: 'queued', available: false, imageId: null, nextPollAfterMs: 1000, ticks: 0 });
        if (originalName === 'perdida.png') return route.abort('connectionreset');
      }
      return ok(admitted.get(id), 202);
    }
    if (url.pathname === '/api/jobs') return ok({ items: [...admitted.values(), job, ...(auditFiles ? [
      { ...job, id: 'failed-job', originalName: 'invalida.png', status: 'failed', errorCode: 'INVALID_IMAGE', available: false, imageId: null, nextPollAfterMs: null },
      { ...job, id: 'missing-job', originalName: missing.originalName, status: 'published', available: true, imageId: missing.id, nextPollAfterMs: null },
    ] : [])], nextCursor: null });
    if (url.pathname.startsWith('/api/jobs/')) {
      const stored = admitted.get(url.pathname.split('/').pop());
      if (stored) {
        if (stored.originalName === 'perdida.png' && ++lostLookups <= 2) return fail('JOB_NOT_FOUND', 404);
        stored.ticks++;
        if (stored.ticks === 1) stored.status = 'processing';
        else if (stored.ticks === 2) stored.status = 'converted';
        else if (stored.status !== 'published') {
          Object.assign(stored, { status: 'published', available: true, imageId: `image-${stored.id}`, nextPollAfterMs: null });
          files.unshift({ id: stored.imageId, originalName: stored.originalName, createdAt: date,
            originalSizeBytes: String(png.length), optimizedSizeBytes: String(webp.length), status: 'ready' });
        }
        return ok(stored);
      }
      details++;
      if (pollsFail && details === 2) return fail('TEMPORARY_ERROR', 503);
      Object.assign(job, details < 3 ? {} : details === 3 ? { status: 'converted' }
        : { status: 'published', available: true, imageId: 'ready-image', nextPollAfterMs: null });
      return ok(job);
    }
    return ok({ status: 'ok' });
  });
  async function step(name, run) {
    try { await run(); console.log(`OK: ${name}`); }
    catch (error) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw error; }
  }
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
  await step('Soltar cinco archivos: admisión asíncrona, cola sin bloqueo y overlay cerrado', async () => {
    await login();
    await drop('main');
    await page.getByRole('heading', { name: 'Subidas de esta sesión' }).waitFor();
    assert.equal(uploads, 1);
    await drop('.dropzone', 5);
    await page.waitForFunction(() => document.querySelectorAll('.upload-item.is-done').length === 6);
    assert.equal(uploads, 6);
    assert.equal(submissions.length, 6);
    assert.equal(await page.locator('.upload-item.is-done').count(), 6);
    await screenshot('upload.png', true);
  });
  await step('Cuota global del servidor y recuperación de una consulta fallida', async () => {
    assert.match(await page.locator('.usage-text').innerText(), /850 MB/);
    assert.match(await page.locator('.quota-summary').innerText(), /850 MB/);
    quotaFails = true;
    await page.getByRole('button', { name: 'Actualizar cuota', exact: true }).click();
    await page.locator('.quota-summary [role="alert"]').waitFor();
    quotaFails = false;
    await page.getByRole('button', { name: 'Actualizar cuota', exact: true }).click();
    await page.locator('.quota-summary [role="alert"]').waitFor({ state: 'hidden' });
    assert.ok(quotaRequests >= 3);
  });
  await step('Respuesta de admisión perdida: consulta y reenvío conservan el mismo UUID', async () => {
    await page.locator('input[type="file"]').setInputFiles({ name: 'perdida.png', mimeType: 'image/png', buffer: png });
    const row = page.locator('.upload-item').filter({ hasText: 'perdida.png' });
    await row.getByRole('button', { name: 'Consultar / reintentar' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.upload-item.is-done')].some((item) => item.textContent.includes('perdida.png')));
    const attempts = submissions.filter((item) => item.originalName === 'perdida.png');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].id, attempts[1].id);
    assert.equal(uploads, 7);
    assert.equal(files.length, 7);
  });
  await step('Escape cancela el aviso de arrastre sin subir archivos', async () => {
    const transfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['test'], 'cancelada.png', { type: 'image/png' })); return dt;
    });
    await page.locator('main').dispatchEvent('dragenter', { dataTransfer: transfer });
    await page.locator('.page-drop.is-active').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.page-drop.is-active').waitFor({ state: 'hidden' });
    assert.equal(uploads, 7);
    await transfer.dispose();
  });
  await step('Galería muestra archivos sanos y enumera los no disponibles', async () => {
    await page.getByRole('link', { name: /^Mis imágenes/ }).click();
    await page.getByText('ausente.png', { exact: true }).waitFor();
    assert.equal(await page.locator('.img-card:not(.is-skeleton)').count(), 7);
    await screenshot('gallery.png', true);
  });
  await step('Procesos siguen tras estado sin cambios y error temporal, y paran al publicar', async () => {
    await page.getByRole('link', { name: 'Procesos', exact: true }).click();
    await page.locator('.job-card').filter({ hasText: 'proceso.png' }).getByRole('button', { name: 'Descargar WebP' }).waitFor({ timeout: 16000 });
    assert.equal(details, 4);
    await page.waitForTimeout(1500);
    assert.equal(details, 4);
    await screenshot('jobs.png');
    pollsFail = false;
  });
  await step('Salir de Procesos conserva el seguimiento durante la sesión', async () => {
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    details = 0;
    Object.assign(job, { id: '33333333-3333-4333-8333-333333333333', status: 'queued', available: false, imageId: null, nextPollAfterMs: 1000 });
    await page.getByRole('link', { name: 'Procesos', exact: true }).click();
    await page.getByText('proceso.png', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    const before = details;
    await page.waitForTimeout(1500);
    assert.ok(details > before);
  });
  await step('Procesos reúne archivos ausentes paginados, evita duplicados y distingue fallos', async () => {
    auditFiles = true;
    await page.getByRole('link', { name: 'Procesos', exact: true }).click();
    await page.getByRole('button', { name: /No disponibles/ }).click();
    await page.waitForURL('**/app/jobs?filter=unavailable');
    await page.locator('.segmented button[aria-pressed="true"]').filter({ hasText: 'No disponibles' }).waitFor();
    await page.getByText('antigua-ausente.png', { exact: true }).waitFor();
    assert.equal(await page.locator('.job-card').count(), 2);
    assert.equal(await page.locator('.job-card').filter({ hasText: 'ausente.png' }).count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Descargar WebP', exact: true }).count(), 0);
    await screenshot('process-unavailable.png', true);
    await page.getByRole('button', { name: /Con error/ }).click();
    await page.waitForURL('**/app/jobs?filter=failed');
    await page.getByText('El contenido del archivo no es una imagen válida.', { exact: true }).waitFor();
    assert.equal(await page.locator('.job-card').count(), 1);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot('process-mobile.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    auditFiles = false;
  });
  await step('Álbumes: crear con clic derecho, mover con menú y arrastrar sin duplicar', async () => {
    await page.getByRole('link', { name: 'Álbumes', exact: true }).click();
    await page.locator('.album-section-head').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Crear álbum' }).click();
    await page.getByLabel('Nombre del álbum').fill('Viajes');
    await page.getByRole('button', { name: 'Guardar álbum' }).click();
    await page.getByRole('button', { name: 'Abrir Viajes' }).waitFor();
    await page.getByRole('button', { name: 'Abrir Sin álbum' }).click();
    const name = files[0].originalName;
    const card = page.locator('.img-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mover a un álbum' }).click();
    await page.getByLabel('Álbum de destino').selectOption(albums[0].id);
    moveFails = true;
    await page.getByRole('button', { name: 'Mover', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(files[0].folderId ?? null, null);
    assert.equal(await card.count(), 1);
    moveFails = false;
    await page.getByRole('button', { name: 'Mover', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await card.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Abrir Viajes' }).click();
    await card.waitFor();
    await card.dragTo(page.getByRole('button', { name: 'Abrir Sin álbum' }));
    await card.waitFor({ state: 'hidden' });
    assert.equal(files[0].folderId, null);
    assert.equal(files.length, 7);
    await page.getByRole('button', { name: 'Abrir Sin álbum' }).click();
    await card.waitFor();
    await page.getByRole('button', { name: 'Acciones de Viajes' }).click();
    await page.keyboard.press('End');
    assert.equal(await page.getByRole('menuitem', { name: 'Eliminar álbum' }).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    await screenshot('albums-desktop.png', true);
    await page.getByRole('button', { name: /Cambiar a tema/ }).click();
    await screenshot('albums-alternate-theme.png', true);
    await page.setViewportSize({ width: 1440, height: 500 });
    await screenshot('sidebar-scrollbar.png');
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot('albums-mobile.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step('Mejorar plan: acceso visible, motivos por sección y catálogo sin compra activa', async () => {
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    await page.getByRole('heading', { name: 'Tus ideas merecen más espacio.' }).waitFor();
    assert.equal(await page.locator('.app-sidebar').getByRole('link', { name: 'Mejorar plan', exact: true }).count(), 1);
    await screenshot('upgrade-dashboard-dark.png', true);
    await page.getByRole('button', { name: 'Cambiar a tema claro' }).click();
    await screenshot('upgrade-dashboard-light.png', true);
    await page.getByRole('main').getByRole('link', { name: 'Mejorar plan', exact: true }).click();
    await page.getByRole('heading', { name: 'Más espacio cuando lo necesites' }).waitFor();
    await page.locator('.app-plan.is-featured').getByText('Elegir plan · Próximamente', { exact: true }).waitFor();
    for (const route of ['storage', 'albums', 'upload', 'history', 'jobs', 'trash', 'insights']) {
      await page.locator(`.app-nav a[href="/app/${route}"]`).click();
      await page.getByRole('complementary', { name: 'Ventaja de Pro' }).waitFor();
      assert.equal(await page.locator('.plan-context a, .plan-context button').count(), 0, 'El motivo no repite el CTA persistente.');
    }
    await page.getByRole('link', { name: /^Mis imágenes/ }).click();
    await screenshot('upgrade-library.png', true);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.locator('.usage-upgrade').click();
    await page.getByRole('heading', { name: 'Más espacio cuando lo necesites' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'El catálogo no debe desbordar el móvil.');
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await screenshot('upgrade-sidebar-mobile.png');
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    await page.getByRole('heading', { name: 'Tus ideas merecen más espacio.' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot('upgrade-dashboard-mobile.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    accountPlan = { code: 'pro', name: 'Pro' };
    await page.locator('.app-nav a[href="/app/upload"]').click();
    await page.getByRole('button', { name: 'Actualizar cuota', exact: true }).click();
    await page.locator('.usage-tier strong').filter({ hasText: /^Pro$/ }).waitFor();
    assert.equal(await page.locator('.plan-context').count(), 0);
    await page.locator('.usage-upgrade').click();
    await page.locator('.app-plan.is-current').getByRole('heading', { name: 'Pro', exact: true }).waitFor();
    accountPlan = { code: 'free', name: 'Free' };
  });
  await step('Una respuesta 401 retira el panel y vuelve al inicio', async () => {
    expired = true;
    await page.getByRole('link', { name: /^Mis imágenes/ }).click();
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await page.getByRole('heading', { name: 'Página no disponible' }).waitFor();
    await page.waitForURL(`${base}/`, { timeout: 6000 });
    const before = details;
    await page.waitForTimeout(1500);
    assert.equal(details, before, 'Cerrar sesión cancela las consultas de procesos.');
  });
  assert.deepEqual(errors, [], 'El navegador no debe reportar errores de JavaScript');
  console.log('Comprobaciones de frontend correctas. Capturas: output/playwright/frontend-regression');
} finally {
  await browser?.close();
  await web.close();
}
