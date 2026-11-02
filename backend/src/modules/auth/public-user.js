// Columnas públicas del usuario: password_hash nunca se selecciona para respuestas.
export const PUBLIC_USER_COLUMNS = 'id, name, email, role, active, email_verified, created_at';

// Fila de `users` -> objeto de la API (camelCase). Nunca incluye password_hash.
export function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    emailVerified: user.email_verified,
    createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
  };
}
