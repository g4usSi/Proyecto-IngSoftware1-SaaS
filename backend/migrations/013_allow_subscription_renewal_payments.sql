
-- S4-03: Permitir varios pagos asociados
-- a una misma suscripción.

DROP INDEX IF EXISTS payments_subscription_unique_idx;

CREATE INDEX payments_subscription_idx
ON payments(subscription_id)
WHERE subscription_id IS NOT NULL;
