-- RF-STO-11: formato real del original (por su firma), para mostrarlo en el detalle de la imagen.
-- Los objetos y trabajos anteriores quedan con NULL: su formato no se registró al subirlos.
ALTER TABLE stored_objects
  ADD COLUMN original_format VARCHAR(8) CHECK (original_format IN ('jpeg', 'png', 'webp'));

ALTER TABLE image_processing_jobs
  ADD COLUMN original_format VARCHAR(8) CHECK (original_format IN ('jpeg', 'png', 'webp'));
