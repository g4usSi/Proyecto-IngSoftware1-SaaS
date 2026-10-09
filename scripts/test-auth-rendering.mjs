import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// API simulada: no envía correos ni cambia contraseñas reales.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/playwright/auth-rendering');
await mkdir(output, { recursive: true });
const web = await createServer({ root: path.join(root, 'frontend'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await web.listen();
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 375, height: 650 }, reducedMotion });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.canvasResizes = [];
      for (const name of ['width', 'height']) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
        Object.defineProperty(HTMLCanvasElement.prototype, name, { ...descriptor, set(value) {
          if (this.classList.contains('hero-shader')) window.canvasResizes.push({ name, value });
          descriptor.set.call(this, value);
        } });
      }
    });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.route('**/api/auth/**', (route) => route.fulfill({ json: { data: { reset: true, message: 'Si el correo está registrado, recibirás instrucciones.' } } }));
    await page.goto(`${base}/reset-password?token=prueba`);
    await page.locator('.hero-shader.is-ready').waitFor();
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.canvasResizes = []; window.originalCanvas = document.querySelector('canvas'); });
    await page.getByRole('textbox', { name: 'Nueva contraseña', exact: true }).pressSequentially('aA1!xxxx', { delay: 100 });
    await page.getByRole('textbox', { name: 'Repite la contraseña', exact: true }).pressSequentially('aA1!xxxx', { delay: 60 });
    await page.waitForTimeout(450);
    const writes = await page.evaluate(() => window.canvasResizes);
    console.log(`${reducedMotion}: ${writes.length} reinicios del canvas al escribir`);
    await page.screenshot({ path: path.join(output, `reset-${reducedMotion}.png`) });
    assert.equal(writes.length, 0, 'Escribir y animar requisitos no debe borrar el fondo WebGL.');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await page.getByRole('heading', { name: 'Contraseña actualizada' }).waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => document.querySelector('canvas') === window.originalCanvas), true);
    assert.equal(await page.evaluate(() => window.canvasResizes.length), 0, 'Cambiar a la tarjeta de éxito no debe redimensionar el fondo.');
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.waitForTimeout(450);
    assert.ok(await page.evaluate(() => window.canvasResizes.length > 0), 'Un cambio real de ventana sí ajusta el canvas.');
    const pixel = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl');
      const pixel = new Uint8Array(4);
      // Capturar la próxima escritura, antes de que el compositor descarte el búfer.
      return new Promise((resolve) => {
        const observer = new ResizeObserver(() => {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          observer.disconnect(); resolve([...pixel]);
        });
        observer.observe(canvas);
        canvas.style.width = `${canvas.clientWidth - 2}px`;
      });
    });
    assert.ok(pixel.slice(0, 3).some((value) => value > 0), 'El fondo se debe repintar al redimensionar, también con movimiento reducido.');
    await page.goto(`${base}/forgot-password`);
    await page.locator('.hero-shader.is-ready').waitFor();
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.canvasResizes = []; });
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await page.getByRole('textbox', { name: 'Correo electrónico' }).pressSequentially('prueba@example.com', { delay: 40 });
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await page.getByRole('heading', { name: 'Te enviamos instrucciones' }).waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => window.canvasResizes.length), 0);
    assert.deepEqual(errors, []);
    console.log(`OK: recuperación, validación y cambio de tarjeta (${reducedMotion})`);
    await page.close();
  }
} finally { await browser?.close(); await web.close(); }
