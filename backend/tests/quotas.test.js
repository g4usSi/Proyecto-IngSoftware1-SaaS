import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

async function fixture(t) {
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
