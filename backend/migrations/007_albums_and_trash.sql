-- La papelera conserva la referencia y su capacidad hasta el borrado definitivo.
ALTER TABLE images ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX images_owner_library_idx ON images(user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX images_owner_trash_idx ON images(user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL;

-- El destino puede desaparecer mientras un trabajo espera. La clave de
-- idempotencia compara la carpeta originalmente solicitada, que no es una FK.
ALTER TABLE image_processing_jobs ADD COLUMN admitted_folder_id UUID;
UPDATE image_processing_jobs SET admitted_folder_id = folder_id;
