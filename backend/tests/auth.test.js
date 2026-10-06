import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { passwordProblems } from '../src/modules/auth/auth.validation.js';
import { createFakeDatabase, postJson, withApi } from './helpers/fake-auth-database.js';

const VALID = { name: '  Lany Pérez ', email: '  Lany@Example.COM ', password: 'Clave#Segura1' };

function register(request, body) {
  return postJson(request, '/api/auth/register', body);
}

test('registro crea una cuenta activa, normaliza datos y nunca expone ni guarda la contraseña en claro', async (t) => {
  const database = createFakeDatabase();
  const request = await withApi(t, database);

  const response = await register(request, VALID);
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.deepEqual(data, {
    id: '3f1c1c1e-0000-4000-8000-000000000001', name: 'Lany Pérez', email: 'lany@example.com',
    role: 'client', active: true, emailVerified: false, createdAt: '2026-09-24T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(data).includes('password'), false);

  const stored = database.users.get('lany@example.com');
  assert.equal(database.subscriptions.get(stored.id), 'free');
  assert.notEqual(stored.password_hash, VALID.password);
  assert.equal(stored.password_hash.includes(VALID.password), false);
  assert.equal(await verifyPassword(VALID.password, stored.password_hash), true);
});

test('registro rechaza un correo ya registrado (aunque cambien mayúsculas o espacios)', async (t) => {
  const request = await withApi(t, createFakeDatabase());
  assert.equal((await register(request, VALID)).status, 201);

  const again = await register(request, { ...VALID, email: 'LANY@example.com ' });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error.code, 'EMAIL_ALREADY_REGISTERED');
});

test('registro traduce la violación UNIQUE de Postgres (registros simultáneos) a 409', async (t) => {
  const request = await withApi(t, createFakeDatabase({ failInsertWith: '23505' }));
  const response = await register(request, VALID);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'EMAIL_ALREADY_REGISTERED');
});

test('registro no crea cuentas sin un plan Free activo', async (t) => {
  const database = createFakeDatabase({ freePlanActive: false });
  const request = await withApi(t, database);
  const response = await register(request, VALID);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'FREE_PLAN_UNAVAILABLE');
  assert.equal(database.users.size, 0);
  assert.equal(database.subscriptions.size, 0);
});

test('registro valida campos obligatorios, correo y contraseña sin tocar la base de datos', async (t) => {
  const database = createFakeDatabase();
  const request = await withApi(t, database);
  const cases = [
    [{}, /nombre es obligatorio/],
    [{ ...VALID, name: '   ' }, /nombre es obligatorio/],
    [{ ...VALID, name: 'x'.repeat(121) }, /nombre no puede superar/],
    [{ ...VALID, email: undefined }, /correo electrónico es obligatorio/],
    [{ ...VALID, email: 'no-es-un-correo' }, /formato del correo/],
    [{ ...VALID, email: 'a b@example.com' }, /formato del correo/],
    [{ ...VALID, password: undefined }, /contraseña es obligatoria/],
    [{ ...VALID, password: 12345678 }, /contraseña es obligatoria/],
    [{ ...VALID, password: 'Ab1#' }, /al menos 8/],
    [{ ...VALID, password: 'CLAVE#SEGURA1' }, /minúscula/],
    [{ ...VALID, password: 'clave#segura1' }, /mayúscula/],
    [{ ...VALID, password: 'Clave#Segura' }, /número/],
    [{ ...VALID, password: 'ClaveSegura1' }, /símbolo/],
  ];
  for (const [body, message] of cases) {
    const response = await register(request, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    const { error } = await response.json();
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.match(error.message, message);
  }
  // Sin cuerpo JSON también es un 400 controlado, no un error interno.
  const empty = await request('/api/auth/register', { method: 'POST' });
  assert.equal(empty.status, 400);
  assert.equal(database.calls.length, 0);
});

test('política de contraseñas acepta una contraseña válida', () => {
  assert.deepEqual(passwordProblems('Clave#Segura1'), []);
  assert.equal(passwordProblems('Aa1#' + 'x'.repeat(125)).length, 1);
});

test('hash de contraseña usa sal única y verifica sin aceptar contraseñas incorrectas', async () => {
  const first = await hashPassword('Clave#Segura1');
  const second = await hashPassword('Clave#Segura1');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('Clave#Segura1', first), true);
  assert.equal(await verifyPassword('otra-clave', first), false);
  assert.equal(await verifyPassword('Clave#Segura1', 'formato-invalido'), false);
  for (const invalid of ['!disabled:storage-demo', 'x:y', '00:ff', `${'a'.repeat(32)}:${'b'.repeat(128)}:extra`]) {
    assert.equal(await verifyPassword('Clave#Segura1', invalid), false, invalid);
  }
});

test('los errores internos del registro no filtran detalles de SQL', async (t) => {
  const request = await withApi(t, { query: async () => { throw new Error('secret database internals'); } });
  const response = await register(request, VALID);
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(await response.json()).includes('secret'), false);
});
