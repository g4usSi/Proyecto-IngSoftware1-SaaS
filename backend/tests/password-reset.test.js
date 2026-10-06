import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFakeDatabase, createFakeMailer, postJson, tokenFromLink, withApi,
} from './helpers/fake-auth-database.js';

const VALID = { name: 'Lany Pérez', email: 'lany@example.com', password: 'Clave#Segura1' };
const NEW_PASSWORD = 'OtraClave#9';
const GENERIC_MESSAGE = /Si el correo está registrado/;

// Cuenta registrada y ya verificada, para poder probar el login después del cambio.
async function registeredApp(t) {
  const database = createFakeDatabase();
  const mailer = createFakeMailer();
  const request = await withApi(t, database, { mailer });
  assert.equal((await postJson(request, '/api/auth/register', VALID)).status, 201);
  database.users.get(VALID.email).email_verified = true;
  // `sent` = solo los correos de recuperación.
  return { database, request, mailer: { sent: mailer.resets } };
}

test('forgot-password con un correo registrado genera un enlace de un solo uso y envía el correo', async (t) => {
  const { database, request, mailer } = await registeredApp(t);

  const response = await postJson(request, '/api/auth/forgot-password', { email: 'LANY@Example.com ' });
  assert.equal(response.status, 200);
  assert.match((await response.json()).data.message, GENERIC_MESSAGE);

  assert.equal(mailer.sent.length, 1);
  const [message] = mailer.sent;
  assert.equal(message.to, 'lany@example.com');
  assert.match(message.resetLink, /^http:\/\/localhost:5173\/reset-password\?token=[a-f0-9]{64}$/);

  assert.equal(database.passwordResets.size, 1);
  const [record] = database.passwordResets.values();
  assert.notEqual(record.token_hash, tokenFromLink(message.resetLink));
  assert.equal(record.used_at, null);
});

test('forgot-password con un correo inexistente responde igual y no envía nada (no revela si existe)', async (t) => {
  const { mailer, request } = await registeredApp(t);

  const response = await postJson(request, '/api/auth/forgot-password', { email: 'nadie@example.com' });
  assert.equal(response.status, 200);
  assert.match((await response.json()).data.message, GENERIC_MESSAGE);
  assert.equal(mailer.sent.length, 0);
});

test('forgot-password responde igual si el envío del correo falla (no revela si la cuenta existe)', async (t) => {
  const database = createFakeDatabase();
  database.addUser({ name: VALID.name, email: VALID.email, email_verified: true });
  let attempts = 0;
  const mailer = {
    async sendPasswordReset() { attempts += 1; throw new Error('SMTP caído'); },
    async sendEmailVerification() {},
  };
  const logged = t.mock.method(console, 'error', () => {});
  const request = await withApi(t, database, { mailer });

  const existing = await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const missing = await postJson(request, '/api/auth/forgot-password', { email: 'nadie@example.com' });

  assert.equal(existing.status, 200);
  assert.equal(missing.status, 200);
  assert.deepEqual(await existing.json(), await missing.json());
  assert.equal(attempts, 1);
  assert.equal(logged.mock.callCount(), 1);
});

test('forgot-password no espera al servidor de correo para responder', async (t) => {
  const database = createFakeDatabase();
  database.addUser({ name: VALID.name, email: VALID.email, email_verified: true });
  // Un envío que nunca termina: si la respuesta lo esperara, la petición no volvería.
  const mailer = { sendPasswordReset: () => new Promise(() => {}), async sendEmailVerification() {} };
  const request = await withApi(t, database, { mailer });

  const response = await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  assert.equal(response.status, 200);
  assert.match((await response.json()).data.message, GENERIC_MESSAGE);
});

test('forgot-password exige el correo', async (t) => {
  const { request } = await registeredApp(t);
  const response = await postJson(request, '/api/auth/forgot-password', {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('reset-password con un token válido cambia la contraseña y consume el token', async (t) => {
  const { database, request, mailer } = await registeredApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const token = tokenFromLink(mailer.sent[0].resetLink);

  const reset = await postJson(request, '/api/auth/reset-password', { token, password: NEW_PASSWORD });
  assert.equal(reset.status, 200);
  assert.deepEqual((await reset.json()).data, { reset: true });

  const oldLogin = await postJson(request, '/api/auth/login', { email: VALID.email, password: VALID.password });
  assert.equal(oldLogin.status, 401);
  const newLogin = await postJson(request, '/api/auth/login', { email: VALID.email, password: NEW_PASSWORD });
  assert.equal(newLogin.status, 200);

  const [record] = database.passwordResets.values();
  assert.notEqual(record.used_at, null);

  const reuse = await postJson(request, '/api/auth/reset-password', { token, password: 'OtraClave#8' });
  assert.equal(reuse.status, 400);
  assert.equal((await reuse.json()).error.code, 'RESET_TOKEN_INVALID');
});

test('reset-password gasta el enlace y cambia la contraseña en una sola consulta', async (t) => {
  const { database, request, mailer } = await registeredApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const token = tokenFromLink(mailer.sent[0].resetLink);

  const before = database.calls.length;
  const reset = await postJson(request, '/api/auth/reset-password', { token, password: NEW_PASSWORD });
  assert.equal(reset.status, 200);

  const queries = database.calls.slice(before);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE password_reset_tokens/);
  assert.match(queries[0].sql, /UPDATE users SET password_hash/);
});

test('dos reset-password simultáneos con el mismo enlace: solo uno cambia la contraseña', async (t) => {
  const { request, mailer } = await registeredApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const token = tokenFromLink(mailer.sent[0].resetLink);

  const responses = await Promise.all([
    postJson(request, '/api/auth/reset-password', { token, password: NEW_PASSWORD }),
    postJson(request, '/api/auth/reset-password', { token, password: 'OtraClave#8' }),
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 400]);

  const rejected = responses.find((response) => response.status === 400);
  assert.equal((await rejected.json()).error.code, 'RESET_TOKEN_INVALID');

  // La contraseña que quedó es la de la petición que ganó, y solo esa.
  const winner = responses[0].status === 200 ? NEW_PASSWORD : 'OtraClave#8';
  const loser = winner === NEW_PASSWORD ? 'OtraClave#8' : NEW_PASSWORD;
  assert.equal((await postJson(request, '/api/auth/login', { email: VALID.email, password: winner })).status, 200);
  assert.equal((await postJson(request, '/api/auth/login', { email: VALID.email, password: loser })).status, 401);
});

test('reset-password rechaza un token desconocido, vencido o inventado con el mismo error', async (t) => {
  const { database, request, mailer } = await registeredApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const [record] = database.passwordResets.values();
  record.expires_at = new Date(Date.now() - 1000); // simula que venció

  const expired = await postJson(request, '/api/auth/reset-password', { token: tokenFromLink(mailer.sent[0].resetLink), password: NEW_PASSWORD });
  assert.equal(expired.status, 400);
  assert.equal((await expired.json()).error.code, 'RESET_TOKEN_INVALID');

  const madeUp = await postJson(request, '/api/auth/reset-password', { token: 'a'.repeat(64), password: NEW_PASSWORD });
  assert.equal(madeUp.status, 400);
  assert.equal((await madeUp.json()).error.code, 'RESET_TOKEN_INVALID');
});

test('reset-password valida la contraseña nueva con la misma política del registro', async (t) => {
  const { request, mailer } = await registeredApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const token = tokenFromLink(mailer.sent[0].resetLink);

  const response = await postJson(request, '/api/auth/reset-password', { token, password: 'debil' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('una segunda solicitud de recuperación invalida el enlace anterior', async (t) => {
  const { database, request, mailer } = await registeredApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const firstToken = tokenFromLink(mailer.sent[0].resetLink);

  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  assert.equal(database.passwordResets.size, 2);

  const response = await postJson(request, '/api/auth/reset-password', { token: firstToken, password: NEW_PASSWORD });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'RESET_TOKEN_INVALID');
});
