import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/app-error.js";

export function createSubscriptionsService(repository) {
  return {
    async listPlans() {
      let plans;

      try {
        plans = await repository.listActivePlans();
      } catch {
        throw new AppError(
          503,
          "DATABASE_UNAVAILABLE",
          "El catálogo de planes no está disponible. Revisa PostgreSQL y las migraciones.",
        );
      }

      return plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        capacityBytes: String(plan.capacity_bytes),
        dailyUploadLimit: plan.daily_upload_limit,
        dailyBytesLimit:
          plan.daily_bytes_limit === null
            ? null
            : String(plan.daily_bytes_limit),
        monthlyPrice:
          plan.monthly_price === null ? null : String(plan.monthly_price),
        currency: plan.currency,
        billingPeriod: plan.billing_period,
        pricingModel: plan.pricing_model,
        storagePricePerGbMonth:
          plan.storage_price_per_gb_month === null
            ? null
            : String(plan.storage_price_per_gb_month),
        includedStorageBytes:
          plan.storage_included_bytes === null
            ? null
            : String(plan.storage_included_bytes),
        storageBillingBasis: plan.storage_billing_basis,
        monthlyPriceGtq:
          plan.currency === "GTQ" && plan.monthly_price !== null
            ? String(plan.monthly_price)
            : null,
        active: plan.active,
      }));
    },

    async getMySubscription(userId) {
      let subscription;

      try {
        subscription = await repository.findSubscriptionByUser(userId);
      } catch {
        throw new AppError(
          503,
          "DATABASE_UNAVAILABLE",
          "No se pudo consultar la suscripción. Revisa PostgreSQL.",
        );
      }

      if (!subscription) {
        let freePlan;

        try {
          freePlan = await repository.findFreePlan();
        } catch {
          throw new AppError(
            503,
            "DATABASE_UNAVAILABLE",
            "No se pudo consultar el plan gratuito.",
          );
        }

        if (!freePlan) {
          throw new AppError(
            503,
            "FREE_PLAN_UNAVAILABLE",
            "El plan gratuito no está disponible.",
          );
        }

        return {
          id: null,
          status: "active",
          startedAt: null,
          expiresAt: null,
          plan: {
            id: freePlan.id,
            code: freePlan.code,
            name: freePlan.name,
            capacityBytes: String(freePlan.capacity_bytes),
            dailyUploadLimit: freePlan.daily_upload_limit,
            dailyBytesLimit:
              freePlan.daily_bytes_limit === null
                ? null
                : String(freePlan.daily_bytes_limit),
            monthlyPrice: String(freePlan.monthly_price),
            currency: freePlan.currency,
            billingPeriod: freePlan.billing_period,
          },
        };
      }

      return {
        id: subscription.id,
        status: subscription.status,
        startedAt: subscription.started_at,
        expiresAt: subscription.expires_at,
        plan: {
          id: subscription.plan_id,
          code: subscription.plan_code,
          name: subscription.plan_name,
          capacityBytes: String(subscription.capacity_bytes),
          dailyUploadLimit: subscription.daily_upload_limit,
          dailyBytesLimit:
            subscription.daily_bytes_limit === null
              ? null
              : String(subscription.daily_bytes_limit),
          monthlyPrice:
            subscription.monthly_price === null
              ? null
              : String(subscription.monthly_price),
          currency: subscription.currency,
          billingPeriod: subscription.billing_period,
        },
      };
    },

    async validateRenewal(userId) {
      return repository.subscriptionTransaction(userId, async (client) => {
        const subscription = await repository.findCurrentSubscription(
          client,
          userId,
        );

        if (!subscription) {
          throw new AppError(
            404,
            "SUBSCRIPTION_NOT_FOUND",
            "No tienes una suscripción para renovar.",
          );
        }

        if (subscription.plan_code === "free") {
          throw new AppError(
            400,
            "FREE_PLAN_CANNOT_RENEW",
            "El plan gratuito no necesita renovación.",
          );
        }

        return {
          subscriptionId: subscription.id,
          planCode: subscription.plan_code,
          expiresAt: subscription.expires_at,
          monthlyPrice: String(subscription.monthly_price),
          currency: subscription.currency,
        };
      });
    },

    async validatePlanChange({ userId, planCode }) {
      if (
        typeof planCode !== "string" ||
        !["free", "standard", "pro", "enterprise"].includes(planCode)
      ) {
        throw new AppError(400, "INVALID_PLAN", "Selecciona un plan válido.");
      }

      return repository.subscriptionTransaction(userId, async (client) => {
        const currentSubscription = await repository.findCurrentSubscription(
          client,
          userId,
        );

        const targetPlan = await repository.findPlanByCode(client, planCode);

        if (!targetPlan) {
          throw new AppError(
            404,
            "PLAN_NOT_FOUND",
            "El plan solicitado no está disponible.",
          );
        }

        if (currentSubscription?.plan_code === planCode) {
          throw new AppError(
            409,
            "SAME_PLAN",
            "Ya tienes contratado este plan.",
          );
        }

        await repository.validatePlanCapacity(
          client,
          userId,
          targetPlan.capacity_bytes,
        );

        const planLevels = {
          free: 0,
          standard: 1,
          pro: 2,
          enterprise: 3,
        };

        const currentPlan = currentSubscription?.plan_code ?? "free";

        const changeType =
          planLevels[planCode] > planLevels[currentPlan]
            ? "upgrade"
            : "downgrade";

        return {
          currentPlan,
          targetPlan: targetPlan.code,
          targetPlanId: targetPlan.id,
          changeType,
          requiresPayment: changeType === "upgrade",
          monthlyPrice: String(targetPlan.monthly_price),
          currency: targetPlan.currency,
        };
      });
    },

    async renew({ userId, card, idempotencyKey }) {
      if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 120 ||
        !/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)
      ) {
        throw new AppError(
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "Envía una clave Idempotency-Key válida.",
        );
      }

      if (
        !card ||
        typeof card !== "object" ||
        Array.isArray(card) ||
        typeof card.number !== "string" ||
        !/^[0-9]{16}$/.test(card.number)
      ) {
        throw new AppError(
          400,
          "INVALID_CARD",
          "Ingresa una tarjeta de prueba válida.",
        );
      }

      const cardResults = {
        4242424242424242: "approved",
        4000000000000002: "rejected",
        4000000000000119: "error",
      };

      const paymentStatus = cardResults[card.number];

      if (!paymentStatus) {
        throw new AppError(
          400,
          "INVALID_TEST_CARD",
          "Utiliza una de las tarjetas de prueba permitidas.",
        );
      }

      return repository.subscriptionTransaction(userId, async (client) => {
        const requestFingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              operation: "renew",
              cardNumber: card.number,
            }),
          )
          .digest("hex");

        const existingPayment = await repository.findPaymentByIdempotencyKey(
          client,
          userId,
          idempotencyKey,
        );

        if (existingPayment) {
          if (existingPayment.request_fingerprint !== requestFingerprint) {
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Esta clave ya fue utilizada con otra solicitud.",
            );
          }

          return {
            payment: existingPayment,
            subscription: null,
            repeated: true,
          };
        }

        const subscription = await repository.findCurrentSubscription(
          client,
          userId,
        );

        if (!subscription || subscription.plan_code === "free") {
          throw new AppError(
            400,
            "SUBSCRIPTION_NOT_RENEWABLE",
            "No tienes una suscripción de pago para renovar.",
          );
        }

        const payment = await repository.createPayment(client, {
          userId,
          planId: subscription.plan_id,
          amount: String(subscription.monthly_price),
          currency: subscription.currency,
          status: paymentStatus,
          cardLast4: card.number.slice(-4),
          idempotencyKey,
          reference: randomUUID(),
          requestFingerprint,
        });

        let renewedSubscription = null;

        if (paymentStatus === "approved") {
          renewedSubscription = await repository.extendSubscription(
            client,
            subscription.id,
          );

          await repository.linkPaymentToSubscription(
            client,
            payment.id,
            subscription.id,
          );
        }

        return {
          payment,
          subscription: renewedSubscription,
          repeated: false,
        };
      });
    },

    async changePlan({ userId, planCode, card, idempotencyKey }) {
      const levels = {
        free: 0,
        standard: 1,
        pro: 2,
        enterprise: 3,
      };

      if (!Object.hasOwn(levels, planCode)) {
        throw new AppError(400, "INVALID_PLAN", "Plan no válido.");
      }

      return repository.subscriptionTransaction(userId, async (client) => {
        const existing = await repository.findCurrentSubscription(
          client,
          userId,
        );

        const target = await repository.findPlanByCode(client, planCode);

        if (!target) {
          throw new AppError(404, "PLAN_NOT_FOUND", "Plan no disponible.");
        }

        const currentCode = existing?.plan_code ?? "free";

        // Comprobar solicitudes repetidas antes de evaluar el cambio.
        if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
          const previousPayment = await repository.findPaymentByIdempotencyKey(
            client,
            userId,
            idempotencyKey,
          );

          if (previousPayment) {
            const previousFingerprint = createHash("sha256")
              .update(
                JSON.stringify({
                  operation: "change-plan",
                  planCode,
                  cardNumber: card?.number,
                }),
              )
              .digest("hex");

            if (previousPayment.request_fingerprint !== previousFingerprint) {
              throw new AppError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "Esta clave ya fue utilizada para otra solicitud.",
              );
            }

            return {
              payment: {
                id: previousPayment.id,
                status: previousPayment.status,
                amount: String(previousPayment.amount),
                currency: previousPayment.currency,
                reference: previousPayment.reference,
              },
              repeated: true,
            };
          }
        }

        if (currentCode === planCode) {
          throw new AppError(409, "SAME_PLAN", "Ya tienes este plan.");
        }

        const upgrade = levels[planCode] > levels[currentCode];

        await repository.validatePlanCapacity(
          client,
          userId,
          target.capacity_bytes,
        );

        if (upgrade) {
          if (
            typeof idempotencyKey !== "string" ||
            idempotencyKey.length < 8 ||
            idempotencyKey.length > 120 ||
            !/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)
          ) {
            throw new AppError(
              400,
              "INVALID_IDEMPOTENCY_KEY",
              "Envía una clave Idempotency-Key válida.",
            );
          }

          if (
            !card ||
            typeof card !== "object" ||
            Array.isArray(card) ||
            typeof card.number !== "string" ||
            !/^[0-9]{16}$/.test(card.number)
          ) {
            throw new AppError(
              400,
              "INVALID_CARD",
              "Ingresa una tarjeta de prueba válida.",
            );
          }

          const cardResults = {
            4242424242424242: "approved",
            4000000000000002: "rejected",
            4000000000000119: "error",
          };

          const paymentStatus = cardResults[card.number];

          if (!paymentStatus) {
            throw new AppError(
              400,
              "INVALID_TEST_CARD",
              "Utiliza una de las tarjetas de prueba permitidas.",
            );
          }

          const requestFingerprint = createHash("sha256")
            .update(
              JSON.stringify({
                operation: "change-plan",
                planCode,
                cardNumber: card.number,
              }),
            )
            .digest("hex");

          const existingPayment = await repository.findPaymentByIdempotencyKey(
            client,
            userId,
            idempotencyKey,
          );

          if (existingPayment) {
            if (existingPayment.request_fingerprint !== requestFingerprint) {
              throw new AppError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "Esta clave ya fue utilizada para otra solicitud.",
              );
            }

            return {
              payment: {
                id: existingPayment.id,
                status: existingPayment.status,
                amount: String(existingPayment.amount),
                currency: existingPayment.currency,
                reference: existingPayment.reference,
              },
              repeated: true,
            };
          }

          const payment = await repository.createPayment(client, {
            userId,
            planId: target.id,
            amount: String(target.monthly_price),
            currency: target.currency,
            status: paymentStatus,
            cardLast4: card.number.slice(-4),
            idempotencyKey,
            reference: randomUUID(),
            requestFingerprint,
          });

          let updatedSubscription = null;

          if (paymentStatus === "approved") {
            if (existing) {
              updatedSubscription = await repository.changeSubscriptionPlan(
                client,
                existing.id,
                target.id,
                false,
                true,
              );
            } else {
              updatedSubscription = await repository.activateSubscription(
                client,
                userId,
                target.id,
              );
            }

            await repository.linkPaymentToSubscription(
              client,
              payment.id,
              updatedSubscription.id,
            );
          }

          return {
            changeType: "upgrade",
            previousPlan: currentCode,
            newPlan: planCode,
            payment: {
              id: payment.id,
              status: payment.status,
              amount: String(payment.amount),
              currency: payment.currency,
              reference: payment.reference,
            },
            subscription: updatedSubscription,
            repeated: false,
          };
        }

        if (!existing) {
          throw new AppError(
            409,
            "SUBSCRIPTION_NOT_FOUND",
            "No se encontró una suscripción activa.",
          );
        }

        const updated = await repository.changeSubscriptionPlan(
          client,
          existing.id,
          target.id,
          planCode === "free",
        );

        return {
          changeType: "downgrade",
          previousPlan: currentCode,
          newPlan: planCode,
          subscription: updated,
        };
      });
    },

    async checkout({ userId, planCode, card, idempotencyKey }) {
      if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 120 ||
        !/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)
      ) {
        throw new AppError(
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "Envía una clave Idempotency-Key válida de 8 a 120 caracteres.",
        );
      }

      if (
        typeof planCode !== "string" ||
        !["standard", "pro", "enterprise"].includes(planCode)
      ) {
        throw new AppError(
          400,
          "INVALID_PLAN",
          "Selecciona un plan de pago válido.",
        );
      }

      if (
        !card ||
        typeof card !== "object" ||
        Array.isArray(card) ||
        typeof card.number !== "string" ||
        !/^[0-9]{16}$/.test(card.number)
      ) {
        throw new AppError(
          400,
          "INVALID_CARD",
          "Ingresa una tarjeta de prueba válida.",
        );
      }

      const cardResults = {
        4242424242424242: "approved",
        4000000000000002: "rejected",
        4000000000000119: "error",
      };

      const paymentStatus = cardResults[card.number];

      if (!paymentStatus) {
        throw new AppError(
          400,
          "INVALID_TEST_CARD",
          "Utiliza una de las tarjetas de prueba permitidas.",
        );
      }

      const requestFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            planCode,
            cardNumber: card.number,
          }),
        )
        .digest("hex");

      return repository.checkoutTransaction(
        userId,
        idempotencyKey,
        async (client, existingPayment) => {
          if (existingPayment) {
            const existingPlan = await repository.findPlanByCode(
              client,
              planCode,
            );

            if (
              (existingPayment.request_fingerprint !== null &&
                existingPayment.request_fingerprint !== requestFingerprint) ||
              existingPayment.card_last4.trim() !== card.number.slice(-4) ||
              existingPayment.status !== paymentStatus
            ) {
              throw new AppError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "La clave ya fue utilizada para otra solicitud.",
              );
            }

            const previousSubscription =
              existingPayment.status === "approved"
                ? await repository.findSubscriptionByPayment(
                    client,
                    existingPayment.id,
                  )
                : null;

            return {
              payment: {
                id: existingPayment.id,
                status: existingPayment.status,
                amount: String(existingPayment.amount),
                currency: existingPayment.currency,
                reference: existingPayment.reference,
              },
              subscription: previousSubscription
                ? {
                    id: previousSubscription.id,
                    status: previousSubscription.status,
                    startedAt: previousSubscription.started_at,
                    expiresAt: previousSubscription.expires_at,
                  }
                : null,
              repeated: true,
            };
          }

          const plan = await repository.findPlanByCode(client, planCode);

          if (!plan) {
            throw new AppError(
              404,
              "PLAN_NOT_FOUND",
              "El plan solicitado no está disponible.",
            );
          }

          const payment = await repository.createPayment(client, {
            userId,
            planId: plan.id,
            amount: String(plan.monthly_price),
            currency: plan.currency,
            status: paymentStatus,
            cardLast4: card.number.slice(-4),
            idempotencyKey,
            reference: randomUUID(),
            requestFingerprint,
          });

          let subscription = null;

          if (paymentStatus === "approved") {
            subscription = await repository.activateSubscription(
              client,
              userId,
              plan.id,
            );

            await repository.linkPaymentToSubscription(
              client,
              payment.id,
              subscription.id,
            );
          }

          return {
            payment: {
              id: payment.id,
              status: payment.status,
              amount: String(payment.amount),
              currency: payment.currency,
              reference: payment.reference,
            },
            subscription: subscription
              ? {
                  id: subscription.id,
                  status: subscription.status,
                  startedAt: subscription.started_at,
                  expiresAt: subscription.expires_at,
                }
              : null,
            repeated: false,
          };
        },
      );
    },

    async getPaymentHistory(userId, page = 1, limit = 10) {
      const pageNumber = Number(page);
      const limitNumber = Number(limit);

      if (
        !Number.isSafeInteger(pageNumber) ||
        pageNumber < 1 ||
        !Number.isSafeInteger(limitNumber) ||
        limitNumber < 1 ||
        limitNumber > 100
      ) {
        throw new AppError(
          400,
          "INVALID_PAGINATION",
          "La página debe ser mayor que 0 y el límite debe estar entre 1 y 100.",
        );
      }

      const offset = (pageNumber - 1) * limitNumber;

      if (!Number.isSafeInteger(offset)) {
        throw new AppError(
          400,
          "INVALID_PAGINATION",
          "La paginación solicitada es demasiado grande.",
        );
      }

      let payments;
      let total;

      try {
        payments = await repository.listPaymentsByUser(
          userId,
          limitNumber,
          offset,
        );

        total = await repository.countPaymentsByUser(userId);
      } catch {
        throw new AppError(
          503,
          "DATABASE_UNAVAILABLE",
          "No se pudo consultar el historial de pagos.",
        );
      }

      return {
        payments: payments.map((payment) => ({
          id: payment.id,
          planId: payment.plan_id,
          amount: String(payment.amount),
          currency: payment.currency,
          status: payment.status,
          cardLast4: payment.card_last4.trim(),
          reference: payment.reference,
          createdAt: payment.created_at,
        })),
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber),
        },
      };
    },
  };
}
