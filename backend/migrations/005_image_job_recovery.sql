-- S3-05: PostgreSQL es la fuente de verdad; Redis puede reconstruirse.
ALTER TABLE image_processing_jobs
  ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  ADD COLUMN cleaned_at TIMESTAMPTZ,
  ADD COLUMN quota_managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN quota_settled_at TIMESTAMPTZ,
  ADD COLUMN published_image_id UUID REFERENCES images(id) ON DELETE SET NULL;
ALTER TABLE image_processing_jobs DROP CONSTRAINT image_processing_jobs_status_check;
ALTER TABLE image_processing_jobs DROP CONSTRAINT image_processing_jobs_check;
ALTER TABLE image_processing_jobs ADD CONSTRAINT image_processing_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'converted', 'published', 'failed'));
ALTER TABLE image_processing_jobs ADD CONSTRAINT image_processing_jobs_conversion_check
  CHECK ((status IN ('converted', 'published')) = (converted_at IS NOT NULL));
CREATE INDEX image_processing_jobs_recovery_idx ON image_processing_jobs(id)
  WHERE status IN ('queued', 'processing', 'converted') OR cleaned_at IS NULL
    OR (quota_managed AND quota_settled_at IS NULL);
