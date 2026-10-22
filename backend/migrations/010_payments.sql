
-- S4-02: Historial de pagos simulados.
-- No se almacenan numeros completos de tarjeta ni CVV.

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id),

    plan_id UUID NOT NULL REFERENCES plans(id),

    amount NUMERIC(12, 2) NOT NULL
        CHECK (amount >= 0),

    currency VARCHAR(3) NOT NULL DEFAULT 'USD'
        CHECK (currency = 'USD'),

    status VARCHAR(16) NOT NULL
        CHECK (status IN ('approved', 'rejected', 'error')),

    card_last4 CHAR(4) NOT NULL
        CHECK (card_last4 ~ '^[0-9]{4}$'),

    reference VARCHAR(100) NOT NULL UNIQUE,

    idempotency_key VARCHAR(120) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT payments_user_idempotency_unique
        UNIQUE (user_id, idempotency_key)
);

-- Consultar el historial de cada usuario,
-- ordenado desde el pago mas reciente.
CREATE INDEX payments_user_history_idx
    ON payments(user_id, created_at DESC, id DESC);

COMMENT ON TABLE payments IS
    'Registro de pagos simulados para contratacion de planes S4-02.';

COMMENT ON COLUMN payments.card_last4 IS
    'Solo los ultimos cuatro digitos; nunca guardar PAN completo ni CVV.';

COMMENT ON COLUMN payments.idempotency_key IS
    'Impide registrar dos pagos con la misma clave para un usuario.';
