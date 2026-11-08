import { AppError } from '../lib/app-error.js';

// La función que verifica la identidad la instala createApp en app.locals: acepta un JWT de sesión
// o, en las rutas que lo permiten, una clave de API del SDK. Express 5 reenvía los rechazos async.
async function identify(req) {
  const authenticate = req.app.locals.authenticate;
  if (!authenticate) throw new Error('La autenticación no está montada en la aplicación.');
  const identity = await authenticate(req.get('Authorization'));
  req.user = identity.user;
  req.session = identity.session;
  req.apiKey = identity.apiKey ?? null;
  return identity;
}

function apiKeyNotAllowed() {
  return new AppError(403, 'API_KEY_NOT_ALLOWED', 'Esta operación requiere iniciar sesión; no acepta claves de API.');
}

// Exige un JWT Bearer válido y establece req.user = { id, email, role } y req.session = { jti, userId, expiresAt }.
export async function requireAuth(req, _res, next) {
  const identity = await identify(req);
  if (identity.apiKey) throw apiKeyNotAllowed();
  next();
}

// Rutas del SDK (archivos, álbumes, trabajos y cuota propios): JWT o clave de API.
export async function requireAuthOrApiKey(req, _res, next) {
  await identify(req);
  next();
}

// Para routers que reciben su autenticación por parámetro y no deben aceptar claves de API.
export function rejectApiKey(req, _res, next) {
  next(req.apiKey ? apiKeyNotAllowed() : undefined);
}

// Control de acceso por rol (RF08, RNF06). Se usa después de requireAuth:
//   router.get('/users', requireAuth, requireRole('admin'), controller.list)
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción.'));
    }
    next();
  };
}
