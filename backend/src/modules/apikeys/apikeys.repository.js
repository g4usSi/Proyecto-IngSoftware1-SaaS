// Acceso a datos de las claves de API (migración 016). Solo se guarda la huella SHA-256 de cada clave.
export function createApiKeysRepository(database) {
  return {
    async currentPlanCode(userId) {
      const { rows: [row] } = await database.query(`
        SELECT p.code
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.user_id = $1 AND s.status = 'active' AND p.active
           AND s.started_at <= now() AND (s.expires_at IS NULL OR s.expires_at > now())
         ORDER BY s.started_at DESC
         LIMIT 1`, [userId]);
      return row?.code ?? null;
    },

    async countActive(userId) {
      const { rows: [row] } = await database.query(
        'SELECT count(*)::int AS total FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      return row.total;
    },

    async create({ userId, name, prefix, hash }) {
      const { rows: [row] } = await database.query(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, key_prefix, created_at, last_used_at, revoked_at`, [userId, name, prefix, hash]);
      return row;
    },

    async list(userId) {
      const { rows } = await database.query(`
        SELECT id, name, key_prefix, created_at, last_used_at, revoked_at
          FROM api_keys WHERE user_id = $1
         ORDER BY revoked_at IS NOT NULL, created_at DESC, id DESC
         LIMIT 50`, [userId]);
      return rows;
    },

    async revoke(userId, keyId) {
      const { rows: [row] } = await database.query(`
        UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1 AND user_id = $2
        RETURNING id, name, key_prefix, created_at, last_used_at, revoked_at`, [keyId, userId]);
      return row ?? null;
    },

    async findActiveByHash(hash) {
      const { rows: [row] } = await database.query(`
        SELECT k.id, k.user_id, u.email, u.role, u.active
          FROM api_keys k JOIN users u ON u.id = k.user_id
         WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, [hash]);
      return row ?? null;
    },

    // Se actualiza como máximo una vez por minuto para no escribir en cada petición del SDK.
    async touch(keyId) {
      await database.query(`UPDATE api_keys SET last_used_at = now()
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [keyId]);
    },
  };
}
