import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDatabase, postJson, withApi } from './helpers/fake-auth-database.js';

const VALID = { name: 'Lany Pérez', email: 'lany@example.com', password: 'Clave#Segura1' };

// Cuenta registrada, verificada y con sesión iniciada.
async function loggedInApp(t) {
  const database = createFakeDatabase();
  const request = await withApi(t, database);
  assert.equal((await postJson(request, '/api/auth/register', VALID)).status, 201);
  database.users.get(VALID.email).email_verified = true;
  const login = await postJson(request, '/api/auth/login', { email: VALID.email, password: VALID.password });
  const { token } = (await login.json()).data;
  const patchMe = (body, headers = { Authorization: `Bearer ${token}` }) => request('/api/auth/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { database, request, token, patchMe };
}

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

test('PATCH /me actualiza el nombre y devuelve el usuario público', async (t) => {
  const { database, request, token, patchMe } = await loggedInApp(t);

  const response = await patchMe({ name: '  Lany Actualizada  ' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.name, 'Lany Actualizada');
  assert.equal(body.data.email, VALID.email);
  assert.doesNotMatch(JSON.stringify(body), /password_hash|passwordHash|scrypt/i);
  assert.equal(database.users.get(VALID.email).name, 'Lany Actualizada');

  const me = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await me.json()).data.name, 'Lany Actualizada');
});

test('PATCH /me ignora el correo, el rol y el estado aunque vengan en el cuerpo', async (t) => {
  const { database, patchMe } = await loggedInApp(t);

  const response = await patchMe({
    name: 'Nuevo Nombre', email: 'otro@example.com', role: 'admin', active: false, emailVerified: false,
  });
  assert.equal(response.status, 200);
  const user = database.users.get(VALID.email);
  assert.equal(user.name, 'Nuevo Nombre');
  assert.equal(user.email, VALID.email);
  assert.equal(user.role, 'client');
  assert.equal(user.active, true);
  assert.equal(user.email_verified, true);
  assert.ok(!database.users.has('otro@example.com'));
});

test('PATCH /me valida el nombre', async (t) => {
  const { database, patchMe } = await loggedInApp(t);
  const cases = [
    [{}, 'El nombre es obligatorio.'],
    [{ name: '   ' }, 'El nombre es obligatorio.'],
    [{ name: 42 }, 'El nombre es obligatorio.'],
    [{ name: 'a'.repeat(121) }, 'El nombre no puede superar 120 caracteres.'],
  ];
  for (const [body, message] of cases) {
    assert.deepEqual(await errorOf(await patchMe(body)), { status: 400, code: 'VALIDATION_ERROR', message });
  }
  assert.equal(database.users.get(VALID.email).name, VALID.name);
});

test('PATCH /me exige iniciar sesión', async (t) => {
  const { patchMe } = await loggedInApp(t);
  const response = await patchMe({ name: 'Intruso' }, {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
});

test('PATCH /me rechaza a una cuenta desactivada con la sesión abierta', async (t) => {
  const { database, patchMe } = await loggedInApp(t);
  database.users.get(VALID.email).active = false;
  const response = await patchMe({ name: 'Otro' });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ACCOUNT_DISABLED');
});
