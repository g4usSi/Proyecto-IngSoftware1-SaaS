import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../lib/app-error.js';
import { UUID_PATTERN } from '../storage/storage.validation.js';

// CU-14 / RNF-STO-03. Formato de clave: "ss_" + 32 caracteres base64url (192 bits aleatorios).
export const API_KEY_PREFIX = 'ss_';
export const SDK_PLANS = ['standard', 'pro', 'enterprise'];
const MAX_ACTIVE_KEYS = 5;
const KEY_PATTERN = /^ss_[A-Za-z0-9_-]{32}$/;

const hashKey = (key) => createHash('sha256').update(key).digest('hex');

function publicKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
}

function planRequired() {
  return new AppError(403, 'PLAN_REQUIRED', 'Las claves de API y el SDK están disponibles desde el plan Estándar.');
}

export function createApiKeysService(repository) {
  async function assertEligible(userId) {
    if (!SDK_PLANS.includes(await repository.currentPlanCode(userId))) throw planRequired();
  }

  return {
    isApiKey: (token) => typeof token === 'string' && token.startsWith(API_KEY_PREFIX),

    async list(userId) {
      const [rows, planCode] = await Promise.all([repository.list(userId), repository.currentPlanCode(userId)]);
      return { items: rows.map(publicKey), eligible: SDK_PLANS.includes(planCode), maxActive: MAX_ACTIVE_KEYS };
    },

    async create(userId, body) {
      const raw = body?.name === undefined ? 'Clave de API' : body.name;
      if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 60) {
        throw new AppError(400, 'VALIDATION_ERROR', 'El nombre de la clave debe tener entre 1 y 60 caracteres.');
      }
      await assertEligible(userId);
      if (await repository.countActive(userId) >= MAX_ACTIVE_KEYS) {
        throw new AppError(409, 'API_KEY_LIMIT', `Puedes tener hasta ${MAX_ACTIVE_KEYS} claves activas. Revoca una antes de crear otra.`);
      }
      const secret = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
      const row = await repository.create({ userId, name: raw.trim(), prefix: secret.slice(0, 11), hash: hashKey(secret) });
      // Única vez que la clave completa sale del servidor.
      return { key: publicKey(row), secret };
    },

    async revoke(userId, keyId) {
      if (typeof keyId !== 'string' || !UUID_PATTERN.test(keyId)) {
        throw new AppError(400, 'INVALID_API_KEY_ID', 'El ID de la clave no es válido.');
      }
      const row = await repository.revoke(userId, keyId);
      if (!row) throw new AppError(404, 'API_KEY_NOT_FOUND', 'La clave no existe o no pertenece a esta cuenta.');
      return publicKey(row);
    },

    // Identidad de una petición con "Authorization: Bearer ss_...".
    async authenticate(token) {
      const row = KEY_PATTERN.test(token) ? await repository.findActiveByHash(hashKey(token)) : null;
      if (!row) throw new AppError(401, 'API_KEY_INVALID', 'La clave de API no es válida o fue revocada.');
      if (!row.active) throw new AppError(403, 'ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Contacta al administrador.');
      await assertEligible(row.user_id);
      await repository.touch(row.id);
      return { user: { id: row.user_id, email: row.email, role: row.role }, session: null, apiKey: { id: row.id } };
    },
  };
}
