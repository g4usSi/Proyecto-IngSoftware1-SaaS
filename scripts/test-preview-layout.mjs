import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/playwright/preview-layout');
await mkdir(output, { recursive: true });
const web = await createServer({ root: path.join(root, 'frontend'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await web.listen();
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  const files = [
    { id: 'landscape', originalName: `landscape_hires_4000x2667_${'nombre_muy_largo_'.repeat(9)}6.83mb.jpg`, width: 4000, height: 2667 },
    { id: 'portrait', originalName: 'retrato_vertical.png', width: 800, height: 4000 },
  ].map((file) => ({ ...file, originalSizeBytes: '6830000', optimizedSizeBytes: '1100000', createdAt: '2026-10-08T19:30:00Z' }));
  const images = await Promise.all(files.map((file) => sharp({ create: { width: file.width, height: file.height, channels: 3, background: '#32688c' } }).webp().toBuffer()));
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], channel: process.platform === 'win32' ? 'msedge' : undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const ok = (data) => route.fulfill({ json: { data } });
    if (url.pathname.endsWith('/login')) return ok({ token: 'preview-test', user: { id: 'preview-user', name: 'Prueba', email: 'preview@example.com', role: 'client', emailVerified: true }, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    if (url.pathname === '/api/files') return ok({ items: files, unavailableItems: [], nextCursor: null });
    if (url.pathname.endsWith('/download')) return route.fulfill({ contentType: 'image/webp', body: images[url.pathname.includes('portrait') ? 1 : 0] });
    if (url.pathname === '/api/quotas/me') return ok({ plan: { code: 'free', name: 'Free' }, capacityBytes: '2000000000', usedBytes: '13660000', reservedBytes: '0', availableBytes: '1986340000', daily: { uploadsUsed: '2', uploadsReserved: '0', bytesUsed: '13660000', bytesReserved: '0', uploadLimit: 10, bytesLimit: '200000000', date: '2026-10-08' } });
    return ok({ items: [], nextCursor: null });
  });
  await page.goto(`${base}/login`);
  await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill('preview@example.com');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Revision#123');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('link', { name: /^Mis imágenes/ }).click();
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /Cambiar a tema/ }).click();
    for (const viewport of [{ width: 1440, height: 700 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: `Ver ${files[0].originalName}`, exact: true }).click();
      await page.locator('.preview-stage img').waitFor();
      await page.waitForFunction(() => document.querySelector('.preview-details').textContent.includes('4000 × 2667'));
      await page.waitForTimeout(500);
      const layout = await page.evaluate(() => {
        const modal = document.querySelector('.preview');
        const info = document.querySelector('.preview-info');
        const props = document.querySelector('.preview-properties');
        const stage = document.querySelector('.preview-stage').getBoundingClientRect();
        const img = document.querySelector('.preview-stage img').getBoundingClientRect();
        return { modalOverflow: modal.scrollWidth > modal.clientWidth, infoOverflow: info.scrollWidth > info.clientWidth, propsOverflow: props.scrollWidth > props.clientWidth, inside: img.left >= stage.left && img.right <= stage.right && img.top >= stage.top && img.bottom <= stage.bottom };
      });
      assert.deepEqual(layout, { modalOverflow: false, infoOverflow: false, propsOverflow: false, inside: true });
      const button = await page.locator('.preview-download').boundingBox();
      await page.locator('.preview-properties').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      assert.deepEqual(await page.locator('.preview-download').boundingBox(), button, 'La descarga debe permanecer fija al desplazar los detalles.');
      assert.equal(await page.locator('#preview-title').getAttribute('title'), files[0].originalName);
      assert.match(await page.locator('.preview-filename dd').getAttribute('title'), /^landscape_hires_4000x2667_.+\.webp$/);
      await page.screenshot({ path: path.join(output, `${theme}-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Imagen siguiente' }).click();
      await page.waitForFunction(() => document.querySelector('.preview-details').textContent.includes('800 × 4000'));
      assert.equal(await page.locator('.preview-properties').evaluate((node) => node.scrollTop), 0, 'Al cambiar de imagen, mostrar de nuevo su nombre y detalles iniciales.');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      console.log(`OK: nombre largo, propiedades, scroll y navegación (${theme}, ${viewport.width}px)`);
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await web.close(); }
