
-- S4-02: Relacionar cada pago con la suscripción creada.

ALTER TABLE payments
ADD COLUMN subscription_id UUID
REFERENCES subscriptions(id);

-- Cada suscripción puede estar asociada
-- como máximo a un pago.
CREATE UNIQUE INDEX payments_subscription_unique_idx
ON payments(subscription_id)
WHERE subscription_id IS NOT NULL;
