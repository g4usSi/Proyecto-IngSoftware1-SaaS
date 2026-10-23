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
    monthly_price: "0.00",
    currency: 'USD', billing_period: 'none', pricing_model: 'fixed',
    storage_price_per_gb_month: null, storage_included_bytes: null, storage_billing_basis: null,
    active: true,
  },
  {
    id: "plan-standard",
    code: "standard",
    name: "Estándar",
    capacity_bytes: "25000000000",
    daily_upload_limit: null,
    daily_bytes_limit: "500000000",
    monthly_price: "8.00",
    currency: 'USD', billing_period: 'calendar_month', pricing_model: 'fixed',
    storage_price_per_gb_month: null, storage_included_bytes: null, storage_billing_basis: null,
    active: true,
  },
  {
    id: "plan-pro",
    code: "pro",
    name: "Pro",
    capacity_bytes: "100000000000",
    daily_upload_limit: null,
    daily_bytes_limit: null,
    monthly_price: "15.00",
    currency: 'USD', billing_period: 'calendar_month', pricing_model: 'fixed',
    storage_price_per_gb_month: null, storage_included_bytes: null, storage_billing_basis: null,
    active: true,
  },
  {
    id: "plan-enterprise",
    code: "enterprise",
    name: "Enterprise",
    capacity_bytes: "200000000000",
    daily_upload_limit: null,
    daily_bytes_limit: null,
    monthly_price: "40.00",
    currency: 'USD', billing_period: 'calendar_month', pricing_model: 'base_plus_storage',
    storage_price_per_gb_month: '0.20', storage_included_bytes: '200000000000', storage_billing_basis: 'time_weighted_excess',
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
    assert.equal(actual.monthlyPrice, expected.monthly_price);
    assert.equal(actual.currency, expected.currency);
    assert.equal(actual.billingPeriod, expected.billing_period);
    assert.equal(actual.pricingModel, expected.pricing_model);
    assert.equal(actual.storagePricePerGbMonth, expected.storage_price_per_gb_month);
    assert.equal(actual.includedStorageBytes, expected.storage_included_bytes);
    assert.equal(actual.storageBillingBasis, expected.storage_billing_basis);
    assert.equal(actual.monthlyPriceGtq, null);
    assert.equal(actual.active, true);
  }
});

test('S4-01: catálogo no disponible responde 503 sin revelar detalles internos', async (t) => {
  const database = { async query() { throw new Error('private-database-details'); } };
  const server = createApp({ database }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/plans`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
  assert.equal(JSON.stringify(body).includes('private-database-details'), false);
});
