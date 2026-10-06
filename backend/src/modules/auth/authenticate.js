import { AppError } from '../../lib/app-error.js';
import { invalidToken } from './token.js';

// Verifica el encabezado "Authorization: Bearer <token>" y devuelve la identidad.
// Lo usa el middleware requireAuth: firma, expiración, revocación y estado de la cuenta.
export function createAuthenticator({ repository, tokens }) {
  return async function authenticate(authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Debes iniciar sesión para acceder a este recurso.');
    }
    const claims = tokens.verify(match[1]);

    if (await repository.isTokenRevoked(claims.jti)) throw invalidToken();
    const user = await repository.findUserById(claims.sub);
    if (!user) throw invalidToken();
    if (!user.active) {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Contacta al administrador.');
    }

    return {
      // Identidad y rol salen de la BD, nunca del token ni del cuerpo de la petición.
      user: { id: user.id, email: user.email, role: user.role },
      session: { jti: claims.jti, userId: user.id, expiresAt: new Date(claims.exp * 1000) },
    };
  };
}
