-- Tokens JWT revocados al cerrar sesión (RF03). Se identifican por su jti (id único del token).
-- Una fila solo importa hasta expires_at: después el token ya está vencido y se puede purgar.
CREATE TABLE revoked_tokens (
  jti UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revoked_tokens_expires_at_idx ON revoked_tokens(expires_at);
