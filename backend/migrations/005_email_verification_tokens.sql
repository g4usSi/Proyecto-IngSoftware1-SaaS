-- Tokens de un solo uso para verificar el correo. Igual que en password_reset_tokens,
-- solo se guarda el SHA-256 del valor enviado por correo.
CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_user_id_idx ON email_verification_tokens(user_id);
CREATE INDEX email_verification_tokens_expires_at_idx ON email_verification_tokens(expires_at);

-- El login empieza a exigir el correo verificado: las cuentas que ya existían no quedan bloqueadas.
UPDATE users SET email_verified = TRUE, updated_at = now() WHERE email_verified = FALSE;
