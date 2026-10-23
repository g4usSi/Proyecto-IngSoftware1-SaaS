// RF-AUT-12: acceso a datos de la bitácora de autenticación. Solo aquí hay SQL.
const FILTERS = `($1::text IS NULL OR e.event_type = $1)
   AND ($2::uuid IS NULL OR e.user_id = $2 OR e.actor_id = $2)
   AND ($3::text IS NULL OR e.email ILIKE $3 ESCAPE '\\' OR u.email ILIKE $3 ESCAPE '\\')`;

export function createAuditRepository(database) {
  return {
    async insert({ type, userId, actorId, email, detail, ipAddress, userAgent }) {
      await database.query(
        `INSERT INTO auth_events (event_type, user_id, actor_id, email, detail, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [type, userId ?? null, actorId ?? null, email ?? null, JSON.stringify(detail ?? {}), ipAddress ?? null, userAgent ?? null],
      );
    },

    async list({ type, userId, pattern, limit, offset }) {
      const params = [type, userId, pattern];
      const base = `FROM auth_events e LEFT JOIN users u ON u.id = e.user_id WHERE ${FILTERS}`;
      const [{ rows: [count] }, { rows }] = await Promise.all([
        database.query(`SELECT count(*)::text AS total ${base}`, params),
        database.query(
          `SELECT e.id::text, e.event_type, e.user_id, e.actor_id, COALESCE(e.email, u.email) AS email,
                  e.detail, e.ip_address, e.user_agent, e.created_at
             ${base} ORDER BY e.created_at DESC, e.id DESC LIMIT $4 OFFSET $5`,
          [...params, limit, offset],
        ),
      ]);
      return { total: count.total, rows };
    },
  };
}
