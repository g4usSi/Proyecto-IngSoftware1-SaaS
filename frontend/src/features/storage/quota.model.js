import { formatBytes } from './format.js';

// Umbral a partir del cual un medidor avisa que está por llenarse.
export const QUOTA_WARN_RATIO = 0.8;

const dayFormat = new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const countFormat = new Intl.NumberFormat('es-GT');

/** "2026-10-08" → "8 de octubre". La fecha ya viene en el día de Guatemala. */
export function formatQuotaDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? '' : dayFormat.format(date);
}

function meter({ key, label, used, reserved, limit, format }) {
  const total = used + reserved;
  const unlimited = limit === null;
  const ratio = unlimited || limit <= 0 ? 0 : Math.min(1, total / limit);
  const level = unlimited ? 'ok' : total >= limit ? 'full' : ratio >= QUOTA_WARN_RATIO ? 'warn' : 'ok';
  return {
    key, label, used, reserved, limit, total, unlimited, ratio, level, format,
    // Proporción de la barra que ocupa cada parte; la reserva se dibuja a continuación de lo usado.
    usedShare: unlimited || limit <= 0 ? 0 : Math.min(1, used / limit),
    reservedShare: unlimited || limit <= 0 ? 0 : Math.min(1, total / limit) - Math.min(1, used / limit),
    free: unlimited ? null : Math.max(0, limit - total),
  };
}

/**
 * Traduce la respuesta de GET /api/quotas/me (cifras como strings decimales)
 * a tres medidores: capacidad del plan, subidas del día y bytes enviados del día.
 */
export function describeQuota(data) {
  if (!data) return null;
  const daily = data.daily;
  const optional = (value) => (value === null ? null : Number(value));
  const meters = [
    meter({ key: 'storage', label: 'Almacenamiento', used: Number(data.usedBytes), reserved: Number(data.reservedBytes), limit: Number(data.capacityBytes), format: formatBytes }),
    meter({ key: 'uploads', label: 'Subidas de hoy', used: Number(daily.uploadsUsed), reserved: Number(daily.uploadsReserved), limit: optional(daily.uploadLimit), format: (value) => countFormat.format(value) }),
    meter({ key: 'bytes', label: 'Enviado hoy', used: Number(daily.bytesUsed), reserved: Number(daily.bytesReserved), limit: optional(daily.bytesLimit), format: formatBytes }),
  ];
  // El servidor ya descuenta reservas en availableBytes; se respeta su cálculo para la capacidad.
  if (BigInt(data.availableBytes) === 0n) meters[0].level = 'full';
  const full = meters.filter((item) => item.level === 'full');
  const warn = meters.filter((item) => item.level === 'warn');
  return {
    plan: data.plan,
    day: daily.date,
    meters,
    level: full.length ? 'full' : warn.length ? 'warn' : 'ok',
    blocking: full,
    pending: Number(daily.uploadsReserved) > 0 || Number(data.reservedBytes) > 0,
  };
}
