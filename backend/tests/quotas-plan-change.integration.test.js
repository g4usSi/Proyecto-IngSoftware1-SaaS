// S4-08: cuotas y consumo de Storage al contratar, renovar, subir/bajar de plan o vencer.
// Contrasta la API (/api/quotas/me, /api/subscriptions/*) contra la base de datos y
// verifica que ninguna imagen se pierda. Requiere PostgreSQL temporal (TEST_DATABASE_URL).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { fixture as workerFixture } from './helpers/worker-fixture.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { createManagedImageJobs } from '../src/workers/image-lifecycle.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 90000 };
const SECRET = 'plan-change-test-secret-longer-than-thirty-two-characters';
const CARD = { number: '4242424242424242' };

// Imágenes distintas (hash distinto) y del mismo tamaño para que los límites sean exactos.
async function makeImages(count) {
  const images = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      sharp({ create: { width: 40, height: 30, channels: 3, background: { r: (i * 37) % 256, g: (i * 91 + 20) % 256, b: (i * 53 + 70) % 256 } } })
        .png({ compressionLevel: 0, adaptiveFiltering: false, palette: false }).toBuffer()),
  );
  assert.equal(new Set(images.map((b) => b.length)).size, 1, 'las imágenes de prueba deben pesar lo mismo');
  return images;
}

async function setup(t) {
  const images = await makeImages(16);
  const size = images[0].length;
  const f = await workerFixture(t);
  f.jobs = createManagedImageJobs(f);
  f.storage = createStorageService(f);
  f.images = images;
  f.size = size;
  f.file = async (buffer) => {
    const filename = path.join(f.storageRoot, `${randomUUID()}.png`);
    await writeFile(filename, buffer);
    return { path: filename, size: buffer.length, originalname: 'prueba.png' };
  };
  f.upload = async (buffer, ownerId) => f.storage.uploadFile(ownerId, await f.file(buffer), {});
  f.stage = async (buffer, ownerId) => f.jobs.stage({ ownerId, file: await f.file(buffer), folderId: null });
  // Capacidades pequeñas y proporcionales al peso real de una imagen de prueba.
  f.plans = async ({ free = 2, standard = 4, pro = 6, enterprise = 8, daily = null } = {}) => {
    for (const [code, units] of Object.entries({ free, standard, pro, enterprise })) {
      await f.database.query(
        'UPDATE plans SET capacity_bytes=$1, daily_upload_limit=$2, daily_bytes_limit=NULL WHERE code=$3',
        [units * size, daily, code],
      );
    }
  };
  f.account = async (name) => {
    const { rows: [user] } = await f.database.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'!test') RETURNING id",
      [name, `${randomUUID()}@plan-change.test`]);
    await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT $1,id FROM plans WHERE code='free'", [user.id]);
    const token = createTokenService({ secret: SECRET, expiresIn: '1h' }).issue(user.id).token;
    return { id: user.id, headers: { Authorization: `Bearer ${token}` } };
  };
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  return f;
}

async function withApi(f, run) {
  const server = createApp({ ...f, storageDemo: false, jwtSecret: SECRET, enqueueJob: async () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (user, route, { method = 'GET', body, key } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...user.headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await run({
      call,
      quota: async (user) => (await call(user, '/quotas/me')).body.data,
      checkout: (user, planCode, key = randomUUID()) => call(user, '/subscriptions/checkout', { method: 'POST', body: { planCode, card: CARD }, key }),
      changePlan: (user, planCode, key = randomUUID()) => call(user, '/subscriptions/change-plan', { method: 'POST', body: { planCode, card: CARD }, key }),
      renew: (user, key = randomUUID()) => call(user, '/subscriptions/renew', { method: 'POST', body: { card: CARD }, key }),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Cifras independientes de la API: se calculan directamente en SQL.
async function ledger(f, userId) {
  const { rows: [row] } = await f.database.query(
    `SELECT
       (SELECT COALESCE(SUM(o.original_size_bytes),0)::text FROM images i JOIN stored_objects o ON o.hash_sha256=i.object_hash WHERE i.user_id=$1) AS used,
       (SELECT COALESCE(SUM(reserved_bytes),0)::text FROM quota_reservations WHERE user_id=$1 AND status='pending') AS reserved,
       (SELECT COUNT(*)::int FROM images WHERE user_id=$1) AS images,
       (SELECT COUNT(*)::int FROM subscriptions WHERE user_id=$1 AND status='active') AS active_subscriptions,
       (SELECT COUNT(*)::int FROM payments WHERE user_id=$1) AS payments`,
    [userId]);
  return row;
}

async function assertCoherent(f, user, quota) {
  const sql = await ledger(f, user.id);
  assert.equal(quota.usedBytes, sql.used, 'usedBytes de la API debe coincidir con la base');
  assert.equal(quota.reservedBytes, sql.reserved, 'reservedBytes de la API debe coincidir con la base');
  const available = BigInt(quota.capacityBytes) - BigInt(sql.used) - BigInt(sql.reserved);
  assert.equal(quota.availableBytes, (available > 0n ? available : 0n).toString());
  assert.equal(sql.active_subscriptions, 1, 'una sola suscripción activa por usuario');
}

test('S4-08: subir de Free a Standard amplía capacidad, conserva consumo y cupo diario', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 2, standard: 4, daily: 2 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    await f.upload(f.images[0], user.id);
    await f.upload(f.images[1], user.id);
    await assert.rejects(f.upload(f.images[2], user.id), (e) => ['CAPACITY_EXCEEDED', 'DAILY_UPLOAD_LIMIT_EXCEEDED'].includes(e.code));
    const before = await api.quota(user);
    assert.equal(before.plan.code, 'free');
    assert.equal(before.daily.uploadsUsed, '2');
    await assertCoherent(f, user, before);

    const paid = await api.checkout(user, 'standard');
    assert.equal(paid.status, 201);
    assert.equal(paid.body.data.payment.status, 'approved');

    const after = await api.quota(user);
    assert.equal(after.plan.code, 'standard');
    assert.equal(after.capacityBytes, String(4 * f.size));
    assert.equal(after.usedBytes, before.usedBytes, 'el consumo no cambia al cambiar de plan');
    assert.equal(after.daily.uploadsUsed, '2', 'el contador diario no se reinicia por contratar');
    assert.equal(after.daily.uploadLimit, 2, 'el límite diario sigue el del plan nuevo (aquí 2 por la configuración de la prueba)');
    await assertCoherent(f, user, after);
    assert.equal((await ledger(f, user.id)).images, 2, 'ninguna imagen se pierde');
  });
});

test('S4-08: tras subir de plan se puede usar la capacidad nueva hasta el límite exacto', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 1, standard: 3 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    await f.upload(f.images[0], user.id);
    await assert.rejects(f.upload(f.images[1], user.id), { code: 'CAPACITY_EXCEEDED' });
    assert.equal((await api.checkout(user, 'standard')).status, 201);
    await f.upload(f.images[1], user.id);
    await f.upload(f.images[2], user.id);
    await assert.rejects(f.upload(f.images[3], user.id), { code: 'CAPACITY_EXCEEDED' });
    const quota = await api.quota(user);
    assert.equal(quota.availableBytes, '0');
    await assertCoherent(f, user, quota);
    assert.equal((await ledger(f, user.id)).images, 3);
  });
});

test('S4-08: bajar de plan es válido cuando usados + reservados caben en el plan nuevo', options, async (t) => {
  const f = await setup(t);
  await f.plans({ standard: 3, pro: 6 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'pro')).status, 201);
    await f.upload(f.images[0], user.id);
    await f.upload(f.images[1], user.id);
    await f.stage(f.images[2], user.id); // reserva pendiente: usados 2 + reservado 1 = 3 = capacidad exacta de Standard
    const paymentsBefore = (await ledger(f, user.id)).payments;
    const down = await api.changePlan(user, 'standard');
    assert.equal(down.status, 200, JSON.stringify(down.body));
    assert.equal(down.body.data.changeType, 'downgrade');
    const after = await api.quota(user);
    assert.equal(after.plan.code, 'standard');
    assert.equal(after.capacityBytes, String(3 * f.size));
    assert.equal(after.usedBytes, String(2 * f.size));
    assert.equal(after.reservedBytes, String(f.size), 'la reserva pendiente se conserva');
    assert.equal(after.availableBytes, '0');
    await assertCoherent(f, user, after);
    const sql = await ledger(f, user.id);
    assert.equal(sql.images, 2);
    assert.equal(sql.payments, paymentsBefore, 'bajar de plan no genera otro pago');
  });
});

test('S4-08: bajar de plan se rechaza si lo usado excede el plan nuevo; papelera cuenta y el límite exacto pasa', options, async (t) => {
  const f = await setup(t);
  await f.plans({ standard: 3, pro: 6 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'pro')).status, 201);
    const uploaded = [];
    for (let i = 0; i < 4; i++) uploaded.push((await f.upload(f.images[i], user.id)).image);
    const snapshot = await ledger(f, user.id);

    const refused = await api.changePlan(user, 'standard');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'PLAN_CAPACITY_EXCEEDED');
    assert.deepEqual(await ledger(f, user.id), snapshot, 'el rechazo no cambia suscripción, pagos ni imágenes');
    assert.equal((await api.quota(user)).plan.code, 'pro');

    await f.storage.trashFile(user.id, uploaded[0].id); // la papelera sigue consumiendo capacidad
    assert.equal((await api.changePlan(user, 'standard')).status, 409);

    await f.storage.deleteFile(user.id, uploaded[0].id); // borrado definitivo: 3 imágenes = capacidad exacta
    const accepted = await api.changePlan(user, 'standard');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const quota = await api.quota(user);
    assert.equal(quota.plan.code, 'standard');
    await assertCoherent(f, user, quota);
    assert.equal((await ledger(f, user.id)).images, 3);
  });
});

test('S4-08: una reserva pendiente impide bajar de plan hasta liberarla', options, async (t) => {
  const f = await setup(t);
  await f.plans({ standard: 2, pro: 6 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'pro')).status, 201);
    await f.upload(f.images[0], user.id);
    await f.upload(f.images[1], user.id);
    const job = await f.stage(f.images[2], user.id);
    assert.equal((await api.changePlan(user, 'standard')).status, 409);
    await f.jobs.process(job.id); // la reserva se convierte en imagen publicada: sigue sin caber
    assert.equal((await api.changePlan(user, 'standard')).status, 409);
    const sql = await ledger(f, user.id);
    assert.equal(sql.images, 3);
    assert.equal(sql.reserved, '0');
    assert.equal((await api.quota(user)).plan.code, 'pro');
  });
});

test('S4-08: la deduplicación no reduce el consumo lógico que se compara con el plan', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 2, standard: 4, pro: 6 });
  const a = await f.account('A');
  const b = await f.account('B');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(a, 'pro')).status, 201);
    await f.upload(f.images[0], a.id);
    await f.upload(f.images[0], b.id); // mismo contenido: un solo objeto físico
    assert.equal((await f.database.query('SELECT COUNT(*)::int AS n FROM stored_objects')).rows[0].n, 1);
    const qa = await api.quota(a);
    const qb = await api.quota(b);
    assert.equal(qa.usedBytes, String(f.size));
    assert.equal(qb.usedBytes, String(f.size), 'cada cuenta paga su original aunque se comparta el objeto');
    await assertCoherent(f, a, qa);
    await assertCoherent(f, b, qb);
    // Con capacidad menor al original lógico, bajar se rechaza aunque el objeto físico esté compartido.
    await f.database.query('UPDATE plans SET capacity_bytes=$1 WHERE code=$2', [f.size - 1, 'standard']);
    assert.equal((await api.changePlan(a, 'standard')).body.error.code, 'PLAN_CAPACITY_EXCEEDED');
  });
});

test('S4-08: renovar extiende el vencimiento sin tocar consumo, cupo diario ni imágenes', options, async (t) => {
  const f = await setup(t);
  await f.plans({ standard: 4 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'standard')).status, 201);
    await f.upload(f.images[0], user.id);
    await f.database.query(
      "UPDATE subscriptions SET expires_at = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE user_id=$1 AND status='active'", [user.id]);
    const before = await api.quota(user);
    const { rows: [old] } = await f.database.query("SELECT expires_at FROM subscriptions WHERE user_id=$1 AND status='active'", [user.id]);

    const renewed = await api.renew(user);
    assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
    assert.equal(renewed.body.data.payment.status, 'approved');

    const { rows: [now] } = await f.database.query("SELECT expires_at FROM subscriptions WHERE user_id=$1 AND status='active'", [user.id]);
    assert.ok(new Date(now.expires_at) > new Date(old.expires_at), 'el vencimiento avanza');
    const after = await api.quota(user);
    assert.deepEqual(after, before, 'plan, capacidad, consumo y cupos diarios quedan idénticos');
    await f.upload(f.images[1], user.id); // y se puede seguir cargando
    await assertCoherent(f, user, await api.quota(user));
    assert.equal((await ledger(f, user.id)).images, 2);
  });
});

test('S4-08: al vencer sin renovar rigen los límites Free, sin borrar ni ocultar imágenes', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 2, standard: 4 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'standard')).status, 201);
    const uploaded = [];
    for (let i = 0; i < 4; i++) uploaded.push((await f.upload(f.images[i], user.id)).image);
    // Se retrocede todo el historial de forma coherente: Free (cerrada al contratar) -> Standard (vencida ayer).
    await f.database.query(
      `UPDATE subscriptions SET started_at = CURRENT_TIMESTAMP - INTERVAL '3 months',
         expires_at = CURRENT_TIMESTAMP - INTERVAL '2 months' WHERE user_id=$1 AND status<>'active'`, [user.id]);
    await f.database.query(
      `UPDATE subscriptions SET started_at = CURRENT_TIMESTAMP - INTERVAL '2 months',
         expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE user_id=$1 AND status='active'`, [user.id]);

    const quota = await api.quota(user);
    assert.equal(quota.plan.code, 'free');
    assert.equal(quota.capacityBytes, String(2 * f.size));
    assert.equal(quota.usedBytes, String(4 * f.size), 'el consumo real se informa completo');
    assert.equal(quota.availableBytes, '0', 'el disponible nunca es negativo');
    await assertCoherent(f, user, { ...quota, capacityBytes: quota.capacityBytes });

    await assert.rejects(f.upload(f.images[4], user.id), { code: 'CAPACITY_EXCEEDED' });
    assert.equal((await ledger(f, user.id)).images, 4, 'ninguna imagen se borra al vencer');
    const download = await f.storage.downloadFile(user.id, uploaded[0].id);
    await download.handle.close();

    // Liberar hasta caber en Free vuelve a permitir cargas.
    await f.storage.deleteFile(user.id, uploaded[0].id);
    await f.storage.deleteFile(user.id, uploaded[1].id);
    await f.storage.deleteFile(user.id, uploaded[2].id);
    await f.upload(f.images[5], user.id);
  });
});

test('S4-08: cargas concurrentes tras subir de plan aceptan exactamente lo que cabe', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 1, standard: 3 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'standard')).status, 201);
    const attempts = [
      ...[0, 1, 2].map((i) => f.upload(f.images[i], user.id)),
      ...[3, 4, 5].map((i) => f.stage(f.images[i], user.id)),
    ];
    const results = await Promise.allSettled(attempts);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3, 'caben exactamente 3 imágenes');
    for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.code, 'CAPACITY_EXCEEDED');
    const quota = await api.quota(user);
    assert.equal(BigInt(quota.usedBytes) + BigInt(quota.reservedBytes), BigInt(3 * f.size));
    assert.equal(quota.availableBytes, '0');
    await assertCoherent(f, user, quota);
  });
});

test('S4-08: bajar de plan y cargar a la vez nunca deja consumo por encima del plan vigente', options, async (t) => {
  const f = await setup(t);
  await f.plans({ standard: 3, pro: 6 });
  await withApi(f, async (api) => {
    for (let round = 0; round < 8; round++) {
      const user = await f.account(`Carrera ${round}`);
      assert.equal((await api.checkout(user, 'pro')).status, 201);
      await f.upload(f.images[0], user.id);
      await f.upload(f.images[1], user.id);
      const racers = await Promise.allSettled([
        api.changePlan(user, 'standard'),
        f.upload(f.images[2], user.id),
        f.upload(f.images[3], user.id),
        f.stage(f.images[4], user.id),
      ]);
      const change = racers[0].value;
      assert.ok([200, 409].includes(change.status), `respuesta inesperada ${change.status}`);
      const quota = await api.quota(user);
      assert.equal(quota.plan.code, change.status === 200 ? 'standard' : 'pro');
      const total = BigInt(quota.usedBytes) + BigInt(quota.reservedBytes);
      assert.ok(total <= BigInt(quota.capacityBytes), `ronda ${round}: ${total} > ${quota.capacityBytes}`);
      await assertCoherent(f, user, quota);
      assert.ok((await ledger(f, user.id)).images >= 2, 'ninguna imagen previa se pierde');
    }
  });
});

test('S4-08: cambio de plan con la misma clave en paralelo genera un pago y una suscripción', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 2, standard: 4 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    await f.upload(f.images[0], user.id);
    const key = randomUUID();
    const [one, two] = await Promise.all([api.changePlan(user, 'standard', key), api.changePlan(user, 'standard', key)]);
    assert.ok([200, 201].includes(one.status) && [200, 201].includes(two.status), JSON.stringify([one.body, two.body]));
    const sql = await ledger(f, user.id);
    assert.equal(sql.payments, 1);
    assert.equal(sql.active_subscriptions, 1);
    const quota = await api.quota(user);
    assert.equal(quota.plan.code, 'standard');
    assert.equal(quota.usedBytes, String(f.size));
    await assertCoherent(f, user, quota);
  });
});

test('S4-08: un pago rechazado no cambia capacidad ni consumo', options, async (t) => {
  const f = await setup(t);
  await f.plans({ free: 2, pro: 6 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    await f.upload(f.images[0], user.id);
    const before = await api.quota(user);
    const rejected = await api.call(user, '/subscriptions/checkout', {
      method: 'POST', key: randomUUID(), body: { planCode: 'pro', card: { number: '4000000000000002' } } });
    assert.equal(rejected.body.data.payment.status, 'rejected');
    assert.deepEqual(await api.quota(user), before);
    assert.equal((await ledger(f, user.id)).images, 1);
  });
});

// Criterio de la tarjeta S4-03 / RF-PAG-05: el rechazo indica cuánto espacio liberar.
test('S4-08: el rechazo de downgrade indica cuánto espacio liberar', options, async (t) => {
  const f = await setup(t);
  await f.plans({ standard: 2, pro: 6 });
  const user = await f.account('Cliente');
  await withApi(f, async (api) => {
    assert.equal((await api.checkout(user, 'pro')).status, 201);
    for (let i = 0; i < 3; i++) await f.upload(f.images[i], user.id);
    const refused = await api.changePlan(user, 'standard');
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, new RegExp(String(f.size)), 'debe mencionar los bytes a liberar');
    assert.deepEqual(refused.body.error.details, {
      capacityBytes: String(2 * f.size), usedBytes: String(3 * f.size), reservedBytes: '0', bytesToFree: String(f.size),
    });
  });
});
