import { AppError } from "../../lib/app-error.js";
import { createQuotasRepository } from "../quotas/quotas.repository.js";
// 1 GB = 1 000 000 000 bytes, igual que el catálogo de planes.
function describeBytes(value) {
  const bytes = BigInt(value);
  const units = [[1000000000n, "GB"], [1000000n, "MB"], [1000n, "KB"]];
  for (const [size, label] of units) {
    if (bytes >= size) {
      const hundredths = (bytes * 100n + size - 1n) / size;
      return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")} ${label} (${bytes} bytes)`;
    }
  }
  return `${bytes} bytes`;
}

export function createSubscriptionsRepository(database) {
  const quotasRepository = createQuotasRepository(database);

  async function validatePlanCapacity(client, userId, newCapacityBytes) {
    const usage = await quotasRepository.getUsage(client, userId);

    const usedBytes = BigInt(usage.used_bytes);
    const pendingBytes = BigInt(usage.pending_bytes);
    const totalBytes = usedBytes + pendingBytes;
    const capacityBytes = BigInt(newCapacityBytes);

    if (totalBytes > capacityBytes) {
      const bytesToFree = totalBytes - capacityBytes;

      throw new AppError(
        409,
        "PLAN_CAPACITY_EXCEEDED",
        `El almacenamiento utilizado y reservado (${describeBytes(totalBytes)}) supera la capacidad del nuevo plan (${describeBytes(capacityBytes)}). Libera al menos ${describeBytes(bytesToFree)} antes de cambiar de plan.`,
        {
          capacityBytes: capacityBytes.toString(),
          usedBytes: usedBytes.toString(),
          reservedBytes: pendingBytes.toString(),
          bytesToFree: bytesToFree.toString(),
        },
      );
    }

    return {
      usedBytes: usedBytes.toString(),
      pendingBytes: pendingBytes.toString(),
      totalBytes: totalBytes.toString(),
    };
  }

  return {
    validatePlanCapacity,
    async listActivePlans() {
      const result = await database.query(`
        SELECT id, code, name, capacity_bytes, daily_upload_limit,
               daily_bytes_limit, monthly_price, currency, billing_period,
               pricing_model, storage_price_per_gb_month,
               storage_included_bytes, storage_billing_basis, active
          FROM plans
         WHERE active = TRUE
         ORDER BY capacity_bytes ASC, code ASC
      `);

      return result.rows;
    },

    async findFreePlan() {
      const {
        rows: [plan],
      } = await database.query(
        `SELECT
       id,
       code,
       name,
       capacity_bytes,
       daily_upload_limit,
       daily_bytes_limit,
       monthly_price,
       currency,
       billing_period
     FROM plans
     WHERE code = 'free'
       AND active = TRUE
     LIMIT 1`,
      );

      return plan ?? null;
    },

    async findSubscriptionByUser(userId) {
      const result = await database.query(
        `
        SELECT
          s.id,
          s.user_id,
          s.status,
          s.started_at,
          s.expires_at,
          p.id AS plan_id,
          p.code AS plan_code,
          p.name AS plan_name,
          p.capacity_bytes,
          p.daily_upload_limit,
          p.daily_bytes_limit,
          p.monthly_price,
          p.currency,
          p.billing_period
        FROM subscriptions s
        INNER JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1
          AND s.status = 'active'
          AND s.started_at <= NOW()
          AND (s.expires_at IS NULL OR s.expires_at > NOW())
        LIMIT 1
        `,
        [userId],
      );

      return result.rows[0] ?? null;
    },

    async findPlanByCode(client, planCode) {
      const {
        rows: [plan],
      } = await client.query(
        `SELECT
       id,
       code,
       name,
       capacity_bytes,
       monthly_price,
       currency,
       billing_period,
       pricing_model
     FROM plans
     WHERE code = $1
       AND active = TRUE`,
        [planCode],
      );

      return plan ?? null;
    },

    async findPaymentByIdempotencyKey(client, userId, idempotencyKey) {
      const {
        rows: [payment],
      } = await client.query(
        `SELECT
          id,
          user_id,
          plan_id,
          subscription_id,
          amount,
          currency,
          status,
          card_last4,
          reference,
          idempotency_key,
          request_fingerprint,
          created_at
        FROM payments
        WHERE user_id = $1
          AND idempotency_key = $2
        LIMIT 1`,
        [userId, idempotencyKey],
      );

      return payment ?? null;
    },

    async createPayment(
      client,
      {
        userId,
        planId,
        amount,
        currency,
        status,
        cardLast4,
        idempotencyKey,
        reference,
        requestFingerprint,
      },
    ) {
      const {
        rows: [payment],
      } = await client.query(
        `INSERT INTO payments (
          user_id,
          plan_id,
          amount,
          currency,
          status,
          card_last4,
          idempotency_key,
          reference,
          request_fingerprint
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          id,
          user_id,
          plan_id,
          amount,
          currency,
          status,
          card_last4,
          reference,
          idempotency_key,
          created_at`,
        [
          userId,
          planId,
          amount,
          currency,
          status,
          cardLast4,
          idempotencyKey,
          reference,
          requestFingerprint,
        ],
      );

      return payment;
    },

    async findCurrentSubscription(client, userId) {
      const {
        rows: [subscription],
      } = await client.query(
        `SELECT
          s.id,
          s.user_id,
          s.plan_id,
          s.status,
          s.started_at,
          s.expires_at,
          p.code AS plan_code,
          p.monthly_price,
          p.currency
        FROM subscriptions s
        INNER JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1
          AND s.status = 'active'
        FOR NO KEY UPDATE OF s`,
        [userId],
      );

      return subscription ?? null;
    },

    async changeSubscriptionPlan(
      client,
      subscriptionId,
      newPlanId,
      isFree = false,
      restartBilling = false,
    ) {
      const {
        rows: [subscription],
      } = await client.query(
        `UPDATE subscriptions
     SET plan_id = $2,
         started_at = CASE
           WHEN $4::boolean THEN NOW()
           ELSE started_at
         END,
         expires_at = CASE
           WHEN $3::boolean THEN NULL
           WHEN $4::boolean THEN (
             (NOW() AT TIME ZONE 'America/Guatemala')
             + INTERVAL '1 month'
           ) AT TIME ZONE 'America/Guatemala'
           ELSE expires_at
         END
     WHERE id = $1
       AND status = 'active'
     RETURNING
       id,
       user_id,
       plan_id,
       status,
       started_at,
       expires_at`,
        [subscriptionId, newPlanId, isFree, restartBilling],
      );

      return subscription ?? null;
    },

    async extendSubscription(client, subscriptionId) {
      const {
        rows: [subscription],
      } = await client.query(
        `UPDATE subscriptions
            SET expires_at = (
              GREATEST(
                expires_at,
                NOW()
              ) AT TIME ZONE 'America/Guatemala'
              + INTERVAL '1 month'
            ) AT TIME ZONE 'America/Guatemala'
          WHERE id = $1
            AND status = 'active'
            AND expires_at IS NOT NULL
          RETURNING
            id,
            user_id,
            plan_id,
            status,
            started_at,
            expires_at`,
        [subscriptionId],
      );

      return subscription ?? null;
    },

    async activateSubscription(client, userId, planId) {
      // Finalizar cualquier suscripción activa anterior.
      await client.query(
        `UPDATE subscriptions
            SET status = 'cancelled',
                expires_at = NOW()
          WHERE user_id = $1
            AND status = 'active'`,
        [userId],
      );

      // Crear la nueva suscripción por un mes calendario.
      const {
        rows: [subscription],
      } = await client.query(
        `INSERT INTO subscriptions (
          user_id,
          plan_id,
          status,
          started_at,
          expires_at
        )
        VALUES (
          $1,
          $2,
          'active',
          NOW(),
          (
            (NOW() AT TIME ZONE 'America/Guatemala')
            + INTERVAL '1 month'
          ) AT TIME ZONE 'America/Guatemala'
        )
        RETURNING id, user_id, plan_id, status,
                  started_at, expires_at`,
        [userId, planId],
      );

      return subscription;
    },

    async linkPaymentToSubscription(client, paymentId, subscriptionId) {
      await client.query(
        `UPDATE payments
        SET subscription_id = $1
        WHERE id = $2`,
        [subscriptionId, paymentId],
      );
    },

    async findSubscriptionByPayment(client, paymentId) {
      const {
        rows: [subscription],
      } = await client.query(
        `SELECT
          s.id,
          s.user_id,
          s.plan_id,
          s.status,
          s.started_at,
          s.expires_at
        FROM payments p
        INNER JOIN subscriptions s
          ON s.id = p.subscription_id
        WHERE p.id = $1`,
        [paymentId],
      );

      return subscription ?? null;
    },

    async listPaymentsByUser(userId, limit, offset) {
      const result = await database.query(
        `SELECT
          p.id,
          p.plan_id,
          pl.code AS plan_code,
          pl.name AS plan_name,
          p.amount,
          p.currency,
          p.status,
          p.card_last4,
          p.reference,
          p.created_at
        FROM payments p
        JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      );

      return result.rows;
    },

    // RF-PAG-03: pagos aprobados con los datos del recibo. paymentId opcional; siempre filtra por propietario.
    async listReceiptRows(userId, paymentId = null) {
      const result = await database.query(
        `SELECT p.id, p.reference, p.amount, p.currency, p.status, p.card_last4, p.created_at,
                pl.name AS plan_name, pl.capacity_bytes, u.name AS user_name, u.email AS user_email
           FROM payments p
           JOIN plans pl ON pl.id = p.plan_id
           JOIN users u ON u.id = p.user_id
          WHERE p.user_id = $1 AND ($2::uuid IS NULL OR p.id = $2)
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 500`,
        [userId, paymentId],
      );

      return result.rows;
    },

    async countPaymentsByUser(userId) {
      const result = await database.query(
        "SELECT COUNT(*) AS total FROM payments WHERE user_id = $1",
        [userId],
      );

      return Number(result.rows[0].total);
    },

    async subscriptionTransaction(userId, operation) {
      let client;

      try {
        client = await database.connect();
      } catch {
        throw new AppError(
          503,
          "DATABASE_UNAVAILABLE",
          "PostgreSQL no está disponible.",
        );
      }

      try {
        await client.query("BEGIN");

        await quotasRepository.lockUser(client, userId);

        const result = await operation(client);

        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async checkoutTransaction(userId, idempotencyKey, operation) {
      let client;

      try {
        client = await database.connect();
      } catch {
        throw new AppError(
          503,
          "DATABASE_UNAVAILABLE",
          "PostgreSQL no está disponible.",
        );
      }

      try {
        await client.query("BEGIN");

        const {
          rows: [user],
        } = await client.query(
          "SELECT id, active FROM users WHERE id = $1 FOR NO KEY UPDATE",
          [userId],
        );

        if (!user) {
          throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
        }

        if (!user.active) {
          throw new AppError(403, "USER_INACTIVE", "El usuario está inactivo.");
        }

        const {
          rows: [existingPayment],
        } = await client.query(
          `SELECT id, user_id, plan_id, amount, currency,
                  status, card_last4, reference, idempotency_key,
                  created_at, request_fingerprint
             FROM payments
            WHERE user_id = $1 AND idempotency_key = $2`,
          [userId, idempotencyKey],
        );

        const result = await operation(client, existingPayment ?? null);

        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
