-- Reservar y confirmar imputan el consumo al día de admisión, en Guatemala.
-- La migración 005 publicada conserva su checksum.
ALTER TABLE quota_reservations
  ADD COLUMN usage_date DATE,
  ADD COLUMN image_id UUID REFERENCES images(id) ON DELETE SET NULL;
UPDATE quota_reservations
SET usage_date = (created_at AT TIME ZONE 'America/Guatemala')::date;
ALTER TABLE quota_reservations
  ALTER COLUMN usage_date SET NOT NULL,
  ALTER COLUMN usage_date SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Guatemala')::date);
CREATE UNIQUE INDEX quota_reservations_image_idx ON quota_reservations(image_id)
  WHERE image_id IS NOT NULL;

-- Una referencia publicada previamente por un adaptador ya tiene reserva.
UPDATE quota_reservations r SET image_id = j.published_image_id
FROM image_processing_jobs j
WHERE j.id = r.reservation_key AND j.user_id = r.user_id
  AND r.status = 'confirmed' AND j.published_image_id IS NOT NULL;
UPDATE quota_reservations r SET image_id = i.id
FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
WHERE r.reservation_key = i.id AND r.user_id = i.user_id
  AND r.status = 'confirmed' AND r.reserved_bytes = o.original_size_bytes
  AND r.image_id IS NULL;

-- El consumo anterior síncrono pasa a eventos persistentes, uno por imagen.
-- No se duplican referencias que ya están ligadas a una reserva confirmada.
INSERT INTO quota_reservations
  (user_id, reservation_key, reserved_bytes, status, created_at, confirmed_at, usage_date, image_id)
SELECT i.user_id, i.id, o.original_size_bytes, 'confirmed', i.created_at, i.created_at,
       (i.created_at AT TIME ZONE 'America/Guatemala')::date, i.id
FROM images i JOIN stored_objects o ON o.hash_sha256 = i.object_hash
WHERE NOT EXISTS (SELECT 1 FROM quota_reservations r WHERE r.image_id = i.id);

-- Reconstruye únicamente los agregados de este historial; las reservas se
-- conservan también después de borrar la imagen. Corrige cruces de medianoche.
UPDATE quota_daily_usage SET upload_count = 0, uploaded_bytes = 0;
INSERT INTO quota_daily_usage (user_id, usage_date, upload_count, uploaded_bytes)
SELECT user_id, usage_date, COUNT(*)::integer, SUM(reserved_bytes)
FROM quota_reservations WHERE status = 'confirmed'
GROUP BY user_id, usage_date
ON CONFLICT (user_id, usage_date) DO UPDATE SET
  upload_count = EXCLUDED.upload_count, uploaded_bytes = EXCLUDED.uploaded_bytes;
CREATE INDEX quota_reservations_pending_day_idx ON quota_reservations(user_id, usage_date)
  WHERE status = 'pending';

ALTER TABLE image_processing_jobs ADD COLUMN folder_id UUID;
ALTER TABLE image_processing_jobs ADD CONSTRAINT image_jobs_folder_owner_fk
  FOREIGN KEY (folder_id, user_id) REFERENCES folders(id, user_id)
  ON DELETE SET NULL (folder_id);

-- Limpieza durable después de eliminar la última referencia y confirmar SQL.
CREATE TABLE storage_cleanup_tasks (
  hash_sha256 CHAR(64) PRIMARY KEY CHECK (hash_sha256 ~ '^[a-f0-9]{64}$'),
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
