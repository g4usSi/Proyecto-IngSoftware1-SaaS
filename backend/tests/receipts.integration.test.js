// RF-PAG-03: facturas PDF individuales y masivas, envío por correo y forma pública de las respuestas de pago.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createFakeMailer } from './helpers/fake-auth-database.js';
import { fixture as workerFixture } from './helpers/worker-fixture.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.js';

const options = { skip: !process.env.TEST_DATABASE_URL && 'Requiere PostgreSQL temporal.', timeout: 90000 };
const SECRET = 'receipts-test-secret-longer-than-thirty-two-characters';
const OK = { number: '4242424242424242' };
const DENIED = { number: '4000000000000002' };

async function setup(t) {
  const f = await workerFixture(t);
  await f.database.query("INSERT INTO subscriptions(user_id,plan_id) SELECT u.id,p.id FROM users u CROSS JOIN plans p WHERE p.code='free'");
  const tokens = createTokenService({ secret: SECRET, expiresIn: '1h' });
  f.headers = (id) => ({ Authorization: `Bearer ${tokens.issue(id).token}` });
  return f;
}

async function withApi(f, run) {
  const server = createApp({ ...f, mailer: f.mailer ?? createFakeMailer(), storageDemo: false, jwtSecret: SECRET, enqueueJob: async () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (user, route, { method = 'GET', body, key } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(user ? f.headers(user) : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  };
  const json = async (...args) => { const r = await call(...args); return { status: r.status, body: await r.json() }; };
  try { await run({ call, json }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const pay = (json, user, planCode, card = OK) => json(user, '/subscriptions/checkout', { method: 'POST', body: { planCode, card }, key: randomUUID() });

function assertValidPdf(buffer) {
  const text = buffer.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'), 'cabecera PDF');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'fin de archivo PDF');
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref', 'startxref apunta a la tabla xref');
  const count = Number(/xref\n0 (\d+)\n/.exec(text)[1]);
  const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, count - 1);
  entries.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} en su offset`));
  return text;
}

async function waitFor(condition) {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('La condición no se cumplió a tiempo.');
}

test('RF-PAG-03: cada pago aprobado envía una sola factura al correo de la cuenta', options, async (t) => {
  const f = await setup(t);
  f.mailer = createFakeMailer();
  const [a] = f.users;
  await withApi(f, async ({ json }) => {
    const key = randomUUID();
    const first = await json(a, '/subscriptions/checkout', { method: 'POST', body: { planCode: 'standard', card: OK }, key });
    assert.equal(first.status, 201);
    await waitFor(() => f.mailer.invoices.length === 1);

    const [sent] = f.mailer.invoices;
    assert.equal(sent.to, 'a@worker.test');
    assert.match(sent.message.subject, /^Tu factura de SmartStorage SS-[0-9A-F]{8}$/);
    const [pdf, logo] = sent.message.attachments;
    assert.equal(pdf.contentType, 'application/pdf');
    assert.match(pdf.filename, /^factura-[0-9a-f]{8}\.pdf$/);
    assert.ok(assertValidPdf(pdf.content).includes('USD 8.00'));
    assert.equal(logo.cid, 'smartstorage-logo');
    assert.ok(sent.message.html.includes('cid:smartstorage-logo'));
    assert.ok(sent.message.html.includes('USD 8.00'));
    assert.ok(sent.message.html.includes('simulado'));
    assert.ok(!`${sent.message.html}${sent.message.text}`.includes('4242424242424242'), 'nunca el número completo de la tarjeta');

    const repeated = await json(a, '/subscriptions/checkout', { method: 'POST', body: { planCode: 'standard', card: OK }, key });
    assert.equal(repeated.body.data.repeated, true);
    await pay(json, a, 'pro', DENIED);
    await json(a, '/subscriptions/change-plan', { method: 'POST', body: { planCode: 'free' }, key: randomUUID() });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(f.mailer.invoices.length, 1, 'ni el reintento, ni el rechazo, ni bajar de plan envían factura');

    await pay(json, a, 'standard');
    await waitFor(() => f.mailer.invoices.length === 2);
    await json(a, '/subscriptions/renew', { method: 'POST', body: { card: OK }, key: randomUUID() });
    await waitFor(() => f.mailer.invoices.length === 3);
    await json(a, '/subscriptions/change-plan', { method: 'POST', body: { planCode: 'pro', card: OK }, key: randomUUID() });
    await waitFor(() => f.mailer.invoices.length === 4);
    assert.ok(f.mailer.invoices[3].message.html.includes('plan Pro'), 'renovar y mejorar de plan también envían factura');
  });
});

test('RF-PAG-03: si falla el correo, el pago se conserva y la factura se puede descargar', options, async (t) => {
  const f = await setup(t);
  const [a] = f.users;
  const logged = [];
  t.mock.method(console, 'error', (line) => { logged.push(String(line)); });
  f.mailer = { ...createFakeMailer(), async sendInvoice() { throw new Error('smtp caido'); } };
  await withApi(f, async ({ call, json }) => {
    const paid = await pay(json, a, 'standard');
    assert.equal(paid.status, 201);
    assert.equal(paid.body.data.payment.status, 'approved');
    await waitFor(() => logged.some((line) => line.includes('smtp caido')));
    const receipt = await call(a, `/payments/${paid.body.data.payment.id}/receipt`);
    assert.equal(receipt.status, 200);
  });
});

test('RF-PAG-03: factura individual en PDF para un pago aprobado propio', options, async (t) => {
  const f = await setup(t);
  const [a, b] = f.users;
  await withApi(f, async ({ call, json }) => {
    const approved = (await pay(json, a, 'standard')).body.data.payment;
    const rejected = (await pay(json, a, 'pro', DENIED)).body.data.payment;

    const response = await call(a, `/payments/${approved.id}/receipt`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="factura-[0-9a-f]{8}\.pdf"$/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const text = assertValidPdf(Buffer.from(await response.arrayBuffer()));
    const number = `SS-${approved.reference.slice(0, 8).toUpperCase()}`;
    for (const expected of ['FACTURA', `No. ${number}`, approved.reference, 'plan Est', 'USD 8.00', 'PAGADO', '**** 4242', 'a@worker.test', 'validez fiscal']) {
      assert.ok(text.includes(expected), `el PDF debe incluir "${expected}"`);
    }
    assert.ok(!text.includes('4242424242424242'), 'nunca el número completo de la tarjeta');

    const denied = await json(a, `/payments/${rejected.id}/receipt`);
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error.code, 'RECEIPT_NOT_AVAILABLE');
    assert.equal((await json(b, `/payments/${approved.id}/receipt`)).status, 404, 'el pago de otra cuenta no existe');
    assert.equal((await json(a, `/payments/${randomUUID()}/receipt`)).status, 404);
    assert.equal((await json(a, '/payments/no-es-uuid/receipt')).body.error.code, 'INVALID_PAYMENT_ID');
    assert.equal((await json(null, `/payments/${approved.id}/receipt`)).status, 401);
  });
});

test('RF-PAG-03: descarga masiva con una página por pago aprobado', options, async (t) => {
  const f = await setup(t);
  const [a, b] = f.users;
  await withApi(f, async ({ call, json }) => {
    assert.equal((await json(a, '/payments/receipts')).body.error.code, 'NO_RECEIPTS', 'sin pagos aprobados no hay PDF vacío');
    await pay(json, a, 'standard');
    await pay(json, a, 'pro', DENIED);
    await json(a, '/subscriptions/change-plan', { method: 'POST', body: { planCode: 'pro', card: OK }, key: randomUUID() });
    await pay(json, b, 'standard');

    const response = await call(a, '/payments/receipts');
    assert.equal(response.status, 200);
    const text = assertValidPdf(Buffer.from(await response.arrayBuffer()));
    assert.equal((text.match(/\/Type \/Page /g) ?? []).length, 2, 'solo los dos pagos aprobados de A');
    assert.ok(text.includes('USD 15.00') && text.includes('USD 8.00'));
    assert.ok(!text.includes('b@worker.test'), 'no incluye pagos de otra cuenta');
    assert.ok(text.indexOf('USD 15.00') < text.indexOf('USD 8.00'), 'del más reciente al más antiguo');
    assert.equal((await json(null, '/payments/receipts')).status, 401);
  });
});

test('Contrato de pagos: respuestas en camelCase, sin columnas internas, e historial con el plan', options, async (t) => {
  const f = await setup(t);
  const [a] = f.users;
  await withApi(f, async ({ json }) => {
    await pay(json, a, 'standard');
    const renew = await json(a, '/subscriptions/renew', { method: 'POST', body: { card: OK }, key: randomUUID() });
    const change = await json(a, '/subscriptions/change-plan', { method: 'POST', body: { planCode: 'pro', card: OK }, key: randomUUID() });
    const down = await json(a, '/subscriptions/change-plan', { method: 'POST', body: { planCode: 'standard' }, key: randomUUID() });
    for (const response of [renew, change]) {
      assert.deepEqual(Object.keys(response.body.data.payment).sort(), ['amount', 'currency', 'id', 'reference', 'status']);
    }
    for (const response of [renew, change, down]) {
      assert.deepEqual(Object.keys(response.body.data.subscription).sort(), ['expiresAt', 'id', 'startedAt', 'status']);
      assert.ok(Number.isFinite(Date.parse(response.body.data.subscription.expiresAt)));
      const dump = JSON.stringify(response.body);
      assert.ok(!/user_id|plan_id|idempotency|card_last4|started_at|expires_at/.test(dump), 'sin columnas internas');
    }
    assert.equal(down.body.data.changeType, 'downgrade');

    const history = await json(a, '/payments');
    const [latest, ...rest] = history.body.data.payments;
    assert.equal(latest.planCode, 'pro');
    assert.equal(latest.planName, 'Pro');
    assert.equal(rest.at(-1).planCode, 'standard');
    assert.deepEqual(history.body.data.pagination, { page: 1, limit: 10, total: 3, totalPages: 1 });
  });
});

test('Renovar el plan Free no es posible y no registra pagos', options, async (t) => {
  const f = await setup(t);
  const [a] = f.users;
  await withApi(f, async ({ json }) => {
    const renew = await json(a, '/subscriptions/renew', { method: 'POST', body: { card: OK }, key: randomUUID() });
    assert.equal(renew.status, 400);
    assert.equal(renew.body.error.code, 'SUBSCRIPTION_NOT_RENEWABLE');
    assert.equal((await f.database.query('SELECT count(*)::int AS n FROM payments')).rows[0].n, 0);
  });
});
