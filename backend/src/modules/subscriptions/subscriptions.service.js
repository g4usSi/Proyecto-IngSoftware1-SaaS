import { AppError, notImplemented } from '../../lib/app-error.js';

export function createSubscriptionsService(repository) {
  return {
    async listPlans() {
      let plans;
      try {
        plans = await repository.listActivePlans();
      } catch {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'El catálogo de planes no está disponible. Revisa PostgreSQL y las migraciones.');
      }
      return plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        // BIGINT y NUMERIC viajan como texto para evitar pérdida de precisión.
        capacityBytes: String(plan.capacity_bytes),
        dailyUploadLimit: plan.daily_upload_limit,
        dailyBytesLimit: plan.daily_bytes_limit === null ? null : String(plan.daily_bytes_limit),
        monthlyPrice: plan.monthly_price === null ? null : String(plan.monthly_price),
        currency: plan.currency,
        billingPeriod: plan.billing_period,
        pricingModel: plan.pricing_model,
        storagePricePerGbMonth: plan.storage_price_per_gb_month === null ? null : String(plan.storage_price_per_gb_month),
        includedStorageBytes: plan.storage_included_bytes === null ? null : String(plan.storage_included_bytes),
        storageBillingBasis: plan.storage_billing_basis,
        // Compatibilidad del DTO anterior: nunca representar dólares como GTQ.
        monthlyPriceGtq: plan.currency === 'GTQ' && plan.monthly_price !== null ? String(plan.monthly_price) : null,
        active: plan.active,
      }));
    },
    async getMySubscription(_userId) {
      return notImplemented('SUBSCRIPTIONS_NOT_IMPLEMENTED', 'La consulta del plan del usuario está pendiente de implementación.');
    },
  };
}
