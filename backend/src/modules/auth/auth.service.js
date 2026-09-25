import { AppError, notImplemented } from '../../lib/app-error.js';
import { hashPassword, verifyPassword } from './password.js';
import { normalizeEmail, validateRegistration } from './auth.validation.js';
import { createLoginLimiter } from './login-limiter.js';
import { invalidToken } from './token.js';

const UNIQUE_VIOLATION = '23505';
const PASSWORD_MAX = 128;

// Se compara contra este hash cuando el correo no existe, para que el tiempo de respuesta
// no revele si la cuenta existe. Se calcula una sola vez, la primera vez que hace falta.
let dummyHash;

export function createAuthService({ repository, tokens, loginLimiter = createLoginLimiter() }) {
  return {
    // RF01, RF11, RNF01: valida, hashea la contraseña y crea la cuenta (activa por defecto, RF10).
    async register(input) {
      const { name, email, password } = validateRegistration(input);

      if (await repository.findUserByEmail(email)) throw emailTaken();

      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await repository.createUser({ name, email, passwordHash });
      } catch (error) {
        // Dos registros simultáneos pueden pasar la consulta anterior; la restricción UNIQUE los frena.
        if (error?.code === UNIQUE_VIOLATION) throw emailTaken();
        throw error;
      }
      if (!user) {
        throw new AppError(503, 'FREE_PLAN_UNAVAILABLE', 'El plan Free no está disponible para registrar cuentas.');
      }
      return toPublicUser(user);
    },

    // RF02, RF04, RF10, RNF11: credenciales -> token. Nunca revela si el correo existe.
    async login(input) {
      const { email, password } = input ?? {};
      if (typeof email !== 'string' || email.trim() === '' || typeof password !== 'string' || password === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'El correo electrónico y la contraseña son obligatorios.');
      }
      tokens.ensureConfigured();

      const key = normalizeEmail(email);
      const lockedSeconds = loginLimiter.lockedFor(key);
      if (lockedSeconds > 0) {
        const minutes = Math.ceil(lockedSeconds / 60);
        throw new AppError(429, 'TOO_MANY_ATTEMPTS',
          `Demasiados intentos fallidos. Inténtalo de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`);
      }

      const user = await repository.findUserByEmail(key);
      // Una contraseña enorme se rechaza sin hashearla (evita gastar CPU); cuenta como intento fallido.
      const passwordOk = password.length <= PASSWORD_MAX &&
        await verifyPassword(password, user?.password_hash ?? await getDummyHash());
      if (!user || !passwordOk) {
        loginLimiter.recordFailure(key);
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo electrónico o contraseña incorrectos.');
      }
      // Solo se informa de la desactivación cuando la contraseña es correcta (no revela qué correos existen).
      if (!user.active) {
        throw new AppError(403, 'ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Contacta al administrador.');
      }

      loginLimiter.reset(key);
      const { token, expiresAt } = tokens.issue(user.id);
      return { token, expiresAt: expiresAt.toISOString(), user: toPublicUser(user) };
    },

    // RF03: revoca el token de la sesión actual (identity = req.session, cargado por requireAuth).
    async logout(session) {
      await repository.revokeToken(session);
      await repository.purgeExpiredRevocations();
      return { loggedOut: true };
    },

    async getCurrentUser(identity) {
      const user = await repository.findUserById(identity.id);
      if (!user) throw invalidToken();
      return toPublicUser(user);
    },

    // Pendientes de bloques posteriores: siguen devolviendo 501.
    async verifyEmail(_input) {
      return pending();
    },
    async forgotPassword(_input) {
      return pending();
    },
    async resetPassword(_input) {
      return pending();
    },
  };
}

async function getDummyHash() {
  dummyHash ??= hashPassword('contraseña-de-relleno');
  return dummyHash;
}

// Nunca incluye password_hash.
function toPublicUser(user) {
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

function emailTaken() {
  return new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'El correo electrónico ya está registrado.');
}

function pending() {
  return notImplemented('AUTH_NOT_IMPLEMENTED', 'El módulo de autenticación está pendiente de implementación.');
}
