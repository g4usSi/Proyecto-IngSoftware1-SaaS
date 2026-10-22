-- S4-05 / RF-AUT-12 y RNF-AUT-10: bitácora de autenticación y gestión de cuentas.
-- No guarda contraseñas ni tokens. user_id es la cuenta afectada; actor_id, quien hizo el cambio.
CREATE TABLE auth_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN (
    'login_success', 'login_failed', 'logout', 'password_changed', 'password_reset', 'account_status_changed'
  )),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(254),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  ip_address VARCHAR(64),
  user_agent VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_events_created_idx ON auth_events (created_at DESC, id DESC);
CREATE INDEX auth_events_user_idx ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_type_idx ON auth_events (event_type, created_at DESC);
