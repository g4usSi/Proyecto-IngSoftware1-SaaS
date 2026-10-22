
-- S4-02: Identificar exactamente cada solicitud de pago.

ALTER TABLE payments
ADD COLUMN request_fingerprint VARCHAR(64);

-- Los pagos anteriores se conservan.
-- Las nuevas solicitudes guardarán su huella SHA-256.

ALTER TABLE payments
ADD CONSTRAINT payments_request_fingerprint_format
CHECK (
  request_fingerprint IS NULL
  OR request_fingerprint ~ '^[a-f0-9]{64}$'
);
