// Columnas públicas del usuario: password_hash nunca se selecciona para respuestas.
const PUBLIC_COLUMNS = 'id, name, email, role, active, email_verified, created_at';

export function createAuthRepository(database) {
  return {
    async findUserByEmail(email) {
      const { rows } = await database.query(
        `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findUserById(id) {
      const { rows } = await database.query(
        `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    // Una sola sentencia: la cuenta y su suscripción Free se confirman juntas.
    // Si Free no existe o está inactivo, no se crea una cuenta incompleta.
    async createUser({ name, email, passwordHash }) {
      const { rows } = await database.query(
        `WITH free_plan AS (
           SELECT id FROM plans WHERE code = 'free' AND active = TRUE
         ), new_user AS (
           INSERT INTO users (name, email, password_hash)
           SELECT $1, $2, $3 FROM free_plan
           RETURNING ${PUBLIC_COLUMNS}
         ), new_subscription AS (
           INSERT INTO subscriptions (user_id, plan_id, status)
           SELECT new_user.id, free_plan.id, 'active' FROM new_user CROSS JOIN free_plan
           RETURNING user_id
         )
         SELECT ${PUBLIC_COLUMNS.split(', ').map((column) => `new_user.${column}`).join(', ')}
           FROM new_user JOIN new_subscription ON new_subscription.user_id = new_user.id`,
        [name, email, passwordHash],
      );
      return rows[0] ?? null;
    },

    async isTokenRevoked(jti) {
      const { rows } = await database.query('SELECT 1 FROM revoked_tokens WHERE jti = $1', [jti]);
      return rows.length > 0;
    },

    // Idempotente: revocar dos veces el mismo token no es un error.
    async revokeToken({ jti, userId, expiresAt }) {
      await database.query(
        'INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING',
        [jti, userId, expiresAt],
      );
    },

    // Un token vencido ya no se puede usar, así que su revocación deja de importar.
    async purgeExpiredRevocations() {
      await database.query('DELETE FROM revoked_tokens WHERE expires_at < now()');
    },

    // RF05: solo se guarda el hash del token de recuperación, nunca el valor enviado por correo.
    async createPasswordResetToken({ userId, tokenHash, expiresAt }) {
      await database.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, tokenHash, expiresAt],
      );
    },

    // Solo un token no usado y vigente es válido; no distingue el motivo por el que no lo es.
    async findValidPasswordResetToken(tokenHash) {
      const { rows } = await database.query(
        'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [tokenHash],
      );
      return rows[0] ?? null;
    },

    async markPasswordResetTokenUsed(id) {
      await database.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [id]);
    },

    // Evita que queden varios enlaces de recuperación válidos al mismo tiempo para una cuenta.
    async invalidateUserPasswordResetTokens(userId) {
      await database.query(
        'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
    },

    async createEmailVerificationToken({ userId, tokenHash, expiresAt }) {
      await database.query(
        'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, tokenHash, expiresAt],
      );
    },

    async invalidateUserEmailVerificationTokens(userId) {
      await database.query(
        'UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
    },

    // Una sola sentencia: consume el token y verifica la cuenta juntos, o ninguna de las dos cosas.
    // Dos peticiones simultáneas con el mismo token no pueden consumirlo dos veces.
    async consumeEmailVerificationToken(tokenHash) {
      const { rows } = await database.query(
        `WITH consumed AS (
           UPDATE email_verification_tokens SET used_at = now()
            WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
            RETURNING user_id
         )
         UPDATE users SET email_verified = TRUE, updated_at = now()
           FROM consumed WHERE users.id = consumed.user_id
         RETURNING users.id`,
        [tokenHash],
      );
      return rows[0]?.id ?? null;
    },

    async updateUserPassword(userId, passwordHash) {
      await database.query(
        'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
        [userId, passwordHash],
      );
    },
  };
}
