import { ApiError, apiRequest } from '../../services/api.js';

export function registerAccount({ name, email, password }) {
  return apiRequest('/auth/register', { method: 'POST', body: { name, email, password } });
}

export async function login({ email, password }) {
  const data = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
  if (typeof data?.token !== 'string' || !data?.user?.id) {
    throw new ApiError('El servicio devolvió una sesión inesperada.', 'INVALID_RESPONSE', 200);
  }
  return data;
}

export function logout(token) {
  return apiRequest('/auth/logout', { method: 'POST', token });
}

const messages = {
  TOO_MANY_ATTEMPTS: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
  ACCOUNT_DISABLED: 'Esta cuenta está desactivada. Contacta al administrador.',
};

export function authErrorMessage(error) {
  if (!(error instanceof ApiError)) return 'No se pudo conectar con el servicio. Vuelve a intentarlo.';
  return messages[error.code] ?? error.message;
}

// ── Verificación de correo y recuperación de contraseña ──
// Respuestas neutrales: forgot/resend nunca revelan si la cuenta existe.
export function verifyEmail(token) {
  return apiRequest('/auth/verify-email', { method: 'POST', body: { token } });
}

export function resendVerification(email) {
  return apiRequest('/auth/resend-verification', { method: 'POST', body: { email } });
}

export function forgotPassword(email) {
  return apiRequest('/auth/forgot-password', { method: 'POST', body: { email } });
}

export function resetPassword({ token, password }) {
  return apiRequest('/auth/reset-password', { method: 'POST', body: { token, password } });
}

export function changePassword({ currentPassword, newPassword }, { token, signal }) {
  return apiRequest('/auth/change-password', {
    method: 'POST', token, signal, body: { currentPassword, newPassword },
  });
}
