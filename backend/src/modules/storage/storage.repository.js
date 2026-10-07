import { AppError } from '../../lib/app-error.js';

const imageColumns = `
  i.id, i.original_name, i.created_at,
  to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
  o.hash_sha256, o.original_size_bytes, o.storage_key, o.status
`;

const unavailableCodes = new Set([
  // Transporte de Node y respuestas de PostgreSQL al no poder servir conexiones.
  'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', '3D000', '53300', '57P01', '57P02', '57P03',
]);

function isDatabaseUnavailable(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return unavailableCodes.has(code) || /^08[A-Z0-9]{3}$/.test(code) || /^28[A-Z0-9]{3}$/.test(code) ||
    // pg también notifica algunas desconexiones sin un código de error.
    /^(Connection terminated(?: unexpectedly| due to connection timeout)?|timeout exceeded when trying to connect)$/.test(error?.message || '');
}

export function createStorageRepository(database) {
  async function query(connection, sql, values = []) {
    try {
      return await connection.query(sql, values);
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'No se pudo completar la operación de almacenamiento en PostgreSQL.');
      }
      // Sintaxis, restricciones inesperadas y fallos de triggers son errores
      // internos. El manejador HTTP los convierte en 500 sin exponer SQL.
      throw error;
    }
  }

  async function transaction(operation) {
    let connection;
    try {
      connection = await database.connect();
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'PostgreSQL no está disponible.');
    }
    try {
      await query(connection, 'BEGIN');
      const result = await operation(connection);
      await query(connection, 'COMMIT');
      return result;
    } catch (error) {
      // Un COMMIT puede haberse aplicado aunque se pierda su respuesta.
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function lockObject(connection, hash) {
    // Serializa también cuando todavía no existe una fila del objeto.
    await query(connection, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`smartstorage:object:${hash}`]);
  }

  return {
    lockObject,
    async withImageTransaction(ownerId, imageId, operation) {
      return transaction(async (connection) => {
        await query(connection, 'SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [ownerId]);
        const { rows: [image] } = await query(connection, `SELECT ${imageColumns}
          FROM images i JOIN stored_objects o ON o.hash_sha256=i.object_hash
          WHERE i.id=$1 AND i.user_id=$2`, [imageId, ownerId]);
        if (!image) throw new AppError(404, 'FILE_NOT_FOUND', 'La imagen no existe o no está disponible para esta cuenta.');
        await lockObject(connection, image.hash_sha256);
        return operation(connection, image);
      });
    },
    async withUploadTransaction(ownerId, hash, operation) {
      return transaction(async (connection) => {
        // Toda subida/borrado futuro mantiene este orden: usuario → objeto.
        const user = await query(connection, 'SELECT id, active FROM users WHERE id = $1 FOR NO KEY UPDATE', [ownerId]);
        if (!user.rows[0]?.active) {
          throw new AppError(401, 'USER_INACTIVE', 'La cuenta no existe o está inactiva.');
        }
        await lockObject(connection, hash);
        return operation(connection);
      });
    },
    async withObjectLock(hash, operation) {
      return transaction(async (connection) => {
        await lockObject(connection, hash);
        return operation(connection);
      });
    },
    async assertFolderOwner(connection, ownerId, folderId) {
      if (!folderId) return;
      const result = await query(connection,
        'SELECT id FROM folders WHERE id = $1 AND user_id = $2 FOR SHARE', [folderId, ownerId]);
      if (result.rows.length === 0) {
        throw new AppError(404, 'FOLDER_NOT_FOUND', 'La carpeta no existe o no está disponible para esta cuenta.');
      }
    },
    async findObject(connection, hash) {
      const result = await query(connection, `
        SELECT hash_sha256, original_size_bytes, storage_key, status
          FROM stored_objects WHERE hash_sha256 = $1
      `, [hash]);
      return result.rows[0] || null;
    },
    async insertObject(connection, { hash, originalSizeBytes, storageKey }) {
      await query(connection, `
        INSERT INTO stored_objects (hash_sha256, original_size_bytes, storage_key, status)
        VALUES ($1, $2, $3, 'ready')
      `, [hash, originalSizeBytes, storageKey]);
    },
    async insertImage(connection, { ownerId, hash, originalName, folderId }) {
      const inserted = await query(connection, `
        INSERT INTO images (user_id, object_hash, original_name, folder_id)
        VALUES ($1, $2, $3, $4) RETURNING id
      `, [ownerId, hash, originalName, folderId]);
      const result = await query(connection, `
        SELECT ${imageColumns}
          FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
         WHERE i.id = $1 AND i.user_id = $2
      `, [inserted.rows[0].id, ownerId]);
      return result.rows[0];
    },
    async listImages(ownerId, { limit, cursor }) {
      const result = await query(database, `
        SELECT ${imageColumns}
          FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
         WHERE i.user_id = $1 AND o.status = 'ready'
           AND ($2::timestamptz IS NULL OR (i.created_at, i.id) < ($2::timestamptz, $3::uuid))
         ORDER BY i.created_at DESC, i.id DESC
         LIMIT $4
      `, [ownerId, cursor?.createdAt || null, cursor?.id || null, limit + 1]);
      return result.rows;
    },
    async findImage(ownerId, imageId) {
      const result = await query(database, `
        SELECT ${imageColumns}
          FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
         WHERE i.id = $1 AND i.user_id = $2 AND o.status = 'ready'
      `, [imageId, ownerId]);
      return result.rows[0] || null;
    },
    async referencedObjects() {
      const result = await query(database, `
        SELECT o.hash_sha256, o.original_size_bytes, o.storage_key, o.status,
               COUNT(i.id)::text AS reference_count
          FROM stored_objects o JOIN images i ON i.object_hash = o.hash_sha256
         WHERE o.status = 'ready'
         GROUP BY o.hash_sha256, o.original_size_bytes, o.storage_key, o.status
         ORDER BY o.hash_sha256
      `);
      return result.rows;
    },
  };
}
