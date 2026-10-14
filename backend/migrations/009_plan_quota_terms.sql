-- S4-01: ajuste de cuotas y condiciones acordado el 14/10/2026.
-- Conserva los IDs, las suscripciones y los checksums de migraciones anteriores.
ALTER TABLE plans RENAME COLUMN monthly_price_gtq TO monthly_price;
ALTER TABLE plans
  ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'GTQ'
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN billing_period VARCHAR(20) NOT NULL DEFAULT 'calendar_month'
    CHECK (billing_period IN ('none', 'calendar_month')),
  ADD COLUMN pricing_model VARCHAR(24) NOT NULL DEFAULT 'fixed'
    CHECK (pricing_model IN ('fixed', 'base_plus_storage')),
  ADD COLUMN storage_price_per_gb_month NUMERIC(10, 2)
    CHECK (storage_price_per_gb_month > 0),
  ADD COLUMN storage_included_bytes BIGINT CHECK (storage_included_bytes >= 0),
  ADD COLUMN storage_billing_basis VARCHAR(32),
  ADD CONSTRAINT plans_storage_pricing_consistent CHECK (
    (pricing_model = 'fixed' AND storage_price_per_gb_month IS NULL
        AND storage_included_bytes IS NULL AND storage_billing_basis IS NULL)
    OR (pricing_model = 'base_plus_storage' AND storage_price_per_gb_month IS NOT NULL
        AND storage_included_bytes IS NOT NULL AND storage_billing_basis IS NOT NULL
        AND storage_billing_basis = 'time_weighted_excess')
  );

UPDATE plans SET currency = 'USD',
  monthly_price = CASE code
    WHEN 'free' THEN 0.00
    WHEN 'standard' THEN 8.00
    WHEN 'pro' THEN 15.00
    WHEN 'enterprise' THEN 40.00
  END,
  billing_period = CASE WHEN code = 'free' THEN 'none' ELSE 'calendar_month' END,
  pricing_model = CASE WHEN code = 'enterprise' THEN 'base_plus_storage' ELSE 'fixed' END,
  storage_price_per_gb_month = CASE WHEN code = 'enterprise' THEN 0.20 ELSE NULL END,
  storage_included_bytes = CASE WHEN code = 'enterprise' THEN 200000000000 ELSE NULL END,
  storage_billing_basis = CASE WHEN code = 'enterprise' THEN 'time_weighted_excess' ELSE NULL END
WHERE code IN ('free', 'standard', 'pro', 'enterprise');

UPDATE plans SET capacity_bytes = 200000000000 WHERE code = 'enterprise';

COMMENT ON COLUMN plans.monthly_price IS 'Precio mensual fijo o base en la moneda indicada por currency.';
COMMENT ON COLUMN plans.billing_period IS 'calendar_month: un mes calendario; none: Free sin vencimiento periódico.';
COMMENT ON COLUMN plans.storage_price_per_gb_month IS 'Importe por GB-mes decimal adicional, ponderado por tiempo. No se cobra por tráfico de subida ni por espacio físico deduplicado.';
COMMENT ON COLUMN plans.storage_included_bytes IS 'Almacenamiento lógico incluido en la base mensual; no genera cargo variable.';
COMMENT ON COLUMN plans.storage_billing_basis IS 'time_weighted_excess: integrar max(0, bytes lógicos - bytes incluidos) por tiempo y dividir por la duración del período mensual.';
