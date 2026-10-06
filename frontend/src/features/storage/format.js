const number = new Intl.NumberFormat('es-GT', { maximumFractionDigits: 1 });
const fullDate = new Intl.DateTimeFormat('es-GT', { dateStyle: 'long', timeStyle: 'short' });
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
