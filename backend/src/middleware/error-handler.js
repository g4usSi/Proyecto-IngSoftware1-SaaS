import { AppError } from '../lib/app-error.js';

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'La ruta solicitada no existe.'));
}

export function errorHandler(error, _req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo JSON no es válido.' } });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo de la solicitud es demasiado grande.' } });
  }
  // No devolver detalles de SQL, credenciales, contraseñas ni trazas al cliente.
  console.error('Error interno de API:', error.name || 'Error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno.' } });
}
