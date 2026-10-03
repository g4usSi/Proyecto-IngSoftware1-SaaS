import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFakeDatabase, createFakeMailer, postJson, tokenFromLink, withApi,
} from './helpers/fake-auth-database.js';
import { emailVerificationMessage } from '../src/modules/auth/mailer.js';
import { readEnv } from '../src/config/env.js';

const VALID = { name: 'Lany Pérez', email: 'lany@example.com', password: 'Clave#Segura1' };

async function setup(t, options = {}) {
  const database = createFakeDatabase();
  const mailer = options.mailer ?? createFakeMailer();
  const request = await withApi(t, database, { mailer });
  return { database, mailer, request };
}

function login(request) {
  return postJson(request, '/api/auth/login', { email: VALID.email, password: VALID.password });
}

test('registro envía un enlace de verificación de 24 horas y solo guarda su hash', async (t) => {
  const { database, mailer, request } = await setup(t);
  const response = await postJson(request, '/api/auth/register', VALID);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.emailVerified, false);

  assert.equal(mailer.verifications.length, 1);
  const [message] = mailer.verifications;
  assert.equal(message.to, VALID.email);
  assert.match(message.verifyLink, /^http:\/\/localhost:5173\/verify-email\?token=[a-f0-9]{64}$/);

  const [record] = database.emailVerifications.values();
  assert.notEqual(record.token_hash, tokenFromLink(message.verifyLink));
  const hours = (record.expires_at - Date.now()) / 3_600_000;
  assert.ok(hours > 23.9 && hours <= 24, `vence en ${hours} h`);
});

test('sin verificar no se puede iniciar sesión; tras verificar sí', async (t) => {
  const { mailer, request } = await setup(t);
  await postJson(request, '/api/auth/register', VALID);

  const blocked = await login(request);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'EMAIL_NOT_VERIFIED');

  const token = tokenFromLink(mailer.verifications[0].verifyLink);
  const verified = await postJson(request, '/api/auth/verify-email', { token });
  assert.equal(verified.status, 200);
  assert.deepEqual((await verified.json()).data, { verified: true });

  const allowed = await login(request);
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data.user.emailVerified, true);
});

test('una contraseña incorrecta no revela que la cuenta está sin verificar', async (t) => {
  const { request } = await setup(t);
  await postJson(request, '/api/auth/register', VALID);
  const response = await postJson(request, '/api/auth/login', { email: VALID.email, password: 'Incorrecta#1' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'INVALID_CREDENTIALS');
});

test('verify-email rechaza tokens usados, vencidos, inventados o vacíos', async (t) => {
  const { database, mailer, request } = await setup(t);
  await postJson(request, '/api/auth/register', VALID);
  const token = tokenFromLink(mailer.verifications[0].verifyLink);

  assert.equal((await postJson(request, '/api/auth/verify-email', { token })).status, 200);
  const reused = await postJson(request, '/api/auth/verify-email', { token });
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).error.code, 'VERIFICATION_TOKEN_INVALID');

  database.users.get(VALID.email).email_verified = false;
  await postJson(request, '/api/auth/resend-verification', { email: VALID.email });
  const latest = [...database.emailVerifications.values()].at(-1);
  latest.expires_at = new Date(Date.now() - 1000);
  const expired = await postJson(request, '/api/auth/verify-email', {
    token: tokenFromLink(mailer.verifications.at(-1).verifyLink),
  });
  assert.equal((await expired.json()).error.code, 'VERIFICATION_TOKEN_INVALID');

  const madeUp = await postJson(request, '/api/auth/verify-email', { token: 'b'.repeat(64) });
  assert.equal((await madeUp.json()).error.code, 'VERIFICATION_TOKEN_INVALID');

  const empty = await postJson(request, '/api/auth/verify-email', {});
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, 'VALIDATION_ERROR');
});

test('resend-verification responde igual siempre y solo reenvía a cuentas sin verificar', async (t) => {
  const { database, mailer, request } = await setup(t);
  await postJson(request, '/api/auth/register', VALID);
  const firstToken = tokenFromLink(mailer.verifications[0].verifyLink);

  const resend = await postJson(request, '/api/auth/resend-verification', { email: ' LANY@example.com' });
  assert.equal(resend.status, 200);
  const { message } = (await resend.json()).data;
  assert.equal(mailer.verifications.length, 2);

  // El enlace anterior deja de servir.
  const old = await postJson(request, '/api/auth/verify-email', { token: firstToken });
  assert.equal((await old.json()).error.code, 'VERIFICATION_TOKEN_INVALID');

  const unknown = await postJson(request, '/api/auth/resend-verification', { email: 'nadie@example.com' });
  assert.equal((await unknown.json()).data.message, message);

  database.users.get(VALID.email).email_verified = true;
  const already = await postJson(request, '/api/auth/resend-verification', { email: VALID.email });
  assert.equal((await already.json()).data.message, message);
  assert.equal(mailer.verifications.length, 2);

  const missing = await postJson(request, '/api/auth/resend-verification', {});
  assert.equal(missing.status, 400);
});

test('si el correo falla, el registro se completa igual (el usuario puede pedir el reenvío)', async (t) => {
  const failing = {
    async sendEmailVerification() { throw new Error('SMTP caído'); },
    async sendPasswordReset() {},
  };
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });

  const { database, request } = await setup(t, { mailer: failing });
  const response = await postJson(request, '/api/auth/register', VALID);
  assert.equal(response.status, 201);
  assert.equal(database.users.size, 1);
});

test('el correo HTML escapa el nombre del usuario e incluye el enlace', () => {
  const link = 'http://localhost:5173/verify-email?token=abc';
  const { subject, text, html } = emailVerificationMessage('<script>alert(1)</script>', link);
  assert.match(subject, /Verifica tu correo/);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="http:\/\/localhost:5173\/verify-email\?token=abc"/);
  assert.match(text, /verify-email\?token=abc/);
});

test('configuración SMTP: todas las variables o ninguna, y obligatoria en producción', () => {
  const smtp = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'a@b.co' };
  assert.equal(readEnv({}).smtp, null);
  assert.equal(readEnv({ SMTP_HOST: '', SMTP_PORT: '' }).smtp, null);
  assert.deepEqual({ ...readEnv(smtp).smtp }, { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p', from: 'a@b.co' });
  assert.throws(() => readEnv({ ...smtp, SMTP_PASS: '' }), /SMTP_PASS/);
  assert.throws(() => readEnv({ ...smtp, SMTP_PORT: 'abc' }), /SMTP_PORT/);
  const secret = 'x'.repeat(32);
  assert.throws(() => readEnv({ NODE_ENV: 'production', JWT_SECRET: secret }), /SMTP/);
  assert.equal(readEnv({ NODE_ENV: 'production', JWT_SECRET: secret, ...smtp }).smtp.port, 587);
});
