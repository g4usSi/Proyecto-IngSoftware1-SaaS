import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDatabase, postJson, withApi } from './helpers/fake-auth-database.js';

const ADMIN = { name: 'Admin Uno', email: 'admin@example.com', password: 'Clave#Admin1' };
const CLIENT = { name: 'Lany Pérez', email: 'lany@example.com', password: 'Clave#Segura1' };
const MISSING_ID = '3f1c1c1e-0000-4000-8000-999999999999';

async function login(request, { email, password }) {
  const response = await postJson(request, '/api/auth/login', { email, password });
  assert.equal(response.status, 200);
  return (await response.json()).data.token;
}

// Un admin y un cliente con sesión iniciada, más dos cuentas extra para buscar.
async function adminApp(t) {
  const database = createFakeDatabase();
  const request = await withApi(t, database);
  for (const account of [ADMIN, CLIENT]) {
    assert.equal((await postJson(request, '/api/auth/register', account)).status, 201);
    database.users.get(account.email).email_verified = true;
  }
  database.users.get(ADMIN.email).role = 'admin';
  database.addUser({ name: 'Geovanny Ruiz', email: 'geo@example.com', password_hash: 'x', created_at: new Date('2026-09-25T12:00:00Z') });
  database.addUser({ name: 'Elden 100%', email: 'elden@example.com', password_hash: 'x', active: false, created_at: new Date('2026-09-26T12:00:00Z') });

  const adminToken = await login(request, ADMIN);
  const clientToken = await login(request, CLIENT);
  const as = (token) => ({
    get: (path) => request(path, { headers: { Authorization: `Bearer ${token}` } }),
    patch: (path, body) => request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  });
  return { database, request, admin: as(adminToken), client: as(clientToken), clientToken };
}

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

test('el admin lista usuarios con paginación y sin password_hash', async (t) => {
  const { admin } = await adminApp(t);

  const response = await admin.get('/api/admin/users');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.total, 4);
  assert.equal(body.data.page, 1);
  assert.equal(body.data.pageSize, 20);
  assert.equal(body.data.items.length, 4);
  assert.deepEqual(Object.keys(body.data.items[0]).sort(),
    ['active', 'createdAt', 'email', 'emailVerified', 'id', 'name', 'role']);
  assert.doesNotMatch(JSON.stringify(body), /password/i);

  const page2 = await (await admin.get('/api/admin/users?page=2&pageSize=3')).json();
  assert.equal(page2.data.total, 4);
  assert.equal(page2.data.items.length, 1);
});

test('el admin busca por nombre o correo y filtra por estado', async (t) => {
  const { admin } = await adminApp(t);
  const emails = async (query) => (await (await admin.get(`/api/admin/users?${query}`)).json()).data.items.map((user) => user.email);

  assert.deepEqual(await emails('q=GEOVANNY'), ['geo@example.com']);
  assert.deepEqual(await emails('q=lany%40example'), ['lany@example.com']);
  assert.deepEqual(await emails('status=inactive'), ['elden@example.com']);
  assert.equal((await emails('status=active')).length, 3);
  // "%" se busca como texto, no como comodín.
  assert.deepEqual(await emails('q=100%25'), ['elden@example.com']);
  assert.deepEqual(await emails('q=%25'), ['elden@example.com']);
});

test('la búsqueda valida sus parámetros', async (t) => {
  const { admin } = await adminApp(t);
  const cases = [
    ['status=borrado', 'El parámetro status debe ser active, inactive o all.'],
    ['page=0', 'El parámetro page debe ser un número entero mayor que 0.'],
    ['page=abc', 'El parámetro page debe ser un número entero mayor que 0.'],
    ['pageSize=101', 'El parámetro pageSize no puede superar 100.'],
    ['q=a&q=b', 'El parámetro q debe ser texto.'],
  ];
  for (const [query, message] of cases) {
    assert.deepEqual(await errorOf(await admin.get(`/api/admin/users?${query}`)), { status: 400, code: 'VALIDATION_ERROR', message });
  }
});

test('el admin ve el detalle de un usuario', async (t) => {
  const { database, admin } = await adminApp(t);
  const client = database.users.get(CLIENT.email);

  const response = await admin.get(`/api/admin/users/${client.id}`);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.email, CLIENT.email);
  assert.equal(data.role, 'client');

  assert.deepEqual(await errorOf(await admin.get(`/api/admin/users/${MISSING_ID}`)),
    { status: 404, code: 'USER_NOT_FOUND', message: 'El usuario no existe.' });
  assert.deepEqual(await errorOf(await admin.get('/api/admin/users/no-es-uuid')),
    { status: 400, code: 'INVALID_USER_ID', message: 'El ID de usuario no es válido.' });
});

test('el admin desactiva una cuenta: su sesión y su login quedan bloqueados; al reactivarla vuelve a entrar', async (t) => {
  const { database, request, admin, client } = await adminApp(t);
  const clientId = database.users.get(CLIENT.email).id;

  const response = await admin.patch(`/api/admin/users/${clientId}/status`, { active: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.active, false);

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 403);
  assert.equal((await me.json()).error.code, 'ACCOUNT_DISABLED');
  const blocked = await postJson(request, '/api/auth/login', { email: CLIENT.email, password: CLIENT.password });
  assert.equal(blocked.status, 403);

  const reactivate = await admin.patch(`/api/admin/users/${clientId}/status`, { active: true });
  assert.equal((await reactivate.json()).data.active, true);
  assert.equal((await client.get('/api/auth/me')).status, 200);
});

test('el admin no puede desactivarse a sí mismo', async (t) => {
  const { database, admin } = await adminApp(t);
  const adminId = database.users.get(ADMIN.email).id;

  assert.deepEqual(await errorOf(await admin.patch(`/api/admin/users/${adminId}/status`, { active: false })),
    { status: 400, code: 'CANNOT_DEACTIVATE_SELF', message: 'No puedes desactivar tu propia cuenta.' });
  assert.equal(database.users.get(ADMIN.email).active, true);
});

test('cambiar el estado valida el cuerpo y el ID', async (t) => {
  const { database, admin } = await adminApp(t);
  const clientId = database.users.get(CLIENT.email).id;

  for (const body of [{}, { active: 'false' }, { active: 0 }]) {
    assert.deepEqual(await errorOf(await admin.patch(`/api/admin/users/${clientId}/status`, body)),
      { status: 400, code: 'VALIDATION_ERROR', message: 'El campo active debe ser true o false.' });
  }
  assert.equal((await errorOf(await admin.patch('/api/admin/users/123/status', { active: false }))).code, 'INVALID_USER_ID');
  assert.equal((await errorOf(await admin.patch(`/api/admin/users/${MISSING_ID}/status`, { active: false }))).status, 404);
  assert.equal(database.users.get(CLIENT.email).active, true);
});

test('un cliente recibe 403 en todas las rutas de administración', async (t) => {
  const { database, client } = await adminApp(t);
  const geoId = database.users.get('geo@example.com').id;

  for (const response of [
    await client.get('/api/admin/users'),
    await client.get(`/api/admin/users/${geoId}`),
    await client.patch(`/api/admin/users/${geoId}/status`, { active: false }),
  ]) {
    assert.deepEqual(await errorOf(response), { status: 403, code: 'FORBIDDEN', message: 'No tienes permiso para realizar esta acción.' });
  }
  assert.equal(database.users.get('geo@example.com').active, true);
});

test('las rutas de administración exigen iniciar sesión', async (t) => {
  const { request } = await adminApp(t);
  const response = await request('/api/admin/users');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
});
