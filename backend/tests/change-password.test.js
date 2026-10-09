import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFakeDatabase, createFakeMailer, postJson, tokenFromLink, withApi,
} from './helpers/fake-auth-database.js';

const VALID = { name: 'Lany Pérez', email: 'lany@example.com', password: 'Clave#Segura1' };
const NEW_PASSWORD = 'OtraClave#9';

// Cuenta registrada, verificada y con sesión iniciada.
async function loggedInApp(t) {
  const database = createFakeDatabase();
  const mailer = createFakeMailer();
  const request = await withApi(t, database, { mailer });
  assert.equal((await postJson(request, '/api/auth/register', VALID)).status, 201);
  database.users.get(VALID.email).email_verified = true;
  const login = await postJson(request, '/api/auth/login', { email: VALID.email, password: VALID.password });
  const { token } = (await login.json()).data;
  const change = (body) => postJson(request, '/api/auth/change-password', body, { Authorization: `Bearer ${token}` });
  return { database, request, mailer, token, change };
}

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

test('change-password con la contraseña actual correcta cambia la contraseña', async (t) => {
  const { request, token, change } = await loggedInApp(t);

  const response = await change({ currentPassword: VALID.password, newPassword: NEW_PASSWORD });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, { changed: true });
  assert.doesNotMatch(JSON.stringify(body), /password_hash|scrypt/i);

  const oldLogin = await postJson(request, '/api/auth/login', { email: VALID.email, password: VALID.password });
  assert.equal(oldLogin.status, 401);
  const newLogin = await postJson(request, '/api/auth/login', { email: VALID.email, password: NEW_PASSWORD });
  assert.equal(newLogin.status, 200);

  // La sesión con la que se hizo el cambio sigue activa.
  const me = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
});

test('change-password exige iniciar sesión', async (t) => {
  const { request } = await loggedInApp(t);
  const response = await postJson(request, '/api/auth/change-password', { currentPassword: VALID.password, newPassword: NEW_PASSWORD });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
});

test('change-password rechaza una contraseña actual incorrecta con 400 (no cierra la sesión)', async (t) => {
  const { database, change } = await loggedInApp(t);
  const before = database.users.get(VALID.email).password_hash;

  const error = await errorOf(await change({ currentPassword: 'Incorrecta#1', newPassword: NEW_PASSWORD }));
  assert.deepEqual(error, {
    status: 400, code: 'INVALID_CURRENT_PASSWORD', message: 'La contraseña actual es incorrecta.',
  });
  assert.equal(database.users.get(VALID.email).password_hash, before);
});

test('change-password valida los campos y la política de la nueva contraseña', async (t) => {
  const { change } = await loggedInApp(t);
  const cases = [
    [{ newPassword: NEW_PASSWORD }, 'La contraseña actual es obligatoria.'],
    [{ currentPassword: VALID.password }, 'La nueva contraseña es obligatoria.'],
    [{ currentPassword: VALID.password, newPassword: 'debil' }, 'La contraseña debe tener al menos 8 caracteres.'],
    [{ currentPassword: VALID.password, newPassword: 'sinsimbolo1A' }, 'La contraseña debe incluir un símbolo.'],
    [{ currentPassword: VALID.password, newPassword: VALID.password }, 'La nueva contraseña debe ser distinta de la actual.'],
  ];
  for (const [body, message] of cases) {
    assert.deepEqual(await errorOf(await change(body)), { status: 400, code: 'VALIDATION_ERROR', message });
  }
});

test('change-password bloquea tras 5 intentos fallidos, igual que el login', async (t) => {
  const { request, change } = await loggedInApp(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await change({ currentPassword: `Incorrecta#${i}`, newPassword: NEW_PASSWORD })).status, 400);
  }
  const locked = await change({ currentPassword: VALID.password, newPassword: NEW_PASSWORD });
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).error.code, 'TOO_MANY_ATTEMPTS');

  // El bloqueo es por cuenta: también impide el login.
  const login = await postJson(request, '/api/auth/login', { email: VALID.email, password: VALID.password });
  assert.equal(login.status, 429);
});

test('change-password invalida los enlaces de recuperación pendientes', async (t) => {
  const { request, mailer, change } = await loggedInApp(t);
  await postJson(request, '/api/auth/forgot-password', { email: VALID.email });
  const resetToken = tokenFromLink(mailer.resets[0].resetLink);

  assert.equal((await change({ currentPassword: VALID.password, newPassword: NEW_PASSWORD })).status, 200);

  const reset = await postJson(request, '/api/auth/reset-password', { token: resetToken, password: 'Tercera#Clave1' });
  assert.equal(reset.status, 400);
  assert.equal((await reset.json()).error.code, 'RESET_TOKEN_INVALID');
});

test('change-password usa una sola consulta para cambiar la contraseña e invalidar los enlaces', async (t) => {
  const { database, change } = await loggedInApp(t);
  const before = database.calls.length;
  assert.equal((await change({ currentPassword: VALID.password, newPassword: NEW_PASSWORD })).status, 200);

  const writes = database.calls.slice(before).filter(({ sql }) => /UPDATE/i.test(sql));
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /UPDATE users SET password_hash/);
  assert.match(writes[0].sql, /UPDATE password_reset_tokens/);
});

test('dos cambios simultáneos con la misma contraseña actual: solo uno se aplica', async (t) => {
  const { request, change } = await loggedInApp(t);
  const candidates = ['Primera#Nueva1', 'Segunda#Nueva2'];

  const responses = await Promise.all(candidates.map((newPassword) => change({ currentPassword: VALID.password, newPassword })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  const rejected = responses.find((response) => response.status === 400);
  assert.equal((await rejected.json()).error.code, 'INVALID_CURRENT_PASSWORD');

  const winner = candidates[responses.findIndex((response) => response.status === 200)];
  const loser = candidates.find((candidate) => candidate !== winner);
  assert.equal((await postJson(request, '/api/auth/login', { email: VALID.email, password: winner })).status, 200);
  assert.equal((await postJson(request, '/api/auth/login', { email: VALID.email, password: loser })).status, 401);
});
