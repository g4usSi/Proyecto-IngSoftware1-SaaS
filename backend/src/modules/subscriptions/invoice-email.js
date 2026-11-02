import { readFileSync } from 'node:fs';

// PNG porque los clientes de correo no muestran SVG. Mismo logo que frontend/src/assets/brand.
const LOGO_PNG = readFileSync(new URL('../../../assets/smartstorage-logo.png', import.meta.url));
const LOGO_CID = 'smartstorage-logo';

const dateOnly = new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', dateStyle: 'long' });

// El nombre lo escribe el usuario: sin escapar podría inyectar HTML en el correo.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function row(label, value) {
  return `<tr>
<td style="padding:9px 0;border-bottom:1px solid #E7EAED;color:#5F6B7A;font-size:14px">${label}</td>
<td align="right" style="padding:9px 0;border-bottom:1px solid #E7EAED;color:#171325;font-size:14px;font-weight:600">${escapeHtml(value)}</td>
</tr>`;
}

// Mensaje listo para el transporte: asunto, texto, HTML, factura adjunta y logo incrustado.
export function invoiceEmail({ invoice, pdf, filename, expiresAt, paymentsUrl }) {
  const validUntil = expiresAt ? dateOnly.format(new Date(expiresAt)) : null;
  const details = [
    ['Factura', invoice.number],
    ['Fecha', invoice.date],
    ['Concepto', invoice.concept],
    ...(validUntil ? [['Vigente hasta', validUntil]] : []),
    ['Tarjeta de prueba', `**** ${invoice.cardLast4}`],
  ];
  const notice = 'Pago simulado con fines académicos: no se realizó ningún cobro real y la factura no tiene validez fiscal.';

  const text = [
    `Hola, ${invoice.customerName}:`,
    '',
    'Gracias por tu pago. Adjuntamos tu factura en PDF.',
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    `Total pagado: ${invoice.total}`,
    '',
    `Consulta tus pagos: ${paymentsUrl}`,
    '',
    notice,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#F6F7F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E7EAED;border-top:6px solid #FB7A3C;border-radius:8px">
<tr><td style="padding:24px 28px 8px"><img src="cid:${LOGO_CID}" width="170" alt="SmartStorage" style="display:block;border:0;width:170px;height:auto"></td></tr>
<tr><td style="padding:8px 28px 0">
<h1 style="margin:0 0 8px;color:#1B304A;font-size:22px;line-height:1.3">¡Gracias por tu pago, ${escapeHtml(invoice.customerName)}!</h1>
<p style="margin:0 0 16px;color:#5F6B7A;font-size:15px;line-height:1.5">Tu factura está adjunta en PDF. Este es el resumen de tu compra:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${details.map(([label, value]) => row(label, value)).join('\n')}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:#1B304A;border-radius:6px"><tr>
<td style="padding:13px 16px;color:#FFFFFF;font-size:15px;font-weight:700">Total pagado</td>
<td align="right" style="padding:13px 16px;color:#FFFFFF;font-size:18px;font-weight:700">${escapeHtml(invoice.total)}</td>
</tr></table>
<p style="margin:22px 0"><a href="${escapeHtml(paymentsUrl)}" style="display:inline-block;padding:11px 18px;background:#FB7A3C;color:#16273D;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none">Ver mis pagos</a></p>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #E7EAED;color:#5F6B7A;font-size:12px;line-height:1.5">${notice}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return {
    subject: `Tu factura de SmartStorage ${invoice.number}`,
    text,
    html,
    attachments: [
      { filename, content: pdf, contentType: 'application/pdf' },
      { filename: 'smartstorage-logo.png', content: LOGO_PNG, contentType: 'image/png', cid: LOGO_CID },
    ],
  };
}
