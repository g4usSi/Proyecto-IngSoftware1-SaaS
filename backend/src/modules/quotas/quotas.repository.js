import { AppError } from "../../lib/app-error.js";

function isDatabaseUnavailable(error) {
  return ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(error?.code);
}

export function createQuotasRepository(database) {
  async function query(connection, sql, values = []) {
    try {
      return await connection.query(sql, values);
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new AppError(
          503,
          "DATABASE_UNAVAILABLE",
          "La base de datos no está disponible.",
        );
      }

      throw error;
    }
  }

  async function transaction(operation) {
    const connection = await database.connect();

    try {
      await connection.query("BEGIN");

      const result = await operation(connection);

      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  async function lockUser(connection, userId) {
    const result = await query(
      connection,
      `
        SELECT id, active
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId],
    );

    if (result.rowCount === 0) {
      throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }

    if (!result.rows[0].active) {
      throw new AppError(403, "USER_INACTIVE", "El usuario está inactivo.");
    }
  }

  async function getActivePlan(connection, userId) {
    const result = await query(
      connection,
      `
        SELECT
          p.id,
          p.code,
          p.name,
          p.capacity_bytes,
          p.daily_upload_limit,
          p.daily_bytes_limit
        FROM subscriptions s
        INNER JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1
          AND s.status = 'active'
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND p.active = TRUE
        LIMIT 1
      `,
      [userId],
    );

    if (result.rowCount === 0) {
      throw new AppError(
        403,
        "ACTIVE_SUBSCRIPTION_REQUIRED",
        "El usuario no tiene una suscripción activa.",
      );
    }

    return result.rows[0];
  }

  async function getQuotaUsage(connection, userId) {
    const result = await query(
      connection,
      `
        WITH published AS (
          SELECT COALESCE(SUM(o.original_size_bytes), 0)::text AS used_bytes
          FROM images i
          INNER JOIN stored_objects o
            ON o.hash_sha256 = i.object_hash
          WHERE i.user_id = $1
        ),
        pending AS (
          SELECT
            COALESCE(SUM(reserved_bytes), 0)::text AS pending_bytes,
            COUNT(*) FILTER (
              WHERE created_at >=
                date_trunc(
                  'day',
                  CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala'
                ) AT TIME ZONE 'America/Guatemala'
            )::text AS pending_daily_count,
            COALESCE(
              SUM(reserved_bytes) FILTER (
                WHERE created_at >=
                  date_trunc(
                    'day',
                    CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala'
                  ) AT TIME ZONE 'America/Guatemala'
              ),
              0
            )::text AS pending_daily_bytes
          FROM quota_reservations
          WHERE user_id = $1
            AND status = 'pending'
        ),
        daily AS (
          SELECT
            COALESCE(upload_count, 0)::text AS upload_count,
            COALESCE(uploaded_bytes, 0)::text AS uploaded_bytes
          FROM quota_daily_usage
          WHERE user_id = $1
            AND usage_date =
              (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date
        )
        SELECT
          published.used_bytes,
          pending.pending_bytes,
          pending.pending_daily_count,
          pending.pending_daily_bytes,
          COALESCE(daily.upload_count, '0') AS daily_count,
          COALESCE(daily.uploaded_bytes, '0') AS daily_bytes
        FROM published
        CROSS JOIN pending
        LEFT JOIN daily ON TRUE
      `,
      [userId],
    );

    return result.rows[0];
  }

  return {
    async withUserTransaction(userId, operation) {
      return transaction(async (connection) => {
        /*
         * El bloqueo del usuario serializa las reservas del mismo usuario.
         * Esto evita que dos trabajos concurrentes consuman el último
         * cupo al mismo tiempo.
         */
        await lockUser(connection, userId);
        return operation(connection);
      });
    },

    async reserve(connection, { reservationKey, userId, bytes }) {
      /*
       * Si el UUID ya existe, devolvemos la reserva existente.
       * Esto permite reintentar la admisión sin duplicarla.
       */
      const existing = await query(
        connection,
        `
          SELECT *
          FROM quota_reservations
          WHERE reservation_key = $1
        `,
        [reservationKey],
      );

      if (existing.rowCount > 0) {
        const reservation = existing.rows[0];

        if (
          reservation.user_id !== userId ||
          BigInt(reservation.reserved_bytes) !== BigInt(bytes)
        ) {
          throw new AppError(
            409,
            "RESERVATION_CONFLICT",
            "El UUID de la reserva ya fue utilizado con otros datos.",
          );
        }

        return reservation;
      }

      const plan = await getActivePlan(connection, userId);
      const usage = await getQuotaUsage(connection, userId);

      const incomingBytes = BigInt(bytes);

      const usedBytes = BigInt(usage.used_bytes) + BigInt(usage.pending_bytes);

      const dailyCount =
        BigInt(usage.daily_count) + BigInt(usage.pending_daily_count);

      const dailyBytes =
        BigInt(usage.daily_bytes) + BigInt(usage.pending_daily_bytes);

      if (usedBytes + incomingBytes > BigInt(plan.capacity_bytes)) {
        throw new AppError(
          403,
          "CAPACITY_EXCEEDED",
          "La capacidad del plan sería excedida.",
        );
      }

      if (
        plan.daily_upload_limit !== null &&
        dailyCount + 1n > BigInt(plan.daily_upload_limit)
      ) {
        throw new AppError(
          429,
          "DAILY_UPLOAD_LIMIT_EXCEEDED",
          "Se alcanzó el límite diario de archivos.",
        );
      }

      if (
        plan.daily_bytes_limit !== null &&
        dailyBytes + incomingBytes > BigInt(plan.daily_bytes_limit)
      ) {
        throw new AppError(
          429,
          "DAILY_BYTES_LIMIT_EXCEEDED",
          "Se alcanzó el límite diario de bytes.",
        );
      }

      const result = await query(
        connection,
        `
          INSERT INTO quota_reservations (
            user_id,
            reservation_key,
            reserved_bytes
          )
          VALUES ($1, $2, $3)
          RETURNING *
        `,
        [userId, reservationKey, bytes],
      );

      return result.rows[0];
    },

    async confirm(connection, reservationKey, userId) {
      const result = await query(
        connection,
        `
          UPDATE quota_reservations
          SET
            status = 'confirmed',
            confirmed_at = now()
          WHERE reservation_key = $1
            AND user_id = $2
            AND status = 'pending'
          RETURNING *
        `,
        [reservationKey, userId],
      );

      if (result.rowCount > 0) {
        const reservation = result.rows[0];

        await query(
          connection,
          `
            INSERT INTO quota_daily_usage (
              user_id,
              usage_date,
              upload_count,
              uploaded_bytes
            )
            VALUES (
              $1,
              (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date,
              1,
              $2
            )
            ON CONFLICT (user_id, usage_date)
            DO UPDATE SET
              upload_count =
                quota_daily_usage.upload_count + 1,
              uploaded_bytes =
                quota_daily_usage.uploaded_bytes
                + EXCLUDED.uploaded_bytes
          `,
          [userId, reservation.reserved_bytes],
        );

        return reservation;
      }

      const existing = await query(
        connection,
        `
          SELECT *
          FROM quota_reservations
          WHERE reservation_key = $1
            AND user_id = $2
        `,
        [reservationKey, userId],
      );

      if (existing.rowCount === 0) {
        throw new AppError(
          404,
          "RESERVATION_NOT_FOUND",
          "Reserva no encontrada.",
        );
      }

      if (existing.rows[0].status === "confirmed") {
        // Confirmación repetida: no vuelve a consumir cuota.
        return existing.rows[0];
      }

      throw new AppError(
        409,
        "RESERVATION_ALREADY_RELEASED",
        "La reserva ya fue liberada.",
      );
    },

    async release(connection, reservationKey, userId) {
      const result = await query(
        connection,
        `
          UPDATE quota_reservations
          SET
            status = 'released',
            released_at = now()
          WHERE reservation_key = $1
            AND user_id = $2
            AND status = 'pending'
          RETURNING *
        `,
        [reservationKey, userId],
      );

      if (result.rowCount > 0) {
        return result.rows[0];
      }

      const existing = await query(
        connection,
        `
          SELECT *
          FROM quota_reservations
          WHERE reservation_key = $1
            AND user_id = $2
        `,
        [reservationKey, userId],
      );

      if (existing.rowCount === 0) {
        throw new AppError(
          404,
          "RESERVATION_NOT_FOUND",
          "Reserva no encontrada.",
        );
      }

      if (existing.rows[0].status === "released") {
        // Liberación repetida: no hace nada adicional.
        return existing.rows[0];
      }

      throw new AppError(
        409,
        "RESERVATION_ALREADY_CONFIRMED",
        "Una reserva confirmada no puede ser liberada.",
      );
    },
  };
}
