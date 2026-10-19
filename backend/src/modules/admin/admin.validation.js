import { AppError } from '../../lib/app-error.js';

const SUBSCRIPTION_STATUSES = ['active', 'expired', 'cancelled'];
const PLAN_CODE = /^[a-z0-9_-]{1,30}$/;

function single(value, name) {
  if (Array.isArray(value)) {
    throw new AppError(400, 'INVALID_ADMIN_QUERY', `${name} solo admite un valor.`);
  }
  return value;
}

function onlyKeys(query, allowed) {
  const extra = Object.keys(query).filter((key) => !allowed.includes(key));
  if (extra.length) {
    throw new AppError(400, 'INVALID_ADMIN_QUERY', `Parámetros no admitidos: ${extra.join(', ')}. Usa ${allowed.join(', ')}.`);
  }
}

function integer(value, name, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const text = single(value, name);
  if (!/^\d+$/.test(text)) throw new AppError(400, 'INVALID_ADMIN_QUERY', `${name} debe ser un entero.`);
  const number = Number(text);
  if (number < min || number > max) {
    throw new AppError(400, 'INVALID_ADMIN_QUERY', `${name} debe estar entre ${min} y ${max}.`);
  }
  return number;
}

function search(value) {
  if (value === undefined) return null;
  const text = String(single(value, 'search')).trim();
  if (text.length > 100) throw new AppError(400, 'INVALID_ADMIN_QUERY', 'search admite hasta 100 caracteres.');
  return text || null;
}

function planCode(value) {
  if (value === undefined) return null;
  const text = single(value, 'plan');
  if (!PLAN_CODE.test(text)) throw new AppError(400, 'INVALID_ADMIN_QUERY', 'plan debe ser un código de plan válido.');
  return text;
}

function page(query) {
  return {
    limit: integer(query.limit, 'limit', { min: 1, max: 100, fallback: 20 }),
    offset: integer(query.offset, 'offset', { min: 0, max: 1_000_000, fallback: 0 }),
  };
}

export function parseSubscriptionsQuery(query = {}) {
  onlyKeys(query, ['status', 'plan', 'search', 'limit', 'offset']);
  let status = null;
  if (query.status !== undefined) {
    status = single(query.status, 'status');
    if (!SUBSCRIPTION_STATUSES.includes(status)) {
      throw new AppError(400, 'INVALID_ADMIN_QUERY', `status debe ser ${SUBSCRIPTION_STATUSES.join(', ')}.`);
    }
  }
  return { status, plan: planCode(query.plan), search: search(query.search), ...page(query) };
}

export function parseUsageQuery(query = {}) {
  onlyKeys(query, ['plan', 'search', 'limit', 'offset']);
  return { plan: planCode(query.plan), search: search(query.search), ...page(query) };
}

export function parseSummaryQuery(query = {}) {
  onlyKeys(query, []);
  return {};
}
