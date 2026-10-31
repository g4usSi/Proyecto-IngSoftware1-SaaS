import { useEffect, useState } from 'react';
import { ApiError, apiRequest, downloadAuthorized } from '../../services/api.js';
import { formatBytes, formatMoney } from '../storage/format.js';

// ── Catálogo público (GET /plans) ──
let catalogPromise = null;

/** Los planes cambian poco: una sola consulta por carga de página; un fallo permite reintentar. */
export function listPlans() {
  catalogPromise ??= apiRequest('/plans').then((plans) => {
    if (!Array.isArray(plans)) throw new ApiError('El catálogo de planes tiene un formato inesperado.', 'INVALID_RESPONSE', 200);
    return plans;
  }).catch((error) => { catalogPromise = null; throw error; });
  return catalogPromise;
}

export function usePlans() {
  const [state, setState] = useState({ plans: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    listPlans()
      .then((plans) => { if (active) setState({ plans, loading: false, error: null }); })
      .catch((error) => { if (active) setState({ plans: [], loading: false, error: error instanceof ApiError ? error.message : 'No se pudo consultar el catálogo de planes.' }); });
    return () => { active = false; };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

/** Texto de marketing por plan (sin precios ni cifras: esos salen del servidor). */
export const PLAN_TAGLINES = {
  free: 'Para empezar a guardar tus imágenes.',
  standard: 'Para quienes suben imágenes con frecuencia.',
  pro: 'Para proyectos con mucho volumen.',
  enterprise: 'Para organizaciones con necesidades a medida.',
};

// Orden comercial del servidor (free < standard < pro < enterprise); decide subir o bajar.
export const PLAN_LEVELS = { free: 0, standard: 1, pro: 2, enterprise: 3 };
export const isFreePlan = (plan) => plan?.code === 'free';

export function planPrice(plan) {
  const value = Number(plan?.monthlyPrice);
  return value > 0 ? formatMoney(plan.monthlyPrice, plan.currency) : 'Gratis';
}

/** Si lo usado y reservado no cabe en el plan, los mismos datos que daría 409 PLAN_CAPACITY_EXCEEDED; si cabe, null. */
export function capacityShortfall(quota, plan) {
  if (!quota) return null;
  const committed = BigInt(quota.usedBytes) + BigInt(quota.reservedBytes ?? 0);
  const capacity = BigInt(plan.capacityBytes);
  if (committed <= capacity) return null;
  return { capacityBytes: plan.capacityBytes, usedBytes: quota.usedBytes, reservedBytes: quota.reservedBytes ?? '0', bytesToFree: String(committed - capacity) };
}

/** Beneficios que salen de los campos reales del plan; nada que el servidor no ofrezca. */
export function planFeatures(plan) {
  const uploads = plan.dailyUploadLimit === null ? null : Number(plan.dailyUploadLimit);
  const bytes = plan.dailyBytesLimit === null ? null : formatBytes(plan.dailyBytesLimit);
  const daily = uploads === null && bytes === null ? 'Sin límite diario de subidas'
    : uploads !== null && bytes !== null ? `${uploads} subidas o ${bytes} al día`
      : uploads !== null ? `${uploads} subidas al día` : `${bytes} de subida al día`;
  const features = [`${formatBytes(plan.capacityBytes)} de almacenamiento`, daily];
  if (plan.storagePricePerGbMonth && plan.includedStorageBytes) {
    features.push(`${formatMoney(plan.storagePricePerGbMonth, plan.currency)} por GB-mes sobre ${formatBytes(plan.includedStorageBytes)} incluidos`);
  }
  features.push('Conversión a WebP y deduplicación');
  return features;
}

// ── Suscripción y pagos (requieren token) ──
export const getMySubscription = (options) => apiRequest('/subscriptions/me', options);

const paid = (path, body, { idempotencyKey, ...options }) => apiRequest(path, {
  ...options, method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey },
});
export const checkout = ({ planCode, cardNumber }, options) => paid('/subscriptions/checkout', { planCode, card: { number: cardNumber } }, options);
export const renew = ({ cardNumber }, options) => paid('/subscriptions/renew', { card: { number: cardNumber } }, options);
/** Subir lleva tarjeta e idempotencia; bajar no cobra y no necesita ninguna de las dos. */
export const changePlan = ({ planCode, cardNumber }, { idempotencyKey, ...options }) => (cardNumber
  ? paid('/subscriptions/change-plan', { planCode, card: { number: cardNumber } }, { idempotencyKey, ...options })
  : apiRequest('/subscriptions/change-plan', { ...options, method: 'POST', body: { planCode } }));

export async function listPayments({ page = 1, limit = 10, ...options } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  const data = await apiRequest(`/payments?${query}`, options);
  if (!Array.isArray(data?.payments) || !data.pagination) {
    throw new ApiError('El historial de pagos tiene un formato inesperado.', 'INVALID_RESPONSE', 200);
  }
  return data;
}

export const downloadReceipt = (payment, options) => downloadAuthorized(`/payments/${encodeURIComponent(payment.id)}/receipt`,
  { ...options, fallbackName: `factura-${payment.reference ?? payment.id}.pdf` });
export const downloadAllReceipts = (options) => downloadAuthorized('/payments/receipts', { ...options, fallbackName: 'facturas-smartstorage.pdf' });

export const PAYMENT_STATUS = {
  approved: { label: 'Pagado', tone: 'success' },
  rejected: { label: 'Rechazado', tone: 'danger' },
  error: { label: 'Error', tone: 'danger' },
};
