import { PUBLIC_USER_COLUMNS } from '../auth/public-user.js';

// Filtros opcionales de la búsqueda: $1 = patrón ILIKE (o NULL), $2 = activo (o NULL).
// La sentencia es siempre la misma; los filtros que no se usan valen NULL.
const FILTERS = `($1::text IS NULL OR name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\')
   AND ($2::boolean IS NULL OR active = $2)`;

export function createUsersRepository(database) {
  return {
    // RF09: una página de usuarios y el total que coincide con los filtros.
    async listUsers({ search, active, limit, offset }) {
      const pattern = search === null ? null : `%${escapeLike(search)}%`;
      const [{ rows: countRows }, { rows }] = await Promise.all([
        database.query(`SELECT count(*)::int AS total FROM users WHERE ${FILTERS}`, [pattern, active]),
        database.query(
          `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE ${FILTERS}
            ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
          [pattern, active, limit, offset],
        ),
      ]);
      return { users: rows, total: countRows[0]?.total ?? 0 };
    },

    async findUserById(id) {
      const { rows } = await database.query(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async setUserActive(id, active) {
      const { rows } = await database.query(
        `UPDATE users SET active = $2, updated_at = now() WHERE id = $1 RETURNING ${PUBLIC_USER_COLUMNS}`,
        [id, active],
      );
      return rows[0] ?? null;
    },
  };
}

// Escapa los comodines de LIKE para que "%" o "_" en la búsqueda se traten como texto.
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
