import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

const plans = [
  {
    id: "plan-free",
    code: "free",
    name: "Free",
    capacity_bytes: "2000000000",
    daily_upload_limit: 10,
    daily_bytes_limit: "200000000",
    monthly_price_gtq: "0.00",
    active: true,
  },
  {
    id: "plan-standard",
    code: "standard",
    name: "Estándar",
    capacity_bytes: "25000000000",
    daily_upload_limit: null,
    daily_bytes_limit: "500000000",
    monthly_price_gtq: "35.00",
    active: true,
  },
  {
    id: "plan-pro",
    code: "pro",
    name: "Pro",
    capacity_bytes: "100000000000",
    daily_upload_limit: null,
    daily_bytes_limit: null,
    monthly_price_gtq: "100.00",
    active: true,
  },
  {
    id: "plan-enterprise",
    code: "enterprise",
    name: "Enterprise",
    capacity_bytes: "500000000000",
    daily_upload_limit: null,
    daily_bytes_limit: null,
    monthly_price_gtq: "300.00",
    active: true,
  },
];

test("S4-01: la API devuelve los cuatro planes con precios y limites correctos", async (t) => {
  const database = {
    async query(sql) {
      assert.match(sql, /FROM plans/);
      assert.match(sql, /WHERE active = TRUE/);
      return { rows: plans };
    },
  };

  const server = createApp({
    database,
    jwtSecret: "secreto-de-pruebas-con-mas-de-32-caracteres!",
  }).listen(0, "127.0.0.1");

  await once(server, "listening");

  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/plans`,
  );

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.data.length, 4);

  const byCode = Object.fromEntries(body.data.map((plan) => [plan.code, plan]));

  for (const expected of plans) {
    const actual = byCode[expected.code];

    assert.ok(actual, `Falta el plan ${expected.code}`);
    assert.equal(actual.name, expected.name);
    assert.equal(actual.capacityBytes, expected.capacity_bytes);
    assert.equal(actual.dailyUploadLimit, expected.daily_upload_limit);
    assert.equal(actual.dailyBytesLimit, expected.daily_bytes_limit);
    assert.equal(actual.monthlyPriceGtq, expected.monthly_price_gtq);
    assert.equal(actual.active, true);
  }
});
