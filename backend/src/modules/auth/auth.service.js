import { randomBytes, createHash } from 'node:crypto';
import { AppError } from '../../lib/app-error.js';
import { hashPassword, verifyPassword } from './password.js';
import { normalizeEmail, passwordProblems, validateRegistration } from './auth.validation.js';
import { createLoginLimiter } from './login-limiter.js';
import { invalidToken } from './token.js';

const UNIQUE_VIOLATION = '23505';
const PASSWORD_MAX = 128;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora, según lo acordado
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

// Se compara contra este hash cuando el correo no existe, para que el tiempo de respuesta
// no revele si la cuenta existe. Se calcula una sola vez, la primera vez que hace falta.
let dummyHash;

export function createAuthService({ repository, tokens, loginLimiter = createLoginLimiter(), mailer, frontendUrl }) {
  // Deja un solo enlace de verificación válido por cuenta y lo envía por correo.
  async function sendVerification(user) {
    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    await repository.invalidateUserEmailVerificationTokens(user.id);
    await repository.createEmailVerificationToken({
      userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    });
    const verifyLink = `${frontendUrl}/verify-email?token=${rawToken}`;
    await mailer.sendEmailVerification({ to: user.email, name: user.name, verifyLink });
  }

  // Si el correo falla, la cuenta sigue existiendo y el usuario puede pedir el reenvío.
  async function trySendVerification(user) {
    try {
      await sendVerification(user);
    } catch (error) {
      console.error('No se pudo enviar el correo de verificación:', error?.message ?? error);
    }
  }

  // Deja un solo enlace de recuperación válido por cuenta y lo envía por correo. Si algo falla,
  // solo se registra: la respuesta debe ser la misma exista o no la cuenta (RNF12).
  async function trySendPasswordReset(user) {
    try {
      const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('hex');
      await repository.invalidateUserPasswordResetTokens(user.id);
      await repository.createPasswordResetToken({
        userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });
      const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;
      await mailer.sendPasswordReset({ to: user.email, name: user.name, resetLink });
    } catch (error) {
      console.error('No se pudo enviar el correo de recuperación:', error?.message ?? error);
    }
  }

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
      await trySendVerification(user);
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
      if (lockedSeconds > 0) throw tooManyAttempts(lockedSeconds);

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
      if (!user.email_verified) {
        throw new AppError(403, 'EMAIL_NOT_VERIFIED',
          'Debes verificar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.');
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

    // RF05: nunca revela si el correo existe (mismo principio que el login, RNF12).
    async forgotPassword(input) {
      const rawEmail = input?.email;
      if (typeof rawEmail !== 'string' || rawEmail.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'El correo electrónico es obligatorio.');
      }
      const email = normalizeEmail(rawEmail);

      const user = await repository.findUserByEmail(email);
      // Sin `await`: la respuesta no espera al servidor de correo, así que tarda lo mismo
      // exista o no la cuenta. trySendPasswordReset nunca rechaza (registra el error).
      if (user) void trySendPasswordReset(user);
      return { message: 'Si el correo está registrado, se enviaron instrucciones para restablecer la contraseña.' };
    },

    // RF05: consume el token de un solo uso y cambia la contraseña.
    async resetPassword(input) {
      const { token, password } = input ?? {};
      if (typeof token !== 'string' || token.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'El token de recuperación es obligatorio.');
      }
      if (typeof password !== 'string' || password === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'La contraseña es obligatoria.');
      }
      const problems = passwordProblems(password);
      if (problems.length > 0) throw new AppError(400, 'VALIDATION_ERROR', problems[0]);

      // El hash se calcula antes porque entra en la misma sentencia que gasta el enlace.
      // Un solo error para "no existe", "ya se usó" y "venció": no distingue el motivo.
      const userId = await repository.consumePasswordResetToken(hashToken(token), await hashPassword(password));
      if (!userId) throw invalidResetToken();
      return { reset: true };
    },

    // RF06: el usuario autenticado (identity = req.user) cambia su contraseña dando la actual.
    // Las demás sesiones siguen abiertas, igual que tras un reset.
    async changePassword(identity, input) {
      const { currentPassword, newPassword } = input ?? {};
      if (typeof currentPassword !== 'string' || currentPassword === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'La contraseña actual es obligatoria.');
      }
      if (typeof newPassword !== 'string' || newPassword === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'La nueva contraseña es obligatoria.');
      }
      const problems = passwordProblems(newPassword);
      if (problems.length > 0) throw new AppError(400, 'VALIDATION_ERROR', problems[0]);

      // Adivinar la contraseña desde aquí cuenta igual que en el login (RNF11): mismo límite, misma clave.
      const key = identity.email;
      const lockedSeconds = loginLimiter.lockedFor(key);
      if (lockedSeconds > 0) throw tooManyAttempts(lockedSeconds);

      const user = await repository.findUserByEmail(key);
      if (!user) throw invalidToken();
      const currentOk = currentPassword.length <= PASSWORD_MAX &&
        await verifyPassword(currentPassword, user.password_hash);
      if (!currentOk) {
        loginLimiter.recordFailure(key);
        throw invalidCurrentPassword();
      }
      if (newPassword === currentPassword) {
        throw new AppError(400, 'VALIDATION_ERROR', 'La nueva contraseña debe ser distinta de la actual.');
      }

      // Si otro cambio simultáneo ya reemplazó el hash, la contraseña actual dejó de ser válida.
      const changed = await repository.changePassword(user.id, user.password_hash, await hashPassword(newPassword));
      if (!changed) throw invalidCurrentPassword();
      loginLimiter.reset(key);
      return { changed: true };
    },

    async verifyEmail(input) {
      const token = input?.token;
      if (typeof token !== 'string' || token.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'El token de verificación es obligatorio.');
      }
      // Un solo error para "no existe", "ya se usó" y "venció".
      const userId = await repository.consumeEmailVerificationToken(hashToken(token));
      if (!userId) {
        throw new AppError(400, 'VERIFICATION_TOKEN_INVALID', 'El enlace de verificación no es válido o expiró.');
      }
      return { verified: true };
    },

    // Misma respuesta exista o no la cuenta, o si ya está verificada: no revela qué correos existen.
    async resendVerification(input) {
      const rawEmail = input?.email;
      if (typeof rawEmail !== 'string' || rawEmail.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'El correo electrónico es obligatorio.');
      }
      const user = await repository.findUserByEmail(normalizeEmail(rawEmail));
      if (user && user.active && !user.email_verified) await trySendVerification(user);
      return { message: 'Si el correo está registrado y aún no está verificado, se envió un nuevo enlace de verificación.' };
    },
  };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function tooManyAttempts(lockedSeconds) {
  const minutes = Math.ceil(lockedSeconds / 60);
  return new AppError(429, 'TOO_MANY_ATTEMPTS',
    `Demasiados intentos fallidos. Inténtalo de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`);
}

// 400 y no 401: el frontend cierra la sesión ante cualquier 401.
function invalidCurrentPassword() {
  return new AppError(400, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual es incorrecta.');
}

function invalidResetToken() {
  return new AppError(400, 'RESET_TOKEN_INVALID', 'El enlace de recuperación no es válido o expiró.');
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
