import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { requireRole } from '../src/middleware/require-auth.js';
import { createLoginLimiter } from '../src/modules/auth/login-limiter.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { TEST_SECRET, createFakeDatabase, postJson, withApi } from './helpers/fake-auth-database.js';

const PASSWORD = 'Clave#Segura1';

async function setup(t, options) {
  const database = createFakeDatabase();
  const user = database.addUser({
    name: 'Lany Pérez', email: 'lany@example.com', password_hash: await hashPassword(PASSWORD),
  });
  const request = await withApi(t, database, options);
  return { database, user, request };
}

function login(request, password = PASSWORD, email = 'lany@example.com') {
  return postJson(request, '/api/auth/login', { email, password });
}

function bearer(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

test('login correcto devuelve un token JWT y el usuario sin datos sensibles', async (t) => {
  const { user, request } = await setup(t);
  const response = await login(request, PASSWORD, '  LANY@example.com ');
  assert.equal(response.status, 200);
  const { data } = await response.json();

  assert.equal(data.user.id, user.id);
  assert.equal(data.user.email, 'lany@example.com');
  assert.equal(JSON.stringify(data).includes('password'), false);

  const claims = jwt.verify(data.token, TEST_SECRET, { algorithms: ['HS256'] });
  assert.equal(claims.sub, user.id);
  assert.equal(typeof claims.jti, 'string');
  assert.equal('role' in claims, false);
  assert.equal(new Date(data.expiresAt).getTime(), claims.exp * 1000);
});

test('el token permite consultar /me y la identidad sale de la BD', async (t) => {
  const { database, request } = await setup(t);
  const { data } = await (await login(request)).json();

  const me = await request('/api/auth/me', bearer(data.token));
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.email, 'lany@example.com');

  // Un cambio de rol en la BD se refleja de inmediato: el token no lleva el rol.
  database.users.get('lany@example.com').role = 'admin';
  const again = await request('/api/auth/me', bearer(data.token));
  assert.equal((await again.json()).data.role, 'admin');
});

test('credenciales incorrectas y correo inexistente dan la misma respuesta 401', async (t) => {
  const { request } = await setup(t);
  const wrongPassword = await login(request, 'Otra#Clave123');
  const unknownEmail = await login(request, PASSWORD, 'nadie@example.com');
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  const first = await wrongPassword.json();
  assert.deepEqual(first, await unknownEmail.json());
  assert.equal(first.error.code, 'INVALID_CREDENTIALS');
  assert.match(first.error.message, /incorrectos/);
});

test('login valida campos obligatorios y rechaza contraseñas enormes sin hashearlas', async (t) => {
  const { database, request } = await setup(t);
  for (const body of [{}, { email: 'lany@example.com' }, { password: PASSWORD }, { email: 5, password: PASSWORD }]) {
    const response = await postJson(request, '/api/auth/login', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(database.calls.length, 0);
  assert.equal((await login(request, 'x'.repeat(5000))).status, 401);
});

test('una cuenta desactivada no puede iniciar sesión (RF10)', async (t) => {
  const { database, request } = await setup(t);
  database.users.get('lany@example.com').active = false;

  const correct = await login(request);
  assert.equal(correct.status, 403);
  assert.equal((await correct.json()).error.code, 'ACCOUNT_DISABLED');
  // Con contraseña incorrecta no se revela que la cuenta existe ni que está desactivada.
  assert.equal((await login(request, 'Otra#Clave123')).status, 401);
});

test('un token deja de servir si la cuenta se desactiva después', async (t) => {
  const { database, request } = await setup(t);
  const { data } = await (await login(request)).json();
  database.users.get('lany@example.com').active = false;
  const response = await request('/api/auth/me', bearer(data.token));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ACCOUNT_DISABLED');
});

test('logout revoca el token: deja de funcionar y queda registrado (RF03)', async (t) => {
  const { database, user, request } = await setup(t);
  const { data } = await (await login(request)).json();

  const out = await request('/api/auth/logout', { method: 'POST', ...bearer(data.token) });
  assert.equal(out.status, 200);
  assert.deepEqual((await out.json()).data, { loggedOut: true });

  const { jti } = jwt.decode(data.token);
  assert.equal(database.revoked.get(jti).user_id, user.id);

  const reuse = await request('/api/auth/me', bearer(data.token));
  assert.equal(reuse.status, 401);
  assert.equal((await reuse.json()).error.code, 'TOKEN_INVALID');
  assert.equal((await request('/api/auth/logout', { method: 'POST', ...bearer(data.token) })).status, 401);

  // Otra sesión del mismo usuario sigue activa.
  const other = await (await login(request)).json();
  assert.equal((await request('/api/auth/me', bearer(other.data.token))).status, 200);
});

test('requireAuth rechaza tokens vencidos, firmados con otro secreto, sin jti o con algoritmo none', async (t) => {
  const { user, request } = await setup(t);
  const sign = (payload, secret, options) => jwt.sign(payload, secret, { subject: user.id, ...options });

  const expired = sign({}, TEST_SECRET, { jwtid: 'a1', expiresIn: -10 });
  const expiredResponse = await request('/api/auth/me', bearer(expired));
  assert.equal(expiredResponse.status, 401);
  assert.equal((await expiredResponse.json()).error.code, 'TOKEN_EXPIRED');

  const invalid = [
    sign({}, 'otro-secreto-distinto-de-mas-de-32-caracteres', { jwtid: 'a2', expiresIn: '1h' }),
    sign({}, TEST_SECRET, { expiresIn: '1h' }), // sin jti
    jwt.sign({ sub: user.id, jti: 'a3' }, '', { algorithm: 'none' }),
    'basura.sin.formato',
  ];
  for (const token of invalid) {
    const response = await request('/api/auth/me', bearer(token));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'TOKEN_INVALID');
  }

  const wrongScheme = await request('/api/auth/me', { headers: { Authorization: 'Basic abc' } });
  assert.equal((await wrongScheme.json()).error.code, 'AUTH_REQUIRED');
});

test('un token válido de un usuario que ya no existe se rechaza', async (t) => {
  const { database, request } = await setup(t);
  const { data } = await (await login(request)).json();
  database.users.clear();
  const response = await request('/api/auth/me', bearer(data.token));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'TOKEN_INVALID');
});

test('bloquea tras 5 intentos fallidos, avisa el tiempo y se libera al pasar 15 minutos (RNF11)', async (t) => {
  let now = 1_000_000;
  const loginLimiter = createLoginLimiter({ now: () => now });
  const { request } = await setup(t, { loginLimiter });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login(request, 'Otra#Clave123')).status, 401);
  }
  // Bloqueado: ni siquiera la contraseña correcta sirve.
  const blocked = await login(request);
  assert.equal(blocked.status, 429);
  const { error } = await blocked.json();
  assert.equal(error.code, 'TOO_MANY_ATTEMPTS');
  assert.match(error.message, /15 minutos/);
  // Otro correo no se ve afectado.
  assert.equal((await login(request, PASSWORD, 'otro@example.com')).status, 401);

  now += 15 * 60 * 1000 + 1000;
  assert.equal((await login(request)).status, 200);
});

test('un inicio de sesión correcto reinicia el contador de intentos fallidos', async (t) => {
  const { request } = await setup(t, { loginLimiter: createLoginLimiter() });
  for (let attempt = 0; attempt < 4; attempt += 1) await login(request, 'Otra#Clave123');
  assert.equal((await login(request)).status, 200);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await login(request, 'Otra#Clave123')).status, 401);
  }
  assert.equal((await login(request)).status, 200);
});

test('el inicio de sesión responde en menos de 2 segundos (RNF03)', async (t) => {
  const { request } = await setup(t);
  const started = performance.now();
  assert.equal((await login(request)).status, 200);
  assert.ok(performance.now() - started < 2000);
});

test('sin JWT_SECRET la autenticación responde 503 en vez de aceptar tokens', async (t) => {
  const { request } = await setup(t, { jwtSecret: '' }); // '' y no undefined: undefined activaría el valor por defecto de createApp (el .env)
  const response = await login(request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED');
  const protectedRoute = await request('/api/auth/me', bearer('cualquiera'));
  assert.equal(protectedRoute.status, 503);
});

test('requireRole permite solo los roles indicados (RF08, RNF06)', () => {
  const adminOnly = requireRole('admin');
  const outcome = (role) => {
    let received = 'no-llamado';
    adminOnly({ user: role && { role } }, {}, (error) => { received = error; });
    return received;
  };
  assert.equal(outcome('admin'), undefined);
  assert.equal(outcome('client').status, 403);
  assert.equal(outcome('client').code, 'FORBIDDEN');
  assert.equal(outcome(undefined).status, 403);
});
