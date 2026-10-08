import { AppError } from '../../lib/app-error.js';
import { UUID_PATTERN } from '../storage/storage.validation.js';

export function createQuotasRepository(database) {
  async function lockUser(client, userId) {
    // Compatible con KEY SHARE de las claves foráneas. Las reservas del mismo
    // usuario se serializan sin actualizar su clave primaria.
    const { rows: [user] } = await client.query('SELECT id, active FROM users WHERE id=$1 FOR NO KEY UPDATE', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    return user;
  }

  async function getActivePlan(client, userId) {
    const { rows: [plan] } = await client.query(`SELECT p.id, p.code, p.name, p.capacity_bytes,
      p.daily_upload_limit, p.daily_bytes_limit FROM subscriptions s JOIN plans p ON p.id=s.plan_id
      WHERE s.user_id=$1 AND s.status='active' AND s.started_at <= CURRENT_TIMESTAMP
        AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP) AND p.active=TRUE
      FOR SHARE OF s, p`, [userId]);
    if (!plan) throw new AppError(403, 'NO_ACTIVE_SUBSCRIPTION', 'La cuenta necesita una suscripción activa para subir imágenes.');
    return plan;
  }

  async function getUsage(client, userId) {
    const { rows: [usage] } = await client.query(`WITH today AS (
        SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date AS day
      ), published AS (
        SELECT COALESCE(SUM(o.original_size_bytes),0)::text AS used_bytes
        FROM images i JOIN stored_objects o ON o.hash_sha256=i.object_hash WHERE i.user_id=$1
      ), pending AS (
        SELECT COALESCE(SUM(reserved_bytes),0)::text AS pending_bytes,
          COUNT(*) FILTER (WHERE usage_date=t.day)::text AS pending_daily_count,
          COALESCE(SUM(reserved_bytes) FILTER (WHERE usage_date=t.day),0)::text AS pending_daily_bytes
        FROM quota_reservations CROSS JOIN today t WHERE user_id=$1 AND status='pending'
      ) SELECT p.*, r.*, t.day::text AS usage_date,
        COALESCE(d.upload_count,0)::text AS daily_count,
        COALESCE(d.uploaded_bytes,0)::text AS daily_bytes
      FROM published p CROSS JOIN pending r CROSS JOIN today t
      LEFT JOIN quota_daily_usage d ON d.user_id=$1 AND d.usage_date=t.day`, [userId]);
    return usage;
  }

  async function getReservation(client, key, userId) {
    const { rows: [row] } = await client.query('SELECT * FROM quota_reservations WHERE reservation_key=$1 AND user_id=$2', [key, userId]);
    if (!row) throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reserva no encontrada.');
    return row;
  }

  return {
    lockUser, getActivePlan, getUsage, getReservation,
    async withUserTransaction(userId, operation) {
      let client;
      try { client = await database.connect(); }
      catch { throw new AppError(503, 'DATABASE_UNAVAILABLE', 'PostgreSQL no está disponible.'); }
      try {
        await client.query('BEGIN');
        await lockUser(client, userId);
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },

    // Reciben una transacción abierta: no crean ni confirman otra conexión.
    // El bloqueo se conserva hasta COMMIT/ROLLBACK del llamador.
    async reserve(client, { reservationKey, userId, bytes }) {
      if (typeof reservationKey !== 'string' || !UUID_PATTERN.test(reservationKey)) {
        throw new AppError(400, 'INVALID_RESERVATION', 'La reserva debe tener un UUID válido.');
      }
      let size;
      try { size = BigInt(bytes); } catch { size = 0n; }
      if (size <= 0n || size > 9223372036854775807n) throw new AppError(400, 'INVALID_RESERVATION_BYTES', 'El tamaño debe ser un entero positivo válido.');
      const user = await lockUser(client, userId);
      if (!user.active) throw new AppError(403, 'USER_INACTIVE', 'El usuario está inactivo.');
      const existing = (await client.query('SELECT * FROM quota_reservations WHERE reservation_key=$1', [reservationKey])).rows[0];
      if (existing) {
        if (existing.user_id !== userId || BigInt(existing.reserved_bytes) !== size) {
          throw new AppError(409, 'RESERVATION_CONFLICT', 'El UUID de la reserva ya fue utilizado con otros datos.');
        }
        return existing;
      }
      const plan = await getActivePlan(client, userId);
      const usage = await getUsage(client, userId);
      if (BigInt(usage.used_bytes) + BigInt(usage.pending_bytes) + size > BigInt(plan.capacity_bytes)) {
        throw new AppError(403, 'CAPACITY_EXCEEDED', 'La imagen supera la capacidad disponible del plan.');
      }
      if (plan.daily_upload_limit !== null && BigInt(usage.daily_count) + BigInt(usage.pending_daily_count) + 1n > BigInt(plan.daily_upload_limit)) {
        throw new AppError(429, 'DAILY_UPLOAD_LIMIT_EXCEEDED', 'Se alcanzó el número de subidas permitido para hoy.');
      }
      if (plan.daily_bytes_limit !== null && BigInt(usage.daily_bytes) + BigInt(usage.pending_daily_bytes) + size > BigInt(plan.daily_bytes_limit)) {
        throw new AppError(429, 'DAILY_BYTES_LIMIT_EXCEEDED', 'La imagen supera los bytes de subida permitidos para hoy.');
      }
      return (await client.query(`INSERT INTO quota_reservations(user_id,reservation_key,reserved_bytes)
        VALUES ($1,$2,$3) RETURNING *`, [userId, reservationKey, size.toString()])).rows[0];
    },

    async confirm(client, key, userId, imageId = null) {
      await lockUser(client, userId);
      const existing = await getReservation(client, key, userId);
      if (existing.status === 'confirmed') {
        if (imageId && existing.image_id !== imageId) throw new AppError(409, 'RESERVATION_CONFLICT', 'La reserva ya corresponde a otra imagen.');
        return existing;
      }
      if (existing.status === 'released') throw new AppError(409, 'RESERVATION_ALREADY_RELEASED', 'La reserva ya fue liberada.');
      if (imageId) {
        const image = await client.query(`SELECT i.id FROM images i JOIN stored_objects o ON o.hash_sha256=i.object_hash
          WHERE i.id=$1 AND i.user_id=$2 AND o.original_size_bytes=$3`, [imageId, userId, existing.reserved_bytes]);
        if (!image.rows.length) throw new AppError(409, 'RESERVATION_CONFLICT', 'La imagen no coincide con la reserva.');
      }
      const { rows: [confirmed] } = await client.query(`UPDATE quota_reservations SET status='confirmed',
        confirmed_at=now(), image_id=$3 WHERE reservation_key=$1 AND user_id=$2 RETURNING *`, [key, userId, imageId]);
      await client.query(`INSERT INTO quota_daily_usage(user_id,usage_date,upload_count,uploaded_bytes)
        VALUES ($1,$2,1,$3) ON CONFLICT (user_id,usage_date) DO UPDATE SET
          upload_count=quota_daily_usage.upload_count+1,
          uploaded_bytes=quota_daily_usage.uploaded_bytes+EXCLUDED.uploaded_bytes`, [userId, confirmed.usage_date, confirmed.reserved_bytes]);
      return confirmed;
    },

    async release(client, key, userId) {
      // Una cuenta desactivada también necesita liberar trabajos fallidos.
      await lockUser(client, userId);
      const existing = await getReservation(client, key, userId);
      if (existing.status === 'released') return existing;
      if (existing.status === 'confirmed') throw new AppError(409, 'RESERVATION_ALREADY_CONFIRMED', 'Una reserva confirmada no puede ser liberada.');
      return (await client.query(`UPDATE quota_reservations SET status='released', released_at=now()
        WHERE reservation_key=$1 AND user_id=$2 RETURNING *`, [key, userId])).rows[0];
    },
  };
}
