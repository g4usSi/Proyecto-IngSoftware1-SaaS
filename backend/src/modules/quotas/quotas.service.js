import { AppError } from "../../lib/app-error.js";

export function createQuotasService(repository) {
  function validateReservation({ reservationKey, userId, bytes }) {
    if (!reservationKey) {
      throw new AppError(
        400,
        "RESERVATION_KEY_REQUIRED",
        "El UUID de la reserva es obligatorio.",
      );
    }

    if (!userId) {
      throw new AppError(400, "USER_ID_REQUIRED", "El usuario es obligatorio.");
    }

    if (bytes === undefined || bytes === null) {
      throw new AppError(
        400,
        "RESERVATION_BYTES_REQUIRED",
        "El tamaño de la reserva es obligatorio.",
      );
    }

    let parsedBytes;

    try {
      parsedBytes = BigInt(bytes);
    } catch {
      throw new AppError(
        400,
        "INVALID_RESERVATION_BYTES",
        "El tamaño de la reserva debe ser un número entero válido.",
      );
    }

    if (parsedBytes <= 0n) {
      throw new AppError(
        400,
        "INVALID_RESERVATION_BYTES",
        "El tamaño de la reserva debe ser mayor que cero.",
      );
    }

    return parsedBytes;
  }

  return {
    async reserve({ reservationKey, userId, bytes }) {
      const parsedBytes = validateReservation({
        reservationKey,
        userId,
        bytes,
      });

      return repository.withUserTransaction(userId, async (connection) =>
        repository.reserve(connection, {
          reservationKey,
          userId,
          bytes: parsedBytes.toString(),
        }),
      );
    },

    async confirm({ reservationKey, userId }) {
      if (!reservationKey || !userId) {
        throw new AppError(
          400,
          "INVALID_RESERVATION",
          "La reserva y el usuario son obligatorios.",
        );
      }

      return repository.withUserTransaction(userId, async (connection) =>
        repository.confirm(connection, reservationKey, userId),
      );
    },

    async release({ reservationKey, userId }) {
      if (!reservationKey || !userId) {
        throw new AppError(
          400,
          "INVALID_RESERVATION",
          "La reserva y el usuario son obligatorios.",
        );
      }

      return repository.withUserTransaction(userId, async (connection) =>
        repository.release(connection, reservationKey, userId),
      );
    },

    // GET /api/quotas/me: plan vigente, capacidad y consumo diario, leídos en una sola transacción.
    async getMyQuota(userId) {
      return repository.withUserTransaction(userId, async (client) => {
        const plan = await repository.getActivePlan(client, userId);
        const usage = await repository.getUsage(client, userId);
        const available = BigInt(plan.capacity_bytes) - BigInt(usage.used_bytes) - BigInt(usage.pending_bytes);
        return {
          plan: { code: plan.code, name: plan.name },
          capacityBytes: String(plan.capacity_bytes),
          usedBytes: usage.used_bytes,
          reservedBytes: usage.pending_bytes,
          availableBytes: (available > 0n ? available : 0n).toString(),
          daily: {
            date: usage.usage_date,
            uploadLimit: plan.daily_upload_limit,
            uploadsUsed: usage.daily_count,
            uploadsReserved: usage.pending_daily_count,
            bytesLimit: plan.daily_bytes_limit,
            bytesUsed: usage.daily_bytes,
            bytesReserved: usage.pending_daily_bytes,
          },
        };
      });
    },
  };
}
