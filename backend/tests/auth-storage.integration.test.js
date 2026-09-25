import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import sharp from 'sharp';
import { createApp } from '../src/app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

test('registro Free, login JWT y subida WebP funcionan juntos en PostgreSQL', {
  skip: !testDatabaseUrl && 'Configura TEST_DATABASE_URL para ejecutar la integración real.',
  timeout: 120000,
}, async (t) => {
  const schema = `smartstorage_auth_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  let database;
  let server;
  let storageRoot;
  let schemaCreated = false;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await database?.end();
    try {
      if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
      if (storageRoot) {
        assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
        assert.match(path.basename(storageRoot), /^smartstorage-auth-test-[\w-]+$/);
        await rm(storageRoot, { recursive: true, force: true });
      }
    }
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  database = new pg.Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schema},public`, max: 4 });
  for (const name of (await readdir(migrationsDirectory)).filter((file) => /^\d+[-_].*\.sql$/.test(file)).sort()) {
    await database.query(await readFile(path.join(migrationsDirectory, name), 'utf8'));
  }
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-auth-test-'));
  server = createApp({ database, storageRoot, storageDemo: false, jwtSecret: 'test-secret-that-is-longer-than-thirty-two-characters' })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });

  const account = { name: 'Cliente real', email: 'cliente@example.test', password: 'Clave#Segura1' };
  const registered = await post('/api/auth/register', account);
  assert.equal(registered.status, 201);
  const { data: user } = await registered.json();
  const subscription = await database.query(`
    SELECT p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = $1 AND s.status = 'active'
  `, [user.id]);
  assert.deepEqual(subscription.rows.map((row) => row.code), ['free']);

  const login = await post('/api/auth/login', { email: account.email, password: account.password });
  assert.equal(login.status, 200);
  const { data: session } = await login.json();
  assert.equal(session.user.id, user.id);
  const auth = { Authorization: `Bearer ${session.token}` };
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: auth })).status, 200);

  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#3678bb' } }).png().toBuffer();
  const body = new FormData();
  body.append('file', new Blob([png], { type: 'image/png' }), 'prueba.png');
  const uploaded = await fetch(`${base}/api/files`, { method: 'POST', headers: auth, body });
  assert.equal(uploaded.status, 201, JSON.stringify(await uploaded.clone().json()));
  const { data: saved } = await uploaded.json();
  assert.ok(saved.image.id);
  const downloaded = await fetch(`${base}/api/files/${saved.image.id}/download`, { headers: auth });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/webp');

  const demoUser = await database.query(`
    INSERT INTO users (name, email, password_hash) VALUES ('Demo', 'demo@example.test', '!disabled:storage-demo') RETURNING id
  `);
  const demoLogin = await post('/api/auth/login', { email: 'demo@example.test', password: 'cualquier-cosa' });
  assert.equal(demoLogin.status, 401);
  assert.ok(demoUser.rows[0].id);

  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: auth });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${base}/api/files`, { headers: auth })).status, 401);
});
