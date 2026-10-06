import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '../../lib/app-error.js';

// Un JWT es una cadena firmada "cabecera.datos.firma". El servidor no guarda sesiones:
// verifica la firma y la fecha de vencimiento. Aquí solo va el id del usuario (sub) y el id
// único del token (jti), que permite revocarlo al cerrar sesión. El rol NO va en el token:
// se lee de la BD en cada petición para que un cambio de rol o una desactivación apliquen de inmediato.
const ALGORITHM = 'HS256';

export function createTokenService({ secret, expiresIn }) {
  function ensureConfigured() {
    if (!secret) {
      throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'La autenticación no está configurada en el servidor (falta JWT_SECRET).');
    }
  }

  return {
    ensureConfigured,

    issue(userId) {
      ensureConfigured();
      const token = jwt.sign({}, secret, { algorithm: ALGORITHM, subject: userId, jwtid: randomUUID(), expiresIn });
      const { exp } = jwt.decode(token);
      return { token, expiresAt: new Date(exp * 1000) };
    },

    // Devuelve { sub, jti, exp } o lanza 401. Solo acepta HS256 (evita tokens con alg "none").
    verify(token) {
      ensureConfigured();
      let claims;
      try {
        claims = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
      } catch (error) {
        if (error.name === 'TokenExpiredError') {
          throw new AppError(401, 'TOKEN_EXPIRED', 'La sesión expiró. Inicia sesión de nuevo.');
        }
        throw invalidToken();
      }
      if (typeof claims.sub !== 'string' || typeof claims.jti !== 'string' || typeof claims.exp !== 'number') {
        throw invalidToken();
      }
      return { sub: claims.sub, jti: claims.jti, exp: claims.exp };
    },
  };
}

export function invalidToken() {
  return new AppError(401, 'TOKEN_INVALID', 'La sesión no es válida. Inicia sesión de nuevo.');
}
