import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { createQuotasRepository } from '../src/modules/quotas/quotas.repository.js';
import { createQuotasService } from '../src/modules/quotas/quotas.service.js';

const run = promisify(execFile);
const migrationDirectory = new URL('../migrations/', import.meta.url);
const integrationOptions = {
  skip: !process.env.TEST_DATABASE_URL && 'Configura TEST_DATABASE_URL para probar el catálogo con PostgreSQL real.',
  timeout: 120000,
};

async function fixture(t, { legacy = false, includePaid = false } = {}) {
  const schema = `paid_plans_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  let database;
  let server;
  let created = false;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await database?.end();
    try {
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const connection = new URL(process.env.TEST_DATABASE_URL);
  connection.searchParams.set('options', `-c search_path=${schema},public`);
  database = new pg.Pool({ connectionString: connection.toString(), max: 4 });

  async function migrate() {
    return run(process.execPath, [fileURLToPath(new URL('../scripts/migrate.js', import.meta.url))], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: connection.toString() },
      timeout: 60000,
      windowsHide: true,
    });
  }

  if (legacy) {
    // Reproduce el esquema y los checksums publicados antes del catálogo pagado.
    await database.query(`CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const names = (await readdir(migrationDirectory))
      .filter((name) => /^\d+[-_].*\.sql$/.test(name) && name < (includePaid ? '009_' : '008_')).sort();
    for (const name of names) {
      const sql = (await readFile(new URL(name, migrationDirectory), 'utf8')).replace(/\r\n/g, '\n');
      await database.query(sql);
      await database.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)',
        [name, createHash('sha256').update(sql).digest('hex')]);
    }
  } else {
    await migrate();
  }

  async function requestCatalog() {
    if (!server) {
      server = createApp({ database, jwtSecret: 'paid-plans-test-secret-with-at-least-thirty-two-characters' })
        .listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
    return fetch(`http://127.0.0.1:${server.address().port}/api/plans`);
  }

  const quotas = createQuotasService(createQuotasRepository(database));
  async function subscribe(code) {
    const { rows: [user] } = await database.query(`
      INSERT INTO users(name, email, password_hash) VALUES ('Plan test', $1, '!test') RETURNING id
    `, [`${randomUUID()}@plans.test`]);
    await database.query('INSERT INTO subscriptions(user_id, plan_id) SELECT $1, id FROM plans WHERE code=$2',
      [user.id, code]);
    return user.id;
  }

  return { database, migrate, requestCatalog, quotas, subscribe };
}

test('S4-01: actualizar y repetir migraciones conserva Free, suscripción, consumo y reservas', integrationOptions, async (t) => {
  const { database, migrate, subscribe, quotas } = await fixture(t, { legacy: true });
  const userId = await subscribe('free');
  const confirmed = randomUUID();
  await quotas.reserve({ userId, reservationKey: confirmed, bytes: 1000 });
  await quotas.confirm({ userId, reservationKey: confirmed });
  await quotas.reserve({ userId, reservationKey: randomUUID(), bytes: 2000 });
  const before = {};
  for (const table of ['plans', 'subscriptions', 'quota_daily_usage', 'quota_reservations']) {
    before[table] = (await database.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  }

  await migrate();
  const { rows: [free] } = await database.query("SELECT * FROM plans WHERE code='free'");
  for (const [field, value] of Object.entries(before.plans[0])) {
    assert.deepEqual(free[field === 'monthly_price_gtq' ? 'monthly_price' : field], value, field);
  }
  assert.equal(free.currency, 'USD');
  for (const table of ['subscriptions', 'quota_daily_usage', 'quota_reservations']) {
    assert.deepEqual((await database.query(`SELECT * FROM ${table} ORDER BY 1`)).rows, before[table], table);
  }
  const after = (await database.query('SELECT * FROM plans ORDER BY code')).rows;
  assert.deepEqual(after.map((plan) => plan.code), ['enterprise', 'free', 'pro', 'standard']);
  const applied = (await database.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await migrate();
  assert.deepEqual((await database.query('SELECT * FROM plans ORDER BY code')).rows, after);
  assert.deepEqual((await database.query('SELECT * FROM schema_migrations ORDER BY name')).rows, applied);
});

test('S4-01: un fallo de catálogo revierte la migración y permite reintentar', integrationOptions, async (t) => {
  const { database, migrate } = await fixture(t, { legacy: true });
  await database.query("ALTER TABLE plans ADD CONSTRAINT simulate_catalog_failure CHECK (code <> 'pro')");
  await assert.rejects(migrate(), (error) => error.stderr.includes('simulate_catalog_failure'));
  assert.deepEqual((await database.query('SELECT code FROM plans')).rows, [{ code: 'free' }]);
  assert.equal((await database.query("SELECT name FROM schema_migrations WHERE name >= '008_' ")).rowCount, 0);
  await database.query('ALTER TABLE plans DROP CONSTRAINT simulate_catalog_failure');
  await migrate();
  assert.equal((await database.query('SELECT code FROM plans')).rowCount, 4);
});

test('S4-01: ajustar el catálogo 008 conserva IDs y una cuenta Enterprise que excede 200 GB', integrationOptions, async (t) => {
  const { database, migrate, subscribe, quotas } = await fixture(t, { legacy: true, includePaid: true });
  const userId = await subscribe('enterprise');
  const hash = 'a'.repeat(64);
  await database.query(`INSERT INTO stored_objects(hash_sha256, original_size_bytes, storage_key, status)
    VALUES ($1, 220000000000, $2, 'ready')`, [hash, `aa/${hash}.webp`]);
  const { rows: [image] } = await database.query(`INSERT INTO images(user_id, object_hash, original_name)
    VALUES ($1, $2, 'historica.webp') RETURNING *`, [userId, hash]);
  const plansBefore = (await database.query('SELECT id, code FROM plans ORDER BY code')).rows;
  const subscriptionsBefore = (await database.query('SELECT * FROM subscriptions')).rows;
  await migrate();
  assert.deepEqual((await database.query('SELECT id, code FROM plans ORDER BY code')).rows, plansBefore);
  assert.deepEqual((await database.query('SELECT * FROM subscriptions')).rows, subscriptionsBefore);
  assert.deepEqual((await database.query('SELECT * FROM images')).rows, [image]);
  assert.equal((await database.query('SELECT original_size_bytes FROM stored_objects')).rows[0].original_size_bytes, '220000000000');
  assert.equal((await database.query("SELECT capacity_bytes FROM plans WHERE code='enterprise'")).rows[0].capacity_bytes, '200000000000');
  await assert.rejects(quotas.reserve({ userId, reservationKey: randomUUID(), bytes: 1 }),
    (error) => error.code === 'CAPACITY_EXCEEDED');
});

test('S4-01: GET /plans publica el catálogo real, excluye inactivos y admite catálogo vacío', integrationOptions, async (t) => {
  const { database, requestCatalog } = await fixture(t);
  const response = await requestCatalog();
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map(({ code, capacityBytes, dailyUploadLimit, dailyBytesLimit, monthlyPrice }) =>
    [code, capacityBytes, dailyUploadLimit, dailyBytesLimit, monthlyPrice]), [
    ['free', '2000000000', 10, '200000000', '0.00'],
    ['standard', '25000000000', null, '500000000', '8.00'],
    ['pro', '100000000000', null, null, '15.00'],
    ['enterprise', '200000000000', null, null, '40.00'],
  ]);
  for (const plan of data) {
    assert.equal(plan.currency, 'USD');
    assert.equal(plan.monthlyPriceGtq, null);
    assert.equal(plan.billingPeriod, plan.code === 'free' ? 'none' : 'calendar_month');
    assert.equal(plan.pricingModel, plan.code === 'enterprise' ? 'base_plus_storage' : 'fixed');
    assert.equal(plan.storagePricePerGbMonth, plan.code === 'enterprise' ? '0.20' : null);
    assert.equal(plan.includedStorageBytes, plan.code === 'enterprise' ? '200000000000' : null);
    assert.equal(plan.storageBillingBasis, plan.code === 'enterprise' ? 'time_weighted_excess' : null);
  }
  await database.query("UPDATE plans SET active=FALSE WHERE code='pro'");
  assert.deepEqual((await (await requestCatalog()).json()).data.map((plan) => plan.code), ['free', 'standard', 'enterprise']);
  await database.query('UPDATE plans SET active=FALSE');
  const empty = await requestCatalog();
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { data: [] });
});

test('S4-01: Estándar aplica 500 MB diarios sin heredar el máximo de diez subidas de Free', integrationOptions, async (t) => {
  const { database, subscribe, quotas } = await fixture(t);
  const userId = await subscribe('standard');
  await database.query(`INSERT INTO quota_daily_usage(user_id, usage_date, upload_count, uploaded_bytes)
    VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date, 20, 499999999)`, [userId]);
  await quotas.reserve({ userId, reservationKey: randomUUID(), bytes: 1 });
  await assert.rejects(quotas.reserve({ userId, reservationKey: randomUUID(), bytes: 1 }),
    (error) => error.code === 'DAILY_BYTES_LIMIT_EXCEEDED');
});

test('S4-01: Pro y Enterprise omiten límites diarios y mantienen su capacidad incluyendo reservas', integrationOptions, async (t) => {
  const { database, subscribe, quotas } = await fixture(t);
  for (const [code, capacity] of [['pro', 100000000000n], ['enterprise', 200000000000n]]) {
    const userId = await subscribe(code);
    await database.query(`INSERT INTO quota_daily_usage(user_id, usage_date, upload_count, uploaded_bytes)
      VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date, 1000000, 900000000000)`, [userId]);
    await database.query('INSERT INTO quota_reservations(user_id, reservation_key, reserved_bytes) VALUES ($1, $2, $3)',
      [userId, randomUUID(), String(capacity - 1n)]);
    await quotas.reserve({ userId, reservationKey: randomUUID(), bytes: 1 });
    await assert.rejects(quotas.reserve({ userId, reservationKey: randomUUID(), bytes: 1 }),
      (error) => error.code === 'CAPACITY_EXCEEDED');
  }
});
