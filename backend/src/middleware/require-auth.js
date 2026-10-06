import { AppError } from '../lib/app-error.js';

// Exige un JWT Bearer válido y establece req.user = { id, email, role } y req.session = { jti, userId, expiresAt }.
// La función que verifica el token la instala createApp en app.locals (así los módulos siguen
// importando `requireAuth` igual que antes). Express 5 reenvía los rechazos de una función async.
export async function requireAuth(req, _res, next) {
  const authenticate = req.app.locals.authenticate;
  if (!authenticate) throw new Error('La autenticación no está montada en la aplicación.');
  const { user, session } = await authenticate(req.get('Authorization'));
  req.user = user;
  req.session = session;
  next();
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
