// Consultas administrativas de solo lectura (S4-04). No dependen de columnas de precio,
// por lo que funcionan con el esquema de tema-y-flujo-git (007) y con el de pagos (009).

// Una suscripción es vigente con el mismo criterio que usa la admisión de cuotas.
const CURRENT_SUBSCRIPTION = `s.status = 'active' AND s.started_at <= CURRENT_TIMESTAMP
  AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`;

function likePattern(text) {
  return text === null ? null : `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function createAdminRepository(database) {
  return {
    async listSubscriptions({ status, plan, search, limit, offset }) {
      const { rows } = await database.query(`
        SELECT s.id, s.status, s.started_at, s.expires_at,
               (${CURRENT_SUBSCRIPTION}) AS current,
               u.id AS user_id, u.name AS user_name, u.email AS user_email, u.active AS user_active,
               p.code AS plan_code, p.name AS plan_name, p.capacity_bytes::text AS capacity_bytes,
               COUNT(*) OVER()::text AS total
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          JOIN plans p ON p.id = s.plan_id
         WHERE ($1::text IS NULL OR s.status = $1)
           AND ($2::text IS NULL OR p.code = $2)
           AND ($3::text IS NULL OR u.email ILIKE $3 OR u.name ILIKE $3)
         ORDER BY s.started_at DESC, s.id DESC
         LIMIT $4 OFFSET $5`, [status, plan, likePattern(search), limit, offset]);
      return rows;
    },

    async listUsage({ plan, search, limit, offset }) {
      const { rows } = await database.query(`
        WITH current_plan AS (
          SELECT DISTINCT ON (s.user_id) s.user_id, p.code, p.name, p.capacity_bytes
            FROM subscriptions s JOIN plans p ON p.id = s.plan_id
           WHERE ${CURRENT_SUBSCRIPTION}
           ORDER BY s.user_id, s.started_at DESC
        ), used AS (
          SELECT i.user_id, SUM(o.original_size_bytes) AS used_bytes, COUNT(*) AS image_count,
                 COUNT(*) FILTER (WHERE i.deleted_at IS NOT NULL) AS trash_count
            FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
           GROUP BY i.user_id
        ), pending AS (
          SELECT user_id, SUM(reserved_bytes) AS reserved_bytes
            FROM quota_reservations WHERE status = 'pending'
           GROUP BY user_id
        )
        SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email, u.active AS user_active,
               cp.code AS plan_code, cp.name AS plan_name, cp.capacity_bytes::text AS capacity_bytes,
               COALESCE(used.used_bytes, 0)::text AS used_bytes,
               COALESCE(pending.reserved_bytes, 0)::text AS reserved_bytes,
               COALESCE(used.image_count, 0)::text AS image_count,
               COALESCE(used.trash_count, 0)::text AS trash_count,
               COUNT(*) OVER()::text AS total
          FROM users u
          LEFT JOIN current_plan cp ON cp.user_id = u.id
          LEFT JOIN used ON used.user_id = u.id
          LEFT JOIN pending ON pending.user_id = u.id
         WHERE ($1::text IS NULL OR cp.code = $1)
           AND ($2::text IS NULL OR u.email ILIKE $2 OR u.name ILIKE $2)
         ORDER BY COALESCE(used.used_bytes, 0) + COALESCE(pending.reserved_bytes, 0) DESC, u.created_at, u.id
         LIMIT $3 OFFSET $4`, [plan, likePattern(search), limit, offset]);
      return rows;
    },

    async summary() {
      const [users, plans, storage, jobs] = await Promise.all([
        database.query(`SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE active)::text AS active,
            COUNT(*) FILTER (WHERE email_verified)::text AS verified,
            COUNT(*) FILTER (WHERE role = 'admin')::text AS admins
          FROM users`),
        database.query(`SELECT p.code, p.name, p.capacity_bytes::text AS capacity_bytes,
            COUNT(s.id)::text AS current_subscriptions
          FROM plans p
          LEFT JOIN subscriptions s ON s.plan_id = p.id AND ${CURRENT_SUBSCRIPTION}
          GROUP BY p.id, p.code, p.name, p.capacity_bytes
          ORDER BY p.capacity_bytes, p.code`),
        database.query(`WITH refs AS (
            SELECT i.object_hash, i.deleted_at, o.original_size_bytes
              FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
          )
          SELECT COALESCE(SUM(original_size_bytes), 0)::text AS logical_bytes,
                 COUNT(*)::text AS image_count,
                 COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS trash_count,
                 (SELECT COUNT(DISTINCT object_hash) FROM refs)::text AS unique_object_count,
                 (SELECT COALESCE(SUM(original_size_bytes), 0) FROM stored_objects o
                   WHERE EXISTS (SELECT 1 FROM images i WHERE i.object_hash = o.hash_sha256))::text AS unique_original_bytes,
                 (SELECT COALESCE(SUM(reserved_bytes), 0) FROM quota_reservations WHERE status = 'pending')::text AS reserved_bytes
            FROM refs`),
        database.query(`SELECT status, COUNT(*)::text AS count FROM image_processing_jobs GROUP BY status`),
      ]);
      return { users: users.rows[0], plans: plans.rows, storage: storage.rows[0], jobs: jobs.rows };
    },
  };
}
