-- S3-04: conversión interna. No crea imágenes ni consume cuotas de clientes.
-- S3-08 debe integrar la reserva y la publicación antes de exponer admisión HTTP.
CREATE TABLE image_processing_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  original_name VARCHAR(255) NOT NULL,
  original_size_bytes BIGINT NOT NULL CHECK (original_size_bytes > 0 AND original_size_bytes <= 25000000),
  original_hash CHAR(64) NOT NULL CHECK (original_hash ~ '^[a-f0-9]{64}$'),
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'converted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at TIMESTAMPTZ,
  CHECK ((status = 'converted') = (converted_at IS NOT NULL))
);
CREATE INDEX image_processing_jobs_owner_idx ON image_processing_jobs(user_id, created_at DESC);
CREATE INDEX image_processing_jobs_pending_idx ON image_processing_jobs(created_at) WHERE status IN ('queued', 'processing');
COMMENT ON TABLE image_processing_jobs IS
  'Conversión temporal por trabajo; converted no significa imagen publicada ni cuota confirmada.';
