CREATE TABLE quota_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES users(id),
  reservation_key UUID NOT NULL UNIQUE,

  reserved_bytes BIGINT NOT NULL
    CHECK (reserved_bytes > 0),

  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'released')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,

  CHECK (
    (status = 'pending'
      AND confirmed_at IS NULL
      AND released_at IS NULL)
    OR
    (status = 'confirmed'
      AND confirmed_at IS NOT NULL
      AND released_at IS NULL)
    OR
    (status = 'released'
      AND confirmed_at IS NULL
      AND released_at IS NOT NULL)
  )
);

CREATE INDEX quota_reservations_user_status_idx
  ON quota_reservations(user_id, status);


-- Historial diario independiente de la tabla images.
-- Esto evita que borrar una imagen devuelva el consumo diario ya realizado.
CREATE TABLE quota_daily_usage (
  user_id UUID NOT NULL REFERENCES users(id),

  usage_date DATE NOT NULL,

  upload_count INTEGER NOT NULL DEFAULT 0
    CHECK (upload_count >= 0),

  uploaded_bytes BIGINT NOT NULL DEFAULT 0
    CHECK (uploaded_bytes >= 0),

  PRIMARY KEY (user_id, usage_date)
);