// RF-PAG-03: contenido de la factura y del correo, sin base de datos ni SMTP.
import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceEmail } from '../src/modules/subscriptions/invoice-email.js';
import { buildPdf, invoiceDetails, invoicePage } from '../src/modules/subscriptions/receipt-pdf.js';

const row = (overrides = {}) => ({
  reference: 'abcdef12-3456-4789-8abc-def012345678',
  amount: '15.00',
  currency: 'USD',
  card_last4: '4242',
  created_at: '2026-10-30T18:00:00.000Z',
  plan_name: 'Pro',
  capacity_bytes: '100000000000',
  user_name: 'Sofía Ramírez',
  user_email: 'sofia@ejemplo.test',
  ...overrides,
});

test('La factura incluye logo vectorial, número, cliente, detalle y aviso de pago simulado', () => {
  const text = buildPdf([invoicePage(row())]).toString('latin1');
  for (const expected of ['FACTURA', 'No. SS-ABCDEF12', 'Sof\xeda Ram\xedrez', 'sofia@ejemplo.test', 'NIT: CF', 'plan Pro',
    '100 GB de almacenamiento', 'USD 15.00', 'USD 0.00', 'Total pagado', 'PAGADO', '**** 4242', 'validez fiscal']) {
    assert.ok(text.includes(expected), `falta "${expected}"`);
  }
  assert.ok(text.includes('0.984 0.478 0.235 rg'), 'naranja de marca en el logo');
  assert.equal((text.match(/ S Q/g) ?? []).length, 12, 'las doce letras del logo');
});

test('La factura escapa paréntesis y no corrompe textos fuera de WinAnsi', () => {
  const text = invoicePage(row({ user_name: 'Ana (\\prueba) 李' })).toString('latin1');
  assert.ok(text.includes('Ana \\(\\\\prueba\\) ?'));
});

test('Un nombre muy largo se recorta para no salirse de su recuadro', () => {
  const text = invoicePage(row({ user_name: 'N'.repeat(300) })).toString('latin1');
  assert.ok(!text.includes('N'.repeat(60)));
  assert.match(text, /N+\.\.\.\) Tj/);
});

test('El correo escapa el nombre, adjunta la factura y avisa que el pago es simulado', () => {
  const pdf = buildPdf([invoicePage(row())]);
  const message = invoiceEmail({
    invoice: invoiceDetails(row({ user_name: '<img src=x onerror=alert(1)>' })),
    pdf,
    filename: 'factura-abcdef12.pdf',
    expiresAt: '2026-11-30T18:00:00.000Z',
    paymentsUrl: 'http://localhost:5173/app/payments',
  });
  assert.equal(message.subject, 'Tu factura de SmartStorage SS-ABCDEF12');
  assert.ok(!message.html.includes('<img src=x'));
  assert.ok(message.html.includes('&lt;img src=x'));
  assert.ok(message.html.includes('noviembre'), 'muestra la vigencia');
  assert.ok(message.text.includes('no se realizó ningún cobro real'));
  assert.equal(message.attachments[0].content, pdf);
  assert.ok(message.attachments[1].content.subarray(1, 4).equals(Buffer.from('PNG')));
});
