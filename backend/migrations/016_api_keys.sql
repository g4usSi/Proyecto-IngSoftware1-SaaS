-- CU-14 y RNF-STO-03: claves de API para el SDK. La clave completa se muestra una sola vez;
-- aquí solo se guarda su huella SHA-256 y un prefijo para reconocerla.
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL CHECK (length(btrim(name)) > 0),
  key_prefix VARCHAR(16) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX api_keys_user_idx ON api_keys (user_id, created_at DESC);
