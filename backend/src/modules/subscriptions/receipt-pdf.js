// RF-PAG-03: recibos en PDF sin dependencias externas. Genera texto con la fuente estándar Helvetica
// (WinAnsi), una página por recibo; suficiente para un comprobante académico de pago simulado.
const PAGE = { width: 595, height: 842 };

function escapeText(text) {
  return String(text).replace(/[\\()]/g, (c) => `\\${c}`);
}

function pageStream(lines) {
  const ops = ['BT'];
  let y = 770;
  for (const { text, size = 11, bold = false, gap = 22 } of lines) {
    ops.push(`/${bold ? 'F2' : 'F1'} ${size} Tf`, `1 0 0 1 56 ${y} Tm`, `(${escapeText(text)}) Tj`);
    y -= gap;
  }
  ops.push('ET');
  return Buffer.from(ops.join('\n'), 'latin1');
}

// pages: arreglo de arreglos de líneas { text, size?, bold?, gap? }
export function buildPdf(pages) {
  const objects = []; // cada elemento es un Buffer con el contenido del objeto
  const add = (body) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objects.length; };

  const catalog = add('');           // 1, se completa abajo
  const tree = add('');              // 2
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'); // 4
  const kids = [];
  for (const lines of pages) {
    const stream = pageStream(lines);
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]));
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${tree} 0 R >>`, 'latin1');
  objects[tree - 1] = Buffer.from(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`, 'latin1');

  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(chunk);
    position += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${position}\n%%EOF\n`].join('');
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

const dateFormat = new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', dateStyle: 'long', timeStyle: 'short' });

export function receiptLines(row) {
  return [
    { text: 'SmartStorage', size: 22, bold: true, gap: 28 },
    { text: 'Recibo de pago', size: 15, bold: true, gap: 34 },
    { text: `Referencia: ${row.reference}` },
    { text: `Fecha: ${dateFormat.format(new Date(row.created_at))} (hora de Guatemala)` },
    { text: `Cliente: ${row.user_name}`, gap: 18 },
    { text: `Correo: ${row.user_email}`, gap: 34 },
    { text: 'Concepto', bold: true, gap: 18 },
    { text: `Suscripcion mensual al plan ${row.plan_name}`, gap: 34 },
    { text: 'Monto', bold: true, gap: 18 },
    { text: `${row.currency} ${row.amount}`, size: 16, bold: true, gap: 34 },
    { text: 'Estado: Pagado', bold: true },
    { text: `Medio de pago: tarjeta de prueba terminada en ${String(row.card_last4).trim()}`, gap: 44 },
    { text: 'Pago simulado con fines academicos. Este documento no tiene validez fiscal.', size: 9 },
  ];
}
