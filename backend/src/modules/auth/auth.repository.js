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
  };
}
