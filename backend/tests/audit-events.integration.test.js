// RF-AUT-12 / RNF-AUT-10: bitácora de autenticación consultable por el administrador (PostgreSQL real).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { createFakeMailer, tokenFromLink } from './helpers/fake-auth-database.js';

const run = promisify(execFile);
const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere TEST_DATABASE_URL.', timeout: 90000 };
const PASSWORD = 'Clave#Segura1';

async function fixture(t) {
  const schema = `audit_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  let database; let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await database?.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const connection = new URL(process.env.TEST_DATABASE_URL);
  connection.searchParams.set('options', `-c search_path=${schema},public`);
  database = new pg.Pool({ connectionString: connection.toString(), max: 4 });
  await run(process.execPath, [fileURLToPath(new URL('../scripts/migrate.js', import.meta.url))],
    { env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: connection.toString() }, timeout: 60000 });
  const mailer = createFakeMailer();
  server = createApp({ database, mailer, jwtSecret: 'audit-test-secret-with-at-least-thirty-two-characters' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (route, { method = 'GET', body, token } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'User-Agent': 'prueba-auditoria' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  async function account(name, role = 'client') {
    const email = `${randomUUID()}@audit.test`;
    const created = await call('/auth/register', { method: 'POST', body: { name, email, password: PASSWORD } });
    assert.equal(created.status, 201);
    await call('/auth/verify-email', { method: 'POST', body: { token: tokenFromLink(mailer.verifications.at(-1).verifyLink) } });
    if (role === 'admin') await database.query("UPDATE users SET role='admin' WHERE email=$1", [email]);
    const login = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
    return { id: created.body.data.id, email, token: login.body.data.token };
  }
  return { database, call, account };
}

test('RF-AUT-12: registra inicio, fallos, cierre de sesión y cambio de contraseña', options, async (t) => {
  const { database, call, account } = await fixture(t);
  const user = await account('Cliente');
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: user.email, password: 'Incorrecta#1' } })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'nadie@audit.test', password: 'Incorrecta#1' } })).status, 401);
  const changed = await call('/auth/change-password', { method: 'POST', token: user.token, body: { currentPassword: PASSWORD, newPassword: 'Otra#Clave2' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('/auth/logout', { method: 'POST', token: user.token })).status, 200);

  const { rows } = await database.query('SELECT event_type, user_id, email, detail, user_agent FROM auth_events ORDER BY id');
  assert.deepEqual(rows.map((r) => r.event_type), ['login_success', 'login_failed', 'login_failed', 'password_changed', 'logout']);
  assert.equal(rows[1].user_id, user.id);
  assert.deepEqual(rows[1].detail, { reason: 'invalid_credentials' });
  assert.equal(rows[2].user_id, null, 'un correo inexistente no enlaza ninguna cuenta');
  assert.equal(rows[2].email, 'nadie@audit.test');
  assert.equal(rows[0].user_agent, 'prueba-auditoria');
  const stored = JSON.stringify(rows);
  assert.ok(!stored.includes(PASSWORD) && !stored.includes('Otra#Clave2') && !stored.includes('Incorrecta#1'), 'la bitácora no guarda contraseñas');
});

test('RF-AUT-12: el administrador consulta, filtra y pagina; el cliente no puede', options, async (t) => {
  const { database, call, account } = await fixture(t);
  const boss = await account('Admin', 'admin');
  const user = await account('Cliente');
  await call('/auth/login', { method: 'POST', body: { email: user.email, password: 'Incorrecta#1' } });

  assert.equal((await call('/admin/audit-events')).status, 401);
  assert.equal((await call('/admin/audit-events', { token: user.token })).status, 403);

  const all = await call('/admin/audit-events', { token: boss.token });
  assert.equal(all.status, 200);
  assert.equal(all.body.data.total, '3', 'dos inicios de sesión exitosos y un fallo');
  assert.equal(all.body.data.items[0].type, 'login_failed', 'del más reciente al más antiguo');
  assert.ok(all.body.data.items.every((e) => !('password' in e) && !('passwordHash' in e)));

  const failed = await call('/admin/audit-events?type=login_failed', { token: boss.token });
  assert.equal(failed.body.data.items.length, 1);
  assert.equal(failed.body.data.items[0].email, user.email);

  const byUser = await call(`/admin/audit-events?userId=${user.id}&limit=1&offset=1`, { token: boss.token });
  assert.equal(byUser.body.data.total, '2');
  assert.equal(byUser.body.data.items.length, 1);

  const bySearch = await call(`/admin/audit-events?search=${encodeURIComponent(user.email.slice(0, 8))}`, { token: boss.token });
  assert.equal(bySearch.body.data.total, '2');

  for (const bad of ['type=otro', 'userId=123', 'limit=0', 'limit=101', 'offset=-1', 'extra=1', 'type=a&type=b']) {
    const response = await call(`/admin/audit-events?${bad}`, { token: boss.token });
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error.code, 'INVALID_AUDIT_QUERY');
  }
  const { rows } = await database.query('SELECT count(*)::int AS n FROM auth_events');
  assert.equal(rows[0].n, 3, 'consultar la bitácora no genera eventos');
});

test('RF-AUT-09/12: desactivar y reactivar una cuenta deja al administrador como actor', options, async (t) => {
  const { database, call, account } = await fixture(t);
  const boss = await account('Admin', 'admin');
  const user = await account('Cliente');
  const off = await call(`/admin/users/${user.id}/status`, { method: 'PATCH', token: boss.token, body: { active: false } });
  assert.equal(off.status, 200);
  const blocked = await call('/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD } });
  assert.equal(blocked.body.error.code, 'ACCOUNT_DISABLED');
  await call(`/admin/users/${user.id}/status`, { method: 'PATCH', token: boss.token, body: { active: true } });

  const { rows } = await database.query(
    "SELECT user_id, actor_id, detail FROM auth_events WHERE event_type='account_status_changed' ORDER BY id");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.user_id === user.id && r.actor_id === boss.id));
  assert.deepEqual(rows.map((r) => r.detail.active), [false, true]);
  const failed = await database.query("SELECT detail FROM auth_events WHERE event_type='login_failed'");
  assert.deepEqual(failed.rows[0].detail, { reason: 'account_disabled' });
});

test('RF-AUT-12: si la bitácora falla, el inicio de sesión sigue funcionando', options, async (t) => {
  const { database, call, account } = await fixture(t);
  const user = await account('Cliente');
  await database.query('ALTER TABLE auth_events RENAME TO auth_events_roto');
  const login = await call('/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD } });
  assert.equal(login.status, 200);
});
