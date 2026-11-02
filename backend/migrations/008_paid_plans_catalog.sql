-- S4-01: Catalogo provisional de planes pagados.
-- Precios sujetos a confirmacion del equipo antes del lanzamiento.
-- Unidades decimales: 1 GB = 1000000000 bytes.

INSERT INTO plans (
    code,
    name,
    capacity_bytes,
    daily_upload_limit,
    daily_bytes_limit,
    monthly_price_gtq,
    active
)
VALUES
    (
        'standard',
        'Estándar',
        25000000000,
        NULL,
        500000000,
        35.00,
        TRUE
    ),
    (
        'pro',
        'Pro',
        100000000000,
        NULL,
        NULL,
        100.00,
        TRUE
    ),
    (
        'enterprise',
        'Enterprise',
        500000000000,
        NULL,
        NULL,
        300.00,
        TRUE
    )
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    capacity_bytes = EXCLUDED.capacity_bytes,
    daily_upload_limit = EXCLUDED.daily_upload_limit,
    daily_bytes_limit = EXCLUDED.daily_bytes_limit,
    monthly_price_gtq = EXCLUDED.monthly_price_gtq,
    active = EXCLUDED.active;