-- El mismo orden que la paginación por cursor, sin OFFSET ni saltos por empates.
CREATE INDEX images_owner_created_id_idx ON images(user_id, created_at DESC, id DESC);
