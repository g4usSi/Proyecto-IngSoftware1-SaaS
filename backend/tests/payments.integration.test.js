import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

import { createApp } from "../src/app.js";
import {
  createFakeMailer,
  tokenFromLink,
} from "./helpers/fake-auth-database.js";

const run = promisify(execFile);

const integrationOptions = {
  skip:
    !process.env.TEST_DATABASE_URL &&
    "Requiere TEST_DATABASE_URL para probar pagos con PostgreSQL.",
  timeout: 120000,
};

async function fixture(t) {
  const schema = `payments_test_${randomUUID().replaceAll("-", "")}`;

  const admin = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 1,
  });

  let database;
  let server;
  let created = false;

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    await database?.end();

    try {
      if (created) {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await admin.end();
    }
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;

  const connection = new URL(process.env.TEST_DATABASE_URL);

  connection.searchParams.set("options", `-c search_path=${schema},public`);

  database = new pg.Pool({
    connectionString: connection.toString(),
    max: 4,
  });

  await run(
    process.execPath,
    [fileURLToPath(new URL("../scripts/migrate.js", import.meta.url))],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: connection.toString(),
      },
      timeout: 60000,
      windowsHide: true,
    },
  );

  const mailer = createFakeMailer();

  server = createApp({
    database,
    mailer,
    jwtSecret: "payments-test-secret-with-at-least-thirty-two-characters",
  }).listen(0, "127.0.0.1");

  await once(server, "listening");

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function createAuthenticatedUser() {
    const account = {
      name: "Cliente de pagos",
      email: `${randomUUID()}@payments.test`,
      password: "Clave#Segura1",
    };

    const post = (route, data) =>
      fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

    const registered = await post("/api/auth/register", account);

    assert.equal(registered.status, 201, await registered.clone().text());

    const { data: user } = await registered.json();

    const verificationToken = tokenFromLink(
      mailer.verifications.at(-1).verifyLink,
    );

    const verified = await post("/api/auth/verify-email", {
      token: verificationToken,
    });

    assert.equal(verified.status, 200);

    const login = await post("/api/auth/login", {
      email: account.email,
      password: account.password,
    });

    assert.equal(login.status, 200);

    const { data: session } = await login.json();

    return {
      userId: user.id,
      token: session.token,
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    };
  }

  return { database, baseUrl, createAuthenticatedUser };
}

test(
  "S4-02: checkout requiere autenticación",
  integrationOptions,
  async (t) => {
    const { baseUrl } = await fixture(t);

    const response = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: {
          number: "4242424242424242",
        },
      }),
    });

    assert.equal(response.status, 401);
  },
);

test(
  "S4-02: historial de pagos requiere autenticación",
  integrationOptions,
  async (t) => {
    const { baseUrl } = await fixture(t);

    const response = await fetch(`${baseUrl}/api/payments`);

    assert.equal(response.status, 401);
  },
);

test(
  "S4-02: pago aprobado activa el plan Standard",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

    const { userId, headers } = await createAuthenticatedUser();

    // 1. Comprobar que comienza con el plan Free
    const before = await database.query(
      `SELECT p.code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'`,
      [userId],
    );

    assert.deepEqual(
      before.rows.map((row) => row.code),
      ["free"],
    );

    // 2. Realizar el pago simulado
    const response = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: {
          number: "4242424242424242",
        },
      }),
    });

    const body = await response.json();

    // 3. Comprobar la respuesta
    assert.equal(response.status, 201);
    assert.equal(body.data.payment.status, "approved");
    assert.equal(body.data.payment.amount, "8.00");
    assert.equal(body.data.payment.currency, "USD");

    // 4. Comprobar que cambió la suscripción
    const after = await database.query(
      `SELECT p.code, s.status
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'`,
      [userId],
    );

    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].code, "standard");

    // 5. Comprobar que se registró el pago
    const payments = await database.query(
      `SELECT status, amount, currency, card_last4
       FROM payments
       WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 1);
    assert.equal(payments.rows[0].status, "approved");
    assert.equal(String(payments.rows[0].amount), "8.00");
    assert.equal(payments.rows[0].currency, "USD");
    assert.equal(payments.rows[0].card_last4.trim(), "4242");
  },
);

test(
  "S4-03: renovar Standard aprueba el pago y extiende la suscripción",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    // Activar Standard mediante checkout
    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    const before = await database.query(
      `SELECT expires_at
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    assert.equal(before.rows.length, 1);
    const previousExpiration = new Date(before.rows[0].expires_at);

    // Renovar la suscripción
    const renewal = await fetch(`${baseUrl}/api/subscriptions/renew`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        card: { number: "4242424242424242" },
      }),
    });

    const body = await renewal.json();

    assert.equal(renewal.status, 201);
    assert.equal(body.data.payment.status, "approved");

    // Comprobar que la fecha de vencimiento aumentó
    const after = await database.query(
      `SELECT expires_at
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    assert.equal(after.rows.length, 1);
    assert.ok(
      new Date(after.rows[0].expires_at) > previousExpiration,
      "La renovación debe extender la fecha de vencimiento",
    );

    // Checkout y renovación deben generar dos pagos
    const payments = await database.query(
      `SELECT id FROM payments WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 2);
  },
);

test(
  "S4-03: cambiar de Standard a Pro aprueba el pago",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    const response = await fetch(`${baseUrl}/api/subscriptions/change-plan`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "pro",
        card: { number: "4242424242424242" },
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.changeType, "upgrade");
    assert.equal(body.data.payment.status, "approved");
    assert.equal(body.data.payment.amount, "15.00");

    const subscriptions = await database.query(
      `SELECT p.code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'active'`,
      [userId],
    );

    assert.deepEqual(
      subscriptions.rows.map((row) => row.code),
      ["pro"],
    );

    const payments = await database.query(
      `SELECT id FROM payments WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 2);
  },
);

test(
  "S4-03: cambiar de Pro a Standard no genera otro pago",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    const requestHeaders = () => ({
      ...headers,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    });

    // Contratar Pro
    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        planCode: "pro",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    // Bajar de Pro a Standard
    const response = await fetch(`${baseUrl}/api/subscriptions/change-plan`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        planCode: "standard",
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.changeType, "downgrade");

    // Comprobar el nuevo plan
    const subscriptions = await database.query(
      `SELECT p.code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'active'`,
      [userId],
    );

    assert.deepEqual(
      subscriptions.rows.map((row) => row.code),
      ["standard"],
    );

    // El downgrade no debe generar un segundo pago
    const payments = await database.query(
      `SELECT id FROM payments WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 1);
  },
);

test(
  "S4-03: rechaza downgrade cuando supera la capacidad",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    // 1. Contratar Pro
    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "pro",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    // 2. Simular 30 GB reservados para el usuario
    await database.query(
      `INSERT INTO quota_reservations
         (user_id, reservation_key, reserved_bytes, status)
       VALUES ($1, $2, $3, 'pending')`,
      [userId, randomUUID(), "30000000000"],
    );

    // 3. Intentar bajar a Standard
    const response = await fetch(`${baseUrl}/api/subscriptions/change-plan`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error.code, "PLAN_CAPACITY_EXCEEDED");

    // 4. Confirmar que conserva Pro
    const subscriptions = await database.query(
      `SELECT p.code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'active'`,
      [userId],
    );

    assert.deepEqual(
      subscriptions.rows.map((row) => row.code),
      ["pro"],
    );

    // 5. Confirmar que no hubo otro pago
    const payments = await database.query(
      `SELECT id FROM payments WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 1);
  },
);

test(
  "S4-03: renovaciones concurrentes con la misma clave no duplican pagos",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    // Activar Standard
    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    // Enviar dos renovaciones simultáneas con la misma clave
    const key = randomUUID();

    const renew = () =>
      fetch(`${baseUrl}/api/subscriptions/renew`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          card: { number: "4242424242424242" },
        }),
      });

    const [first, second] = await Promise.all([renew(), renew()]);

    assert.ok([200, 201].includes(first.status));
    assert.ok([200, 201].includes(second.status));

    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(firstBody.data.payment.status, "approved");
    assert.equal(secondBody.data.payment.status, "approved");

    // Ambas solicitudes deben referirse al mismo pago
    assert.equal(firstBody.data.payment.id, secondBody.data.payment.id);

    // Checkout + una sola renovación = dos pagos
    const payments = await database.query(
      `SELECT id FROM payments WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 2);
  },
);

test(
  "S4-03: renovar dos veces con la misma clave no duplica el pago",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    // Activar Standard
    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    // Usar la misma clave en ambas renovaciones
    const key = randomUUID();

    const renew = () =>
      fetch(`${baseUrl}/api/subscriptions/renew`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          card: { number: "4242424242424242" },
        }),
      });

    const first = await renew();
    const firstBody = await first.json();

    assert.equal(first.status, 201);
    assert.equal(firstBody.data.payment.status, "approved");

    const beforeRepeat = await database.query(
      `SELECT expires_at
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    // Repetir la misma solicitud
    const second = await renew();
    const secondBody = await second.json();

    assert.equal(second.status, 200);
    assert.equal(secondBody.data.repeated, true);

    const afterRepeat = await database.query(
      `SELECT expires_at
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    // La segunda solicitud no debe extender nuevamente la fecha
    assert.equal(
      new Date(afterRepeat.rows[0].expires_at).getTime(),
      new Date(beforeRepeat.rows[0].expires_at).getTime(),
    );

    // Checkout + una sola renovación = dos pagos
    const payments = await database.query(
      `SELECT id FROM payments WHERE user_id = $1`,
      [userId],
    );

    assert.equal(payments.rows.length, 2);
  },
);

test(
  "S4-03: una suscripción vencida utiliza el plan Free",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);
    const { userId, headers } = await createAuthenticatedUser();

    // Contratar Standard
    const checkout = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        planCode: "standard",
        card: { number: "4242424242424242" },
      }),
    });

    assert.equal(checkout.status, 201);

    // Simular que la suscripción venció ayer

    await database.query(
      `UPDATE subscriptions
   SET started_at = CURRENT_TIMESTAMP - INTERVAL '2 months',
       expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
   WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );

    // Consultar el plan efectivo del usuario
    const response = await fetch(`${baseUrl}/api/subscriptions/me`, {
      headers,
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.plan.code, "free");
  },
);

for (const scenario of [
  {
    number: "4000000000000002",
    expectedStatus: "rejected",
  },
  {
    number: "4000000000000119",
    expectedStatus: "error",
  },
]) {
  test(
    `S4-02: pago ${scenario.expectedStatus} no cambia la suscripción`,
    integrationOptions,
    async (t) => {
      const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

      const { userId, headers } = await createAuthenticatedUser();

      // Intentar contratar el plan Pro
      const response = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          planCode: "pro",
          card: {
            number: scenario.number,
          },
        }),
      });

      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.data.payment.status, scenario.expectedStatus);

      // La suscripción debe seguir siendo Free
      const subscriptions = await database.query(
        `SELECT p.code
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.user_id = $1
           AND s.status = 'active'`,
        [userId],
      );

      assert.deepEqual(
        subscriptions.rows.map((row) => row.code),
        ["free"],
      );

      // El intento de pago debe quedar registrado
      const payments = await database.query(
        `SELECT status
         FROM payments
         WHERE user_id = $1`,
        [userId],
      );

      assert.equal(payments.rows.length, 1);
      assert.equal(payments.rows[0].status, scenario.expectedStatus);
    },
  );
}

test(
  "S4-02: repetir un checkout no duplica pagos ni suscripciones",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

    const { userId, headers } = await createAuthenticatedUser();

    const idempotencyKey = randomUUID();

    const checkout = () =>
      fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          planCode: "standard",
          card: {
            number: "4242424242424242",
          },
        }),
      });

    // Primer pago
    const firstResponse = await checkout();
    const first = await firstResponse.json();

    assert.equal(firstResponse.status, 201);
    assert.equal(first.data.repeated, false);

    // Repetir exactamente el mismo pago
    const secondResponse = await checkout();
    const second = await secondResponse.json();

    assert.ok([200, 201].includes(secondResponse.status));
    assert.equal(second.data.repeated, true);

    // Debe ser el mismo pago
    assert.equal(first.data.payment.id, second.data.payment.id);

    assert.ok(first.data.subscription);
    assert.ok(second.data.subscription);

    assert.equal(first.data.subscription.id, second.data.subscription.id);

    assert.equal(
      first.data.subscription.startedAt,
      second.data.subscription.startedAt,
    );

    assert.equal(
      first.data.subscription.expiresAt,
      second.data.subscription.expiresAt,
    );

    assert.equal(secondResponse.status, 200);

    // No debe haber pagos duplicados
    const payments = await database.query(
      "SELECT id FROM payments WHERE user_id = $1",
      [userId],
    );

    assert.equal(payments.rows.length, 1);

    // Solo una suscripción Standard activa
    const subscriptions = await database.query(
      `SELECT s.id
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'
         AND p.code = 'standard'`,
      [userId],
    );

    assert.equal(subscriptions.rows.length, 1);
  },
);

test(
  "S4-02: dos checkout simultáneos no duplican el pago",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

    const { userId, headers } = await createAuthenticatedUser();

    const idempotencyKey = randomUUID();

    const checkout = () =>
      fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          planCode: "pro",
          card: {
            number: "4242424242424242",
          },
        }),
      });

    // Enviar las dos solicitudes simultáneamente
    const responses = await Promise.all([checkout(), checkout()]);

    const results = await Promise.all(
      responses.map((response) => response.json()),
    );

    // Ambas solicitudes deben responder correctamente
    for (const response of responses) {
      assert.ok([200, 201].includes(response.status));
    }

    // Ambas deben referirse al mismo pago
    assert.equal(results[0].data.payment.id, results[1].data.payment.id);

    // Una solicitud crea el pago y la otra lo reutiliza
    assert.deepEqual(results.map((result) => result.data.repeated).sort(), [
      false,
      true,
    ]);

    // Solo debe existir un pago en PostgreSQL
    const payments = await database.query(
      "SELECT id FROM payments WHERE user_id = $1",
      [userId],
    );

    assert.equal(payments.rows.length, 1);

    // Solo debe existir una suscripción Pro activa
    const subscriptions = await database.query(
      `SELECT s.id
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'
         AND p.code = 'pro'`,
      [userId],
    );

    assert.equal(subscriptions.rows.length, 1);
  },
);

test(
  "S4-02: reutilizar la misma clave con otro plan devuelve 409",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

    const { userId, headers } = await createAuthenticatedUser();

    const idempotencyKey = randomUUID();

    const checkout = (planCode) =>
      fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          planCode,
          card: {
            number: "4242424242424242",
          },
        }),
      });

    // Primer pago: Standard
    const firstResponse = await checkout("standard");
    assert.equal(firstResponse.status, 201);

    // Misma clave, pero intentando comprar Pro
    const secondResponse = await checkout("pro");
    assert.equal(secondResponse.status, 409);

    // No debe registrarse otro pago
    const payments = await database.query(
      "SELECT id FROM payments WHERE user_id = $1",
      [userId],
    );

    assert.equal(payments.rows.length, 1);

    // La suscripción debe continuar siendo Standard
    const subscriptions = await database.query(
      `SELECT p.code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'`,
      [userId],
    );

    assert.deepEqual(
      subscriptions.rows.map((row) => row.code),
      ["standard"],
    );
  },
);

test(
  "S4-02: reutilizar la misma clave con otra tarjeta devuelve 409",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

    const { userId, headers } = await createAuthenticatedUser();

    const idempotencyKey = randomUUID();

    const checkout = (cardNumber) =>
      fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          planCode: "standard",
          card: {
            number: cardNumber,
          },
        }),
      });

    // Primera solicitud: pago aprobado
    const firstResponse = await checkout("4242424242424242");
    assert.equal(firstResponse.status, 201);

    // Misma clave, pero otra tarjeta
    const secondResponse = await checkout("4000000000000002");
    assert.equal(secondResponse.status, 409);

    const secondBody = await secondResponse.json();
    assert.equal(secondBody.error.code, "IDEMPOTENCY_CONFLICT");

    // No debe crearse otro pago
    const payments = await database.query(
      "SELECT id FROM payments WHERE user_id = $1",
      [userId],
    );

    assert.equal(payments.rows.length, 1);

    // La suscripción original continúa activa
    const subscriptions = await database.query(
      `SELECT p.code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'`,
      [userId],
    );

    assert.deepEqual(
      subscriptions.rows.map((row) => row.code),
      ["standard"],
    );
  },
);

test(
  "S4-02: historial de pagos es privado para cada usuario",
  integrationOptions,
  async (t) => {
    const { baseUrl, createAuthenticatedUser } = await fixture(t);

    // Crear dos usuarios diferentes
    const userA = await createAuthenticatedUser();
    const userB = await createAuthenticatedUser();

    async function pay(user, planCode) {
      const response = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...user.headers,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          planCode,
          card: {
            number: "4242424242424242",
          },
        }),
      });

      assert.equal(response.status, 201);
      return (await response.json()).data.payment;
    }

    // Cada usuario realiza su propio pago
    const paymentA = await pay(userA, "standard");
    const paymentB = await pay(userB, "pro");

    // Consultar el historial del usuario A
    const responseA = await fetch(`${baseUrl}/api/payments`, {
      headers: userA.headers,
    });

    assert.equal(responseA.status, 200);

    const historyA = (await responseA.json()).data;

    assert.equal(historyA.payments.length, 1);
    assert.equal(historyA.payments[0].id, paymentA.id);

    assert.notEqual(historyA.payments[0].id, paymentB.id);

    // Consultar el historial del usuario B
    const responseB = await fetch(`${baseUrl}/api/payments`, {
      headers: userB.headers,
    });

    assert.equal(responseB.status, 200);

    const historyB = (await responseB.json()).data;

    assert.equal(historyB.payments.length, 1);
    assert.equal(historyB.payments[0].id, paymentB.id);

    assert.notEqual(historyB.payments[0].id, paymentA.id);
  },
);

test(
  "S4-02: historial no expone datos sensibles de tarjetas",
  integrationOptions,
  async (t) => {
    const { database, baseUrl, createAuthenticatedUser } = await fixture(t);

    const { userId, headers } = await createAuthenticatedUser();

    const cardNumber = "4242424242424242";

    // Realizar un pago simulado
    const checkoutResponse = await fetch(
      `${baseUrl}/api/subscriptions/checkout`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          planCode: "standard",
          card: {
            number: cardNumber,
          },
        }),
      },
    );

    assert.equal(checkoutResponse.status, 201);

    const checkoutBody = await checkoutResponse.text();

    // La respuesta del checkout no debe exponer la tarjeta
    assert.equal(checkoutBody.includes(cardNumber), false);

    // Consultar el historial
    const historyResponse = await fetch(`${baseUrl}/api/payments`, { headers });

    assert.equal(historyResponse.status, 200);

    const historyBody = await historyResponse.text();

    // El historial no debe exponer el número completo
    assert.equal(historyBody.includes(cardNumber), false);

    const history = JSON.parse(historyBody);

    // Solo deben mostrarse los últimos cuatro dígitos
    assert.equal(history.data.payments[0].cardLast4, "4242");

    // La base de datos solo debe conservar los últimos 4
    const result = await database.query(
      `SELECT card_last4
       FROM payments
       WHERE user_id = $1`,
      [userId],
    );

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].card_last4.trim(), "4242");
  },
);

test(
  "S4-02: historial de pagos permite paginación y orden",
  integrationOptions,
  async (t) => {
    const { baseUrl, createAuthenticatedUser } = await fixture(t);

    const { headers } = await createAuthenticatedUser();

    const paymentIds = [];

    // Crear tres pagos simulados
    for (const planCode of ["standard", "pro", "enterprise"]) {
      const response = await fetch(`${baseUrl}/api/subscriptions/checkout`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          planCode,
          card: {
            number: "4242424242424242",
          },
        }),
      });

      assert.equal(response.status, 201);

      const body = await response.json();
      paymentIds.push(body.data.payment.id);
    }

    // Consultar primera página: dos pagos
    const firstResponse = await fetch(
      `${baseUrl}/api/payments?page=1&limit=2`,
      { headers },
    );

    assert.equal(firstResponse.status, 200);

    const first = (await firstResponse.json()).data;

    assert.equal(first.payments.length, 2);
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.limit, 2);
    assert.equal(first.pagination.total, 3);
    assert.equal(first.pagination.totalPages, 2);

    // Deben aparecer primero los pagos más recientes
    assert.deepEqual(
      first.payments.map((payment) => payment.id),
      [paymentIds[2], paymentIds[1]],
    );

    // Consultar segunda página
    const secondResponse = await fetch(
      `${baseUrl}/api/payments?page=2&limit=2`,
      { headers },
    );

    assert.equal(secondResponse.status, 200);

    const second = (await secondResponse.json()).data;

    assert.equal(second.payments.length, 1);
    assert.equal(second.payments[0].id, paymentIds[0]);
  },
);

test(
  "S4-02: historial rechaza paginación inválida",
  integrationOptions,
  async (t) => {
    const { baseUrl, createAuthenticatedUser } = await fixture(t);

    const { headers } = await createAuthenticatedUser();

    const invalidQueries = [
      "page=0&limit=10",
      "page=-1&limit=10",
      "page=abc&limit=10",
      "page=1&limit=0",
      "page=1&limit=101",
      "page=1&limit=-5",
      "page=1.5&limit=10",
    ];

    for (const query of invalidQueries) {
      const response = await fetch(`${baseUrl}/api/payments?${query}`, {
        headers,
      });

      assert.equal(
        response.status,
        400,
        `La consulta ${query} debería devolver 400`,
      );
    }
  },
);
