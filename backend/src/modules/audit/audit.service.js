import { AppError } from '../../lib/app-error.js';
import { UUID_PATTERN } from '../storage/storage.validation.js';

export const AUDIT_EVENT_TYPES = [
  'login_success', 'login_failed', 'logout', 'password_changed', 'password_reset', 'account_status_changed',
];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ALLOWED = new Set(['type', 'userId', 'search', 'limit', 'offset']);

const clip = (value, max) => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null);

// Una falla al auditar nunca debe romper el inicio de sesión ni el cambio de cuenta que se está registrando.
export function createAuditService(repository) {
  return {
    async record(event, meta = {}) {
      try {
        await repository.insert({
          ...event,
          email: clip(event.email, 254),
          ipAddress: clip(meta.ip, 64),
          userAgent: clip(meta.userAgent, 200),
        });
      } catch (error) {
        console.error('No se pudo registrar el evento de auditoría:', error?.message ?? error);
      }
    },

    async list(query = {}) {
      const { type, userId, pattern, limit, offset } = parse(query);
      const { total, rows } = await repository.list({ type, userId, pattern, limit, offset });
      return {
        items: rows.map((row) => ({
          id: row.id,
          type: row.event_type,
          userId: row.user_id,
          actorId: row.actor_id,
          email: row.email,
          detail: row.detail,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        total, limit, offset,
      };
    },
  };
}

function parse(query) {
  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED.has(key) || typeof value !== 'string') invalid('Parámetro de consulta no válido.');
  }
  let type = null;
  if (query.type !== undefined) {
    if (!AUDIT_EVENT_TYPES.includes(query.type)) invalid(`type debe ser uno de: ${AUDIT_EVENT_TYPES.join(', ')}.`);
    type = query.type;
  }
  let userId = null;
  if (query.userId !== undefined) {
    if (!UUID_PATTERN.test(query.userId)) invalid('userId no es un UUID válido.');
    userId = query.userId;
  }
  let pattern = null;
  if (query.search !== undefined) {
    const search = query.search.trim();
    if (search.length > 100) invalid('search no puede superar 100 caracteres.');
    if (search !== '') pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  }
  return { type, userId, pattern, limit: int(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, 'limit'), offset: int(query.offset, 0, 0, 1_000_000, 'offset') };
}

function int(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!/^\d{1,7}$/.test(value) || Number(value) < min || Number(value) > max) {
    invalid(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return Number(value);
}

function invalid(message) {
  throw new AppError(400, 'INVALID_AUDIT_QUERY', message);
}
