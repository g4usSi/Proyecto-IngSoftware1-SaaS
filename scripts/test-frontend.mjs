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
  let albumReadMode = 'normal';
  let heldAlbumRequest;
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
  const plan = (code, name, capacityBytes, dailyUploadLimit, dailyBytesLimit, monthlyPrice, extra = {}) => ({ id: `plan-${code}`, code, name, capacityBytes,
    dailyUploadLimit, dailyBytesLimit, monthlyPrice, currency: 'USD', billingPeriod: code === 'free' ? 'none' : 'calendar_month', ...extra });
  const catalog = [plan('free', 'Free', '2000000000', 10, '200000000', '0.00'), plan('standard', 'Estándar', '25000000000', null, '500000000', '8.00'),
    plan('pro', 'Pro', '100000000000', null, null, '15.00'),
    plan('enterprise', 'Enterprise', '200000000000', null, null, '40.00', { storagePricePerGbMonth: '0.20', includedStorageBytes: '200000000000' })];
  let subscription = { id: 'sub-1', status: 'active', startedAt: date, expiresAt: null, plan: catalog[0] };
  const payments = [];
  const paidKeys = new Map();
  const receipts = [];
  let capacityExceeded = false;
  let adminSummaryFails = false;
  const adminUsers = [{ ...user, active: true, createdAt: date },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Ana Cliente', email: 'ana@example.com', role: 'client', active: true, emailVerified: true, createdAt: date }];
  const resends = [];
  const job = { id: '22222222-2222-4222-8222-222222222222', originalName: 'proceso.png', status: 'queued',
    attempts: 1, maxAttempts: 3, createdAt: date, updatedAt: date, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    nextPollAfterMs: 1000, available: false, imageId: null, errorCode: null };
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = (data, status = 200) => route.fulfill({ status, json: { data } });
    const fail = (code, status, message = 'Error de prueba', details) => route.fulfill({ status, json: { error: { code, message, ...(details ? { details } : {}) } } });
    // ── S4-06: catálogo, suscripción y pagos simulados ──
    if (url.pathname === '/api/plans') return ok(catalog);
    if (url.pathname === '/api/files/summary') {
      const logical = files.reduce((sum, file) => sum + Number(file.originalSizeBytes), 0);
      const physical = files.reduce((sum, file) => sum + Number(file.optimizedSizeBytes ?? 0), 0);
      return ok({ logicalBytes: String(logical), physicalBytes: String(physical), savedBytes: String(logical - physical),
        savedPercent: logical ? (((logical - physical) / logical) * 100).toFixed(2) : '0.00', imageCount: String(files.length), trashCount: '0',
        uniqueObjectCount: String(files.length), duplicateCount: '0', unavailableObjectCount: '0' });
    }
    if (url.pathname === '/api/subscriptions/me') return ok(subscription);
    if (['/api/subscriptions/checkout', '/api/subscriptions/renew', '/api/subscriptions/change-plan'].includes(url.pathname)) {
      const body = request.postDataJSON();
      const key = request.headers()['idempotency-key'];
      const target = url.pathname.endsWith('/renew') ? subscription.plan : catalog.find((plan) => plan.code === body.planCode);
      if (url.pathname.endsWith('/change-plan') && !body.card) {
        if (capacityExceeded) return fail('PLAN_CAPACITY_EXCEEDED', 409, 'Libera espacio antes de cambiar.', { capacityBytes: target.capacityBytes, usedBytes: '30000000000', reservedBytes: '0', bytesToFree: '5000000000' });
        subscription = { ...subscription, plan: target, expiresAt: target.code === 'free' ? null : subscription.expiresAt };
        accountPlan = { code: target.code, name: target.name };
        return ok({ changeType: 'downgrade', previousPlan: 'pro', newPlan: target.code, subscription });
      }
      assert.ok(key && key.length >= 8, 'Los pagos envían Idempotency-Key');
      if (paidKeys.has(key)) return ok({ ...paidKeys.get(key), repeated: true });
      const status = { 4242424242424242: 'approved', 4000000000000002: 'rejected', 4000000000000119: 'error' }[body.card.number];
      const payment = { id: `pay-${payments.length}`, planCode: target.code, planName: target.name, amount: target.monthlyPrice, currency: 'USD',
        status, cardLast4: body.card.number.slice(-4), reference: `REF-${payments.length}`, createdAt: new Date().toISOString() };
      payments.unshift(payment);
      if (status === 'approved') {
        const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
        subscription = { ...subscription, plan: target, expiresAt: url.pathname.endsWith('/renew') ? new Date(Date.parse(subscription.expiresAt) + 30 * 86400000).toISOString() : expiresAt };
        accountPlan = { code: target.code, name: target.name };
      }
      const result = { payment, subscription: status === 'approved' ? subscription : null, repeated: false };
      paidKeys.set(key, result);
      return ok(result, 201);
    }
    if (url.pathname === '/api/payments') {
      const page = Number(url.searchParams.get('page')); const limit = Number(url.searchParams.get('limit'));
      return ok({ payments: payments.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: payments.length, totalPages: Math.max(1, Math.ceil(payments.length / limit)) } });
    }
    if (url.pathname.startsWith('/api/payments/') && url.pathname.endsWith('/receipt')) {
      receipts.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="recibo-prueba.pdf"' }, body: '%PDF-1.4 prueba' });
    }
    // ── S4-07: perfil y administración ──
    if (url.pathname === '/api/auth/me') {
      if (request.method() === 'PATCH') user.name = request.postDataJSON().name.trim();
      return ok({ ...user, active: true, createdAt: date });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (user.role !== 'admin') return fail('FORBIDDEN', 403, 'No tienes permiso para realizar esta acción.');
      if (url.pathname === '/api/admin/summary') return adminSummaryFails ? fail('DATABASE_UNAVAILABLE', 503, 'PostgreSQL no está disponible.')
        : ok({ users: { total: String(adminUsers.length), active: String(adminUsers.filter((item) => item.active).length), verified: '2', admins: '1' },
          plans: catalog.map((plan) => ({ code: plan.code, name: plan.name, capacityBytes: plan.capacityBytes, currentSubscriptions: plan.code === 'free' ? '1' : '1' })),
          storage: { logicalBytes: '2500', reservedBytes: '250', uniqueOriginalBytes: '1500', deduplicatedBytes: '1000', deduplicatedPercent: '40.00', imageCount: '3', trashCount: '1', uniqueObjectCount: '2' },
          jobs: { queued: '1', processing: '0', converted: '0', published: '4', failed: '1' } });
      if (url.pathname === '/api/admin/storage/stats') return ok({ originalSizeBytes: '2500', uniqueOriginalSizeBytes: '1500', optimizedSizeBytes: '600', savedBytes: '1900', savedPercent: '76.00', imageCount: '3', objectCount: '2' });
      if (url.pathname === '/api/admin/users') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const items = adminUsers.filter((item) => !q || item.email.includes(q) || item.name.toLowerCase().includes(q));
        return ok({ items, total: items.length, page: 1, pageSize: 20 });
      }
      const match = /\/api\/admin\/users\/([^/]+)(\/status)?$/.exec(url.pathname);
      if (match) {
        const target = adminUsers.find((item) => item.id === match[1]);
        if (match[2]) {
          if (target.id === user.id) return fail('CANNOT_DEACTIVATE_SELF', 400, 'No puedes desactivar tu propia cuenta.');
          target.active = request.postDataJSON().active;
        }
        return ok(target);
      }
      if (url.pathname === '/api/admin/usage') return ok({ items: [{ user: adminUsers[1], plan: null, usedBytes: '1500', reservedBytes: '0', availableBytes: null, usedPercent: null, imageCount: '2', trashCount: '1' }], total: '1', limit: 20, offset: 0 });
      return ok({ items: [], total: '0', limit: 20, offset: 0 });
    }
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
      if (albumReadMode === 'error') return fail('DATABASE_UNAVAILABLE', 503, 'PostgreSQL no está disponible.');
      if (albumReadMode === 'hang') { heldAlbumRequest = route; return; }
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
  await step('Álbumes: error y espera agotada no simulan borrado; reintento y reconexión recuperan el listado', async () => {
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    albumReadMode = 'error';
    await page.getByRole('link', { name: 'Álbumes', exact: true }).click();
    await page.locator('.album-browser [role="alert"]').waitFor();
    assert.equal(await page.locator('.album-grid').count(), 0, 'Una consulta fallida no debe presentarse como una lista vacía.');
    assert.equal(await page.getByText('Todavía no tienes álbumes en esta cuenta.', { exact: true }).count(), 0);
    albumReadMode = 'normal';
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Viajes', exact: true }).waitFor();
    albumReadMode = 'hang';
    await page.getByRole('button', { name: 'Actualizar álbumes', exact: true }).click();
    await page.getByText(/La consulta de álbumes tardó demasiado/).waitFor({ timeout: 18_000 });
    assert.equal(await page.getByRole('button', { name: 'Abrir Viajes', exact: true }).count(), 1, 'Se conserva la lista confirmada.');
    await heldAlbumRequest.abort().catch(() => {});
    albumReadMode = 'normal';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('.album-browser [role="alert"]').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Abrir Viajes', exact: true }).waitFor();
    assert.equal(albums.length, 1);
  });
  await step('Planes: catálogo USD desde GET /plans, promoción con datos reales y sin quetzales ni SDK', async () => {
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    await page.getByRole('heading', { name: 'Tus ideas merecen más espacio.' }).waitFor();
    assert.match(await page.locator('.upgrade-banner').innerText(), /15\.00/);
    for (const route of ['storage', 'albums', 'upload', 'history', 'trash', 'insights']) {
      await page.locator(`.app-nav a[href="/app/${route}"]`).click();
      await page.getByRole('complementary', { name: 'Ventaja de Pro' }).waitFor();
      assert.equal(await page.locator('.plan-context a, .plan-context button').count(), 0, 'El motivo no repite el CTA persistente.');
    }
    await page.locator('.usage-upgrade').click();
    await page.getByRole('heading', { name: 'Planes y suscripción' }).waitFor();
    await page.locator('.app-plan').nth(3).waitFor();
    const text = await page.locator('main').innerText();
    assert.doesNotMatch(text, /Q\d|quetzal|SDK|Próximamente/i, 'Sin precios en quetzales ni beneficios inexistentes.');
    assert.match(text, /0\.20 por GB-mes/);
    await page.locator('.app-plan.is-current').getByRole('heading', { name: 'Free', exact: true }).waitFor();
    await screenshot('plans-dark.png', true);
    await page.getByRole('button', { name: 'Cambiar a tema claro' }).click();
    await screenshot('plans-light.png', true);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Los planes no desbordan el móvil.');
    await screenshot('plans-mobile.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step('Contratar Pro: rechazo sin cambio de plan; aprobado refresca suscripción y cuota con otra clave', async () => {
    const dialog = page.locator('dialog.action-dialog');
    await page.locator('.app-plan').filter({ hasText: 'Pro' }).first().getByRole('button', { name: 'Contratar' }).click();
    await dialog.getByRole('button', { name: /0002 · Rechazada/ }).click();
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByText('Sin cobro').waitFor({ state: 'detached' });
    await dialog.getByRole('button', { name: /^Pagar/ }).click();
    await dialog.getByRole('heading', { name: 'Pago rechazado' }).waitFor();
    assert.equal(subscription.plan.code, 'free');
    await dialog.getByRole('button', { name: 'Probar con otra tarjeta' }).click();
    await dialog.getByRole('button', { name: /4242 · Aprobada/ }).click();
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByRole('button', { name: /^Pagar/ }).click();
    await dialog.getByRole('heading', { name: 'Pago aprobado' }).waitFor();
    assert.equal(paidKeys.size, 2, 'Cada intento de pago usa su propia Idempotency-Key.');
    await dialog.getByRole('button', { name: 'Listo' }).click();
    await page.locator('.app-plan.is-current').getByRole('heading', { name: 'Pro', exact: true }).waitFor();
    await page.locator('.usage-tier strong').filter({ hasText: /^Pro$/ }).waitFor();
    await page.getByRole('button', { name: 'Renovar un mes' }).waitFor();
  });
  await step('Bajar con consumo mayor a la capacidad: indica cuánto liberar y bloquea la confirmación', async () => {
    capacityExceeded = true;
    const dialog = page.locator('dialog.action-dialog');
    await page.getByRole('button', { name: 'Cambiar a Estándar' }).click();
    await dialog.getByText('Sin cobro').waitFor();
    await dialog.getByRole('button', { name: 'Confirmar cambio' }).click();
    await dialog.getByText(/Libera al menos 5 GB/).waitFor();
    assert.ok(await dialog.getByRole('button', { name: 'Confirmar cambio' }).isDisabled());
    await screenshot('plans-downgrade-blocked.png');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    assert.equal(subscription.plan.code, 'pro');
    capacityExceeded = false;
  });
  await step('Renovar Pro con tarjeta aprobada', async () => {
    const before = subscription.expiresAt;
    const dialog = page.locator('dialog.action-dialog');
    await page.getByRole('button', { name: 'Renovar un mes' }).click();
    await dialog.getByRole('button', { name: /4242 · Aprobada/ }).click();
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByText(/Un mes más desde el/).waitFor();
    await dialog.getByRole('button', { name: /^Pagar/ }).click();
    await dialog.getByRole('heading', { name: 'Pago aprobado' }).waitFor();
    await dialog.getByRole('button', { name: 'Listo' }).click();
    assert.ok(Date.parse(subscription.expiresAt) > Date.parse(before));
  });
  await step('Historial de pagos: estados reales y recibo descargado con la sesión', async () => {
    await page.getByRole('link', { name: 'Historial de pagos' }).click();
    await page.getByRole('heading', { name: 'Historial de pagos', level: 1 }).waitFor();
    const rows = page.locator('.data-table tbody tr');
    await rows.nth(2).waitFor();
    assert.equal(await rows.count(), 3);
    assert.ok(await rows.filter({ hasText: 'Rechazado' }).getByRole('button', { name: /Descargar recibo/ }).isDisabled(), 'Un pago rechazado no tiene recibo.');
    const download = page.waitForEvent('download');
    await rows.filter({ hasText: 'Pagado' }).first().getByRole('button', { name: /Descargar recibo/ }).click();
    assert.equal((await download).suggestedFilename(), 'recibo-prueba.pdf');
    assert.equal(receipts.length, 1);
    await screenshot('payments.png', true);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'El historial no desborda el móvil.');
    await screenshot('payments-mobile.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step('Perfil: editar el nombre lo actualiza en la barra lateral; el correo es solo lectura', async () => {
    await page.locator('.account-trigger').click();
    await page.getByRole('menuitem', { name: 'Mi perfil' }).click();
    const name = page.getByRole('textbox', { name: 'Nombre', exact: true });
    await name.waitFor();
    assert.ok(await page.getByRole('textbox', { name: 'Correo electrónico' }).getAttribute('readonly') !== null);
    await name.fill('   ');
    await page.getByText('Escribe tu nombre.').waitFor();
    await name.fill('Alegría Editada');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByText('Nombre actualizado.').waitFor();
    await page.locator('.account-trigger-text strong').filter({ hasText: 'Alegría Editada' }).waitFor();
  });
  await step('Administración: el cliente no la ve; el admin ve errores sin ceros, datos reales y gestiona usuarios', async () => {
    assert.equal(await page.locator('.app-nav a[href="/app/admin"]').count(), 0, 'Un cliente no ve el menú de administración.');
    await page.evaluate(() => { history.pushState({}, '', '/app/admin'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: 'No tienes permiso para ver esta sección' }).waitFor();
    user.role = 'admin';
    adminSummaryFails = true;
    await login();
    await page.locator('.app-nav a[href="/app/admin"]').click();
    await page.getByRole('alert').filter({ hasText: 'PostgreSQL no está disponible.' }).waitFor();
    assert.equal(await page.locator('.stats-grid').count(), 0, 'Con error no se muestran ceros.');
    adminSummaryFails = false;
    await page.getByRole('alert').filter({ hasText: 'PostgreSQL' }).getByRole('button', { name: 'Volver a intentar' }).click();
    await page.locator('.kv-list').getByText('1.9 KB · 76.00 %').waitFor();
    await page.locator('.stats-grid .stat-value').filter({ hasText: '76.0 %' }).waitFor();
    await page.locator('.job-counts').waitFor();
    await screenshot('admin-overview.png', true);
    await page.locator('.app-nav a[href="/app/admin/users"]').click();
    const ana = page.locator('.data-table tbody tr').filter({ hasText: 'ana@example.com' });
    await ana.getByRole('button', { name: 'Ver detalle' }).click();
    const dialog = page.locator('dialog.action-dialog');
    await dialog.getByRole('button', { name: 'Desactivar cuenta' }).click();
    await dialog.getByRole('button', { name: 'Desactivar', exact: true }).click();
    await page.getByText('Cuenta desactivada', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await ana.getByText('Desactivada').waitFor();
    await page.locator('.data-table tbody tr').filter({ hasText: user.email }).getByRole('button', { name: 'Ver detalle' }).click();
    assert.ok(await dialog.getByRole('button', { name: 'Desactivar cuenta' }).isDisabled(), 'Un admin no puede desactivarse a sí mismo.');
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await page.locator('.app-nav a[href="/app/admin/usage"]').click();
    await page.locator('.data-table').getByText('Sin plan').first().waitFor();
    assert.doesNotMatch(await page.locator('.data-table').innerText(), /0\.0 %/, 'Una cuenta sin plan no se muestra como 0 %.');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.locator('.app-nav a[href="/app/admin/users"]').click();
    await page.locator('.data-table tbody tr').first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Usuarios no desborda el móvil.');
    await screenshot('admin-users-mobile.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
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
