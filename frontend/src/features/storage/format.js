const number = new Intl.NumberFormat('es-GT', { maximumFractionDigits: 1 });
// Las fechas del servidor vienen en UTC; se muestran siempre en hora de Guatemala.
const fullDate = new Intl.DateTimeFormat('es-GT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Guatemala' });
const shortDate = new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeZone: 'America/Guatemala' });

const dateTime = new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guatemala' });

/** Fecha y hora compactas para filas de tabla. */
export function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : dateTime.format(date);
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : shortDate.format(date);
}

/** Precio del servidor ("8.00", "USD") → "US$8.00". */
export function formatMoney(amount, currency = 'USD') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-GT', { style: 'currency', currency, currencyDisplay: 'symbol' }).format(value);
}
const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** Bytes decimales (1 KB = 1000 B), igual que los límites de los planes. */
export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let index = -1;
  let scaled = bytes;
  do { scaled /= 1000; index += 1; } while (scaled >= 1000 && index < units.length - 1);
  return `${number.format(scaled)} ${units[index]}`;
}

/** Como formatBytes, pero redondea hacia arriba: liberar lo que indica debe alcanzar. */
export function formatBytesCeil(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 1000) return formatBytes(value);
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log10(bytes) / 3) - 1, units.length - 1);
  return `${number.format(Math.ceil((bytes / 1000 ** (index + 1)) * 10) / 10)} ${units[index]}`;
}

export function formatFullDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Fecha no disponible' : fullDate.format(date);
}

export function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const seconds = (date.getTime() - Date.now()) / 1000;
  const steps = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'hace un momento';
}

/** Ahorro de una imagen, en proporción (puede ser negativo si el WebP pesa más). */
export function savingRatio(file) {
  const original = Number(file.originalSizeBytes);
  const webp = Number(file.optimizedSizeBytes);
  return original > 0 && Number.isFinite(webp) ? (original - webp) / original : 0;
}

export function formatPercent(ratio) {
  const value = Math.round(ratio * 100);
  return `${value > 0 ? '−' : value < 0 ? '+' : ''}${Math.abs(value)} %`;
}
