// RF-PAG-03: factura en PDF sin dependencias externas. Dibuja con operadores PDF y las fuentes
// estándar Helvetica (WinAnsi); una página por pago. El pago es simulado y no tiene validez fiscal.
const PAGE = { width: 595, height: 842, margin: 48 };
const RIGHT = PAGE.width - PAGE.margin;
const COLOR = {
  navy: '#1B304A', orange: '#FB7A3C', ink: '#171325', muted: '#5F6B7A', paper: '#FDF3EA',
  border: '#DDE1E6', tint: '#F6F7F8', white: '#FFFFFF', success: '#2F7D5B', successSoft: '#E4F1EB', accentText: '#A45333',
};

// Anchos de las fuentes estándar (Adobe AFM, 1/1000 de em) para ASCII 32-126; alinean a la derecha sin medir en el visor.
const WIDTHS = {
  regular: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
  bold: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
};

// Logo vectorial: mismos trazados que frontend/src/assets/brand/smartstorage-principal.svg (viewBox 904 × 176).
const LOGO_RATIO = 176 / 904;
const LOGO_PIECE = 'M50.614 0.800 Q52.000 0.000 53.386 0.800 L102.614 29.200 Q104.000 30.000 104.000 31.600 L104.000 51.400 Q104.000 53.000 102.614 53.799 L99.386 55.661 Q98.000 56.460 96.614 55.660 L53.386 30.700 Q52.000 29.900 50.614 30.700 L22.036 47.200 Q20.650 48.000 22.250 48.000 L34.400 48.000 Q36.000 48.000 36.000 49.600 L36.000 76.400 Q36.000 78.000 34.614 77.200 L1.386 58.020 Q0.000 57.220 0.000 55.620 L0.000 31.600 Q0.000 30.000 1.386 29.200 Z';
const S = 'M52 12C42 1 13 1 8 18C2 37 27 38 39 43C58 50 57 70 40 77C27 82 12 78 4 68';
const M = 'M5 80V28M5 46C5 20 36 20 36 44V80M36 44C36 20 67 20 67 44V80';
const A = 'M52 53C52 20 4 20 4 53C4 86 52 86 52 53ZM52 28V80';
const R = 'M5 80V28M5 46C5 28 22 23 34 29';
const T = 'M15 9V62C15 78 27 83 37 75M1 29H36';
const O = 'M52 53C52 20 4 20 4 53C4 86 52 86 52 53Z';
const G = 'M52 53C52 20 4 20 4 53C4 86 52 86 52 53ZM52 28V80C52 102 24 108 8 94';
const E = 'M4 52H51C51 18 4 18 4 52C4 81 34 87 50 72';
const LOGO_LETTERS = [[0, S], [66, M], [146, A], [212, R], [256, T], [308, S], [374, T], [421, O], [487, R], [531, A], [597, G], [663, E]];

const num = (value) => Number(value.toFixed(3)).toString();
const rgb = (hex) => [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

// Convierte un trazado SVG absoluto (M, L, H, V, C, Q, Z) a operadores PDF.
function pathOps(d) {
  const tokens = d.match(/[MLHVCQZ]|-?\d+(?:\.\d+)?/g);
  const ops = [];
  let i = 0;
  let x = 0;
  let y = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M' || command === 'L') {
      x = next(); y = next();
      ops.push(`${num(x)} ${num(y)} ${command === 'M' ? 'm' : 'l'}`);
    } else if (command === 'H' || command === 'V') {
      if (command === 'H') x = next(); else y = next();
      ops.push(`${num(x)} ${num(y)} l`);
    } else if (command === 'C') {
      const [a, b, c, e, f, g] = [next(), next(), next(), next(), next(), next()];
      ops.push(`${num(a)} ${num(b)} ${num(c)} ${num(e)} ${num(f)} ${num(g)} c`);
      x = f; y = g;
    } else if (command === 'Q') {
      const [qx, qy, ex, ey] = [next(), next(), next(), next()];
      const toControl = (from, control) => from + (2 / 3) * (control - from);
      ops.push(`${num(toControl(x, qx))} ${num(toControl(y, qy))} ${num(toControl(ex, qx))} ${num(toControl(ey, qy))} ${num(ex)} ${num(ey)} c`);
      x = ex; y = ey;
    } else if (command === 'Z') {
      ops.push('h');
    }
  }
  return ops.join(' ');
}

function logoOps(x, top, width) {
  const scale = width / 904;
  // Invierte el eje Y para usar las coordenadas del SVG tal como están; 24 es el margen interno del viewBox.
  return [
    `q ${num(scale)} 0 0 ${num(-scale)} ${num(x - 24 * scale)} ${num(PAGE.height - top)} cm`,
    `q 1 0 0 1 24 26 cm ${rgb(COLOR.navy)} rg ${pathOps(LOGO_PIECE)} f`,
    `-1 0 0 -1 104 124 cm ${rgb(COLOR.orange)} rg ${pathOps(LOGO_PIECE)} f Q`,
    `q 1 0 0 1 160 38 cm ${rgb(COLOR.ink)} RG 8.3 w 0 J 1 j`,
    ...LOGO_LETTERS.map(([dx, d]) => `q 1 0 0 1 ${dx} 0 cm ${pathOps(d)} S Q`),
    'Q Q',
  ].join('\n');
}

// WinAnsi no representa todos los alfabetos: lo que no cabe se muestra como «?» para no corromper el texto.
function clean(text) {
  return String(text).normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function textWidth(text, size, bold) {
  const table = bold ? WIDTHS.bold : WIDTHS.regular;
  let total = 0;
  for (const char of text) {
    const base = char.normalize('NFD')[0].charCodeAt(0);
    total += table[base - 32] ?? 556;
  }
  return (total * size) / 1000;
}

function fit(text, size, bold, maxWidth) {
  if (!maxWidth || textWidth(text, size, bold) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

// Lienzo con origen arriba a la izquierda: los valores de "y" crecen hacia abajo.
function createCanvas() {
  const ops = [];
  const roundedPath = (x, bottom, w, h, r) => {
    const k = r * 0.5523;
    const right = x + w;
    const top = bottom + h;
    return [
      `${num(x + r)} ${num(bottom)} m ${num(right - r)} ${num(bottom)} l`,
      `${num(right - r + k)} ${num(bottom)} ${num(right)} ${num(bottom + r - k)} ${num(right)} ${num(bottom + r)} c`,
      `${num(right)} ${num(top - r)} l ${num(right)} ${num(top - r + k)} ${num(right - r + k)} ${num(top)} ${num(right - r)} ${num(top)} c`,
      `${num(x + r)} ${num(top)} l ${num(x + r - k)} ${num(top)} ${num(x)} ${num(top - r + k)} ${num(x)} ${num(top - r)} c`,
      `${num(x)} ${num(bottom + r)} l ${num(x)} ${num(bottom + r - k)} ${num(x + r - k)} ${num(bottom)} ${num(x + r)} ${num(bottom)} c h`,
    ].join(' ');
  };
  return {
    box(x, y, w, h, { fill, stroke, radius = 0 } = {}) {
      const bottom = PAGE.height - y - h;
      const path = radius ? roundedPath(x, bottom, w, h, radius) : `${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re`;
      if (fill) ops.push(`${rgb(fill)} rg`);
      if (stroke) ops.push(`${rgb(stroke)} RG 0.75 w`);
      ops.push(`${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    },
    line(x1, x2, y, color = COLOR.border) {
      const py = num(PAGE.height - y);
      ops.push(`${rgb(color)} RG 0.75 w ${num(x1)} ${py} m ${num(x2)} ${py} l S`);
    },
    text(value, x, y, { size = 10, bold = false, color = COLOR.ink, align = 'left', maxWidth } = {}) {
      const content = fit(clean(value), size, bold, maxWidth);
      const width = textWidth(content, size, bold);
      const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
      const escaped = content.replace(/[\\()]/g, (c) => `\\${c}`);
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${num(left)} ${num(PAGE.height - y)} Tm (${escaped}) Tj ET`);
    },
    logo(x, y, width) { ops.push(logoOps(x, y, width)); },
    toBuffer() { return Buffer.from(ops.join('\n'), 'latin1'); },
  };
}

// pages: arreglo de Buffers con el contenido de cada página.
export function buildPdf(pages) {
  const objects = []; // cada elemento es un Buffer con el contenido del objeto
  const add = (body) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objects.length; };

  const catalog = add('');           // 1, se completa abajo
  const tree = add('');              // 2
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'); // 4
  const kids = [];
  for (const stream of pages) {
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

function capacityLabel(bytes) {
  const gigabytes = Number(bytes) / 1e9;
  return Number.isFinite(gigabytes) && gigabytes > 0 ? `${Number(gigabytes.toFixed(1))} GB de almacenamiento` : 'Almacenamiento';
}

// Datos de la factura que comparten el PDF y el correo.
export function invoiceDetails(row) {
  return {
    number: `SS-${row.reference.slice(0, 8).toUpperCase()}`,
    reference: row.reference,
    date: `${dateFormat.format(new Date(row.created_at))} (hora de Guatemala)`,
    concept: `Suscripción mensual al plan ${row.plan_name}`,
    detail: `${capacityLabel(row.capacity_bytes)}, vigencia de un mes calendario`,
    total: `${row.currency} ${row.amount}`,
    noTax: `${row.currency} 0.00`,
    cardLast4: String(row.card_last4).trim(),
    customerName: row.user_name,
    customerEmail: row.user_email,
  };
}

export function invoicePage(row) {
  const invoice = invoiceDetails(row);
  const { margin } = PAGE;
  const canvas = createCanvas();

  canvas.box(0, 0, PAGE.width, 10, { fill: COLOR.orange });

  // Encabezado: quien emite, a la izquierda; datos de la factura, a la derecha.
  canvas.logo(margin, 34, 180);
  canvas.text('Almacenamiento inteligente de imágenes', margin, 88, { size: 9, color: COLOR.muted });
  canvas.text('Quetzaltenango, Guatemala', margin, 101, { size: 9, color: COLOR.muted });
  canvas.text('FACTURA', RIGHT, 58, { size: 26, bold: true, color: COLOR.navy, align: 'right' });
  canvas.text(`No. ${invoice.number}`, RIGHT, 77, { size: 11, bold: true, color: COLOR.accentText, align: 'right' });
  canvas.text('Fecha de emisión', RIGHT, 92, { size: 8, color: COLOR.muted, align: 'right' });
  canvas.text(invoice.date, RIGHT, 104, { size: 9, align: 'right' });
  canvas.line(margin, RIGHT, 120);

  // Cliente y pago.
  const cardTop = 136;
  const cardHeight = 96;
  const cardWidth = 241;
  const secondX = RIGHT - cardWidth;
  canvas.box(margin, cardTop, cardWidth, cardHeight, { fill: COLOR.tint, stroke: COLOR.border, radius: 8 });
  canvas.box(secondX, cardTop, cardWidth, cardHeight, { fill: COLOR.tint, stroke: COLOR.border, radius: 8 });

  canvas.text('FACTURAR A', margin + 14, cardTop + 21, { size: 8, bold: true, color: COLOR.accentText });
  canvas.text(invoice.customerName, margin + 14, cardTop + 41, { size: 11, bold: true, maxWidth: cardWidth - 28 });
  canvas.text(invoice.customerEmail, margin + 14, cardTop + 57, { size: 9.5, maxWidth: cardWidth - 28 });
  canvas.text('NIT: CF (consumidor final)', margin + 14, cardTop + 73, { size: 9, color: COLOR.muted });

  const labelX = secondX + 14;
  const valueX = secondX + 72;
  canvas.text('DETALLE DEL PAGO', labelX, cardTop + 21, { size: 8, bold: true, color: COLOR.accentText });
  canvas.text('Estado', labelX, cardTop + 41, { size: 9, color: COLOR.muted });
  canvas.box(valueX, cardTop + 30, 52, 15, { fill: COLOR.successSoft, radius: 7 });
  canvas.text('PAGADO', valueX + 26, cardTop + 41, { size: 8, bold: true, color: COLOR.success, align: 'center' });
  canvas.text('Medio', labelX, cardTop + 60, { size: 9, color: COLOR.muted });
  canvas.text(`Tarjeta de prueba **** ${invoice.cardLast4}`, valueX, cardTop + 60, { size: 9 });
  canvas.text('Referencia', labelX, cardTop + 78, { size: 9, color: COLOR.muted });
  canvas.text(invoice.reference, valueX, cardTop + 78, { size: 7, maxWidth: cardWidth - 82 });

  // Detalle de lo cobrado.
  const tableTop = 256;
  const columns = { quantity: 345, price: 440, amount: RIGHT - 12 };
  canvas.box(margin, tableTop, RIGHT - margin, 26, { fill: COLOR.navy });
  const headerY = tableTop + 17;
  const header = { size: 9, bold: true, color: COLOR.white };
  canvas.text('Descripción', margin + 12, headerY, header);
  canvas.text('Cant.', columns.quantity, headerY, { ...header, align: 'right' });
  canvas.text('Precio unitario', columns.price, headerY, { ...header, align: 'right' });
  canvas.text('Importe', columns.amount, headerY, { ...header, align: 'right' });
  const rowY = tableTop + 46;
  canvas.text(invoice.concept, margin + 12, rowY, { size: 10.5, bold: true, maxWidth: 260 });
  canvas.text(invoice.detail, margin + 12, rowY + 15, { size: 8.5, color: COLOR.muted, maxWidth: 260 });
  canvas.text('1', columns.quantity, rowY + 6, { align: 'right' });
  canvas.text(invoice.total, columns.price, rowY + 6, { align: 'right' });
  canvas.text(invoice.total, columns.amount, rowY + 6, { bold: true, align: 'right' });
  canvas.line(margin, RIGHT, tableTop + 78);

  // Totales.
  const totalsLabelX = 352;
  const totalsTop = tableTop + 100;
  canvas.text('Subtotal', totalsLabelX, totalsTop, { color: COLOR.muted });
  canvas.text(invoice.total, columns.amount, totalsTop, { align: 'right' });
  canvas.text('Impuestos (pago simulado)', totalsLabelX, totalsTop + 19, { size: 9, color: COLOR.muted });
  canvas.text(invoice.noTax, columns.amount, totalsTop + 19, { align: 'right' });
  canvas.box(340, totalsTop + 32, RIGHT - 340, 36, { fill: COLOR.navy, radius: 6 });
  canvas.text('Total pagado', totalsLabelX, totalsTop + 55, { size: 10.5, bold: true, color: COLOR.white });
  canvas.text(invoice.total, columns.amount, totalsTop + 56, { size: 14, bold: true, color: COLOR.white, align: 'right' });

  canvas.text('¡Gracias por confiar en SmartStorage!', margin, totalsTop + 8, { size: 11, bold: true, color: COLOR.navy });
  canvas.text('Consulta tus pagos y descarga tus facturas', margin, totalsTop + 26, { size: 9, color: COLOR.muted });
  canvas.text('en la sección Pagos de tu cuenta.', margin, totalsTop + 39, { size: 9, color: COLOR.muted });

  // Pie.
  canvas.line(margin, RIGHT, 772);
  canvas.text('Pago simulado con fines académicos. No se realizó ningún cobro real.', PAGE.width / 2, 790, { size: 8.5, color: COLOR.muted, align: 'center' });
  canvas.text('Este documento no tiene validez fiscal.', PAGE.width / 2, 803, { size: 8.5, color: COLOR.muted, align: 'center' });
  canvas.box(0, PAGE.height - 6, PAGE.width, 6, { fill: COLOR.navy });

  return canvas.toBuffer();
}
