import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from 'node:child_process';
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

import { createQuotasRepository } from "../src/modules/quotas/quotas.repository.js";
import { createQuotasService } from "../src/modules/quotas/quotas.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

const integrationOptions = {
  skip:
    !testDatabaseUrl &&
    "Configura TEST_DATABASE_URL para ejecutar cuotas con PostgreSQL real.",
  timeout: 120000,
};

async function fixture(t, { legacy = false } = {}) {
  assert.ok(
    testDatabaseUrl,
    "Las pruebas requieren TEST_DATABASE_URL explícita.",
  );

  const schema = `smartstorage_quota_test_${randomUUID().replaceAll("-", "")}`;

  const adminConnection = new pg.Pool({
    connectionString: testDatabaseUrl,
    max: 1,
  });

  let database;

  t.after(async () => {
    await database?.end();

    try {
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await adminConnection.end();
    }
  });

  await adminConnection.query(`CREATE SCHEMA "${schema}"`);

  database = new pg.Pool({
    connectionString: testDatabaseUrl,
    options: `-c search_path=${schema},public`,
    max: 8,
  });

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+[-_].*\.sql$/.test(name))
    .sort();

  for (const name of migrationNames) {
    if (legacy && name >= '006_') continue;
    const sql = await readFile(path.join(migrationsDirectory, name), "utf8");

    await database.query(sql);
  }

  const {
    rows: [user],
  } = await database.query(`
    INSERT INTO users (
      name,
      email,
      password_hash,
      role
    )
    VALUES (
      'Quota Test',
      'quota@test.local',
      'test-only-not-a-password',
      'client'
    )
    RETURNING id
  `);

  await database.query(
    `
      INSERT INTO subscriptions(user_id, plan_id)
      SELECT $1, id
      FROM plans
      WHERE code = 'free'
    `,
    [user.id],
  );

  const repository = createQuotasRepository(database);
  const service = createQuotasService(repository);

  return {
    schema,
    database,
    user,
    repository,
    service,

    async limits({ capacity = "2000000000", count = null, bytes = null } = {}) {
      await database.query(
        `
          UPDATE plans
          SET
            capacity_bytes = $1,
            daily_upload_limit = $2,
            daily_bytes_limit = $3
          WHERE code = 'free'
        `,
        [String(capacity), count, bytes === null ? null : String(bytes)],
      );
    },
  };
}

test(
  "reserva cuota y deja el trabajo pendiente",
  integrationOptions,
  async (t) => {
    const { service, user } = await fixture(t);

    const reservation = await service.reserve({
      reservationKey: randomUUID(),
      userId: user.id,
      bytes: 1024,
    });

    assert.equal(reservation.status, "pending");
    assert.equal(reservation.reserved_bytes, "1024");
  },
);

test(
  "confirmar dos veces no duplica el consumo diario",
  integrationOptions,
  async (t) => {
    const { database, service, user } = await fixture(t);

    const reservationKey = randomUUID();

    await service.reserve({
      reservationKey,
      userId: user.id,
      bytes: 1024,
    });

    await service.confirm({
      reservationKey,
      userId: user.id,
    });

    await service.confirm({
      reservationKey,
      userId: user.id,
    });

    const {
      rows: [usage],
    } = await database.query(
      `
        SELECT upload_count, uploaded_bytes
        FROM quota_daily_usage
        WHERE user_id = $1
      `,
      [user.id],
    );

    assert.equal(usage.upload_count, 1);
    assert.equal(usage.uploaded_bytes, "1024");
  },
);

test(
  "liberar dos veces es idempotente y no consume cuota diaria",
  integrationOptions,
  async (t) => {
    const { database, service, user } = await fixture(t);

    const reservationKey = randomUUID();

    await service.reserve({
      reservationKey,
      userId: user.id,
      bytes: 2048,
    });

    const first = await service.release({
      reservationKey,
      userId: user.id,
    });

    const second = await service.release({
      reservationKey,
      userId: user.id,
    });

    assert.equal(first.status, "released");
    assert.equal(second.status, "released");

    const result = await database.query(
      `
        SELECT *
        FROM quota_daily_usage
        WHERE user_id = $1
      `,
      [user.id],
    );

    assert.equal(result.rowCount, 0);
  },
);

test(
  "dos trabajos concurrentes sobre el ultimo cupo admiten solo uno",
  integrationOptions,
  async (t) => {
    const { service, user, limits } = await fixture(t);

    await limits({
      count: 1,
      bytes: null,
    });

    const results = await Promise.allSettled([
      service.reserve({
        reservationKey: randomUUID(),
        userId: user.id,
        bytes: 1,
      }),

      service.reserve({
        reservationKey: randomUUID(),
        userId: user.id,
        bytes: 1,
      }),
    ]);

    const admitted = results.filter((result) => result.status === "fulfilled");

    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(admitted.length, 1);
    assert.equal(rejected.length, 1);

    assert.equal(rejected[0].reason.code, "DAILY_UPLOAD_LIMIT_EXCEEDED");
  },
);

test(
  "permite exactamente el limite y rechaza excederlo",
  integrationOptions,
  async (t) => {
    const { service, user, limits } = await fixture(t);

    await limits({
      capacity: 1000,
      count: 10,
      bytes: 1000,
    });

    const first = await service.reserve({
      reservationKey: randomUUID(),
      userId: user.id,
      bytes: 1000,
    });

    assert.equal(first.status, "pending");

    await assert.rejects(
      service.reserve({
        reservationKey: randomUUID(),
        userId: user.id,
        bytes: 1,
      }),
      (error) =>
        error.code === "CAPACITY_EXCEEDED" ||
        error.code === "DAILY_BYTES_LIMIT_EXCEEDED",
    );
  },
);

test('S3-08: confirmación después de medianoche conserva el día reservado', integrationOptions, async (t) => {
  const f = await fixture(t);
  await f.limits({ count: 1, bytes: 1000 });
  const oldKey = randomUUID();
  await f.service.reserve({ reservationKey: oldKey, userId: f.user.id, bytes: 1000 });
  await f.database.query(`UPDATE quota_reservations SET created_at=now()-INTERVAL '1 day',
    usage_date=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date-1 WHERE reservation_key=$1`, [oldKey]);
  const todayKey = randomUUID();
  await f.service.reserve({ reservationKey: todayKey, userId: f.user.id, bytes: 1000 });
  await f.service.confirm({ reservationKey: oldKey, userId: f.user.id });
  await f.service.confirm({ reservationKey: todayKey, userId: f.user.id });
  const { rows } = await f.database.query('SELECT upload_count, uploaded_bytes FROM quota_daily_usage ORDER BY usage_date');
  assert.deepEqual(rows, [{ upload_count: 1, uploaded_bytes: '1000' }, { upload_count: 1, uploaded_bytes: '1000' }]);
});

test('S3-08: suscripción futura y plan inactivo no admiten reservas', integrationOptions, async (t) => {
  const f = await fixture(t);
  await f.database.query("UPDATE subscriptions SET started_at=now()+INTERVAL '1 day'");
  const reserve = () => f.service.reserve({ reservationKey: randomUUID(), userId: f.user.id, bytes: 1 });
  await assert.rejects(reserve(), { code: 'NO_ACTIVE_SUBSCRIPTION' });
  await f.database.query("UPDATE subscriptions SET started_at=now()-INTERVAL '1 day'");
  await f.database.query('UPDATE plans SET active=FALSE');
  await assert.rejects(reserve(), { code: 'NO_ACTIVE_SUBSCRIPTION' });
});

test('S3-08: conexiones externas conservan bloqueo y admiten un último cupo', integrationOptions, async (t) => {
  const f = await fixture(t);
  await f.limits({ count: 1 });
  const attempt = async () => {
    const client = await f.database.connect();
    try {
      await client.query('BEGIN');
      const reservation = await f.repository.reserve(client, { reservationKey: randomUUID(), userId: f.user.id, bytes: 1 });
      await client.query('COMMIT');
      return reservation;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
  const results = await Promise.allSettled([attempt(), attempt()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'DAILY_UPLOAD_LIMIT_EXCEEDED');
});

test('S3-08: rollback del llamador revierte reserva y confirmación', integrationOptions, async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  const client = await f.database.connect();
  try {
    await client.query('BEGIN');
    await f.repository.reserve(client, { reservationKey: key, userId: f.user.id, bytes: 100 });
    await f.repository.confirm(client, key, f.user.id);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_reservations')).rows[0].n, 0);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_daily_usage')).rows[0].n, 0);
});

test('S3-08: reintento UUID, conflicto y fallo/liberación no duplican consumo', integrationOptions, async (t) => {
  const f = await fixture(t);
  await f.limits({ count: 1 });
  const key = randomUUID();
  const args = { reservationKey: key, userId: f.user.id, bytes: 100 };
  const first = await f.service.reserve(args);
  assert.equal((await f.service.reserve(args)).id, first.id);
  await assert.rejects(f.service.reserve({ ...args, bytes: 101 }), { code: 'RESERVATION_CONFLICT' });
  await f.service.release(args);
  await f.service.release(args);
  await assert.rejects(f.service.confirm(args), { code: 'RESERVATION_ALREADY_RELEASED' });
  await f.service.reserve({ ...args, reservationKey: randomUUID() });
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_daily_usage')).rows[0].n, 0);
});

for (const bound of [
  { limits: { capacity: 1000 }, code: 'CAPACITY_EXCEEDED' },
  { limits: { capacity: 10000, bytes: 1000 }, code: 'DAILY_BYTES_LIMIT_EXCEEDED' },
]) {
  test(`S3-08: frontera independiente ${bound.code}`, integrationOptions, async (t) => {
    const f = await fixture(t);
    await f.limits(bound.limits);
    await f.service.reserve({ reservationKey: randomUUID(), userId: f.user.id, bytes: 1000 });
    await assert.rejects(f.service.reserve({ reservationKey: randomUUID(), userId: f.user.id, bytes: 1 }), { code: bound.code });
  });
}

test('S3-08/S3-11: migración conserva historial, traslada imágenes y no duplica al repetir', integrationOptions, async (t) => {
  const f = await fixture(t, { legacy: true });
  const hash = 'a'.repeat(64);
  await f.database.query("INSERT INTO stored_objects(hash_sha256,original_size_bytes,storage_key,status) VALUES ($1,100,$2,'ready')", [hash, `aa/${hash}.webp`]);
  const { rows: [oldAsync] } = await f.database.query("INSERT INTO images(user_id,object_hash,original_name) VALUES ($1,$2,'async.png') RETURNING id", [f.user.id, hash]);
  await f.database.query("INSERT INTO images(user_id,object_hash,original_name) VALUES ($1,$2,'sync.png')", [f.user.id, hash]);
  const jobId = randomUUID();
  await f.database.query(`INSERT INTO quota_reservations(user_id,reservation_key,reserved_bytes,status,created_at,confirmed_at)
    VALUES ($1,$2,100,'confirmed',now()-INTERVAL '1 day',now()),($1,$3,50,'confirmed',now(),now())`, [f.user.id, jobId, randomUUID()]);
  await f.database.query(`INSERT INTO image_processing_jobs(id,user_id,original_name,original_size_bytes,original_hash,
    status,converted_at,quota_managed,quota_settled_at,published_image_id)
    VALUES ($1,$2,'async.png',100,$3,'published',now(),TRUE,now(),$4)`, [jobId, f.user.id, hash, oldAsync.id]);
  await f.database.query(`INSERT INTO quota_daily_usage(user_id,usage_date,upload_count,uploaded_bytes)
    VALUES ($1,(CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date,2,150)`, [f.user.id]);
  await f.database.query('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const name of (await readdir(migrationsDirectory)).filter((n) => /^\d+[-_].*\.sql$/.test(n) && n < '006_')) {
    const sql = (await readFile(path.join(migrationsDirectory, name), 'utf8')).replace(/\r\n/g, '\n');
    await f.database.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
  }
  const url = new URL(testDatabaseUrl);
  url.searchParams.set('options', `-c search_path=${f.schema},public`);
  async function migrate() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/migrate.js', import.meta.url))], {
        windowsHide: true, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('error', reject);
      child.once('exit', (code) => { try { assert.equal(code, 0, output); resolve(output); } catch (error) { reject(error); } });
    });
  }
  assert.match(await migrate(), /Aplicada: 006_shared_quota_lifecycle.sql/);
  const first = (await f.database.query('SELECT usage_date::text,upload_count,uploaded_bytes FROM quota_daily_usage ORDER BY usage_date')).rows;
  assert.deepEqual(first.map(({ upload_count, uploaded_bytes }) => ({ upload_count, uploaded_bytes })), [
    { upload_count: 1, uploaded_bytes: '100' }, { upload_count: 2, uploaded_bytes: '150' },
  ]);
  assert.match(await migrate(), /Ya aplicada: 006_shared_quota_lifecycle.sql/);
  assert.deepEqual((await f.database.query('SELECT usage_date::text,upload_count,uploaded_bytes FROM quota_daily_usage ORDER BY usage_date')).rows, first);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_reservations')).rows[0].n, 3);
  assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM quota_reservations WHERE image_id IS NOT NULL')).rows[0].n, 2);
});
