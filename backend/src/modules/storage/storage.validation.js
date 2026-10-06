import { AppError } from '../../lib/app-error.js';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireStorageIdentity(req, _res, next) {
  if (!req.user || typeof req.user.id !== 'string' || !UUID_PATTERN.test(req.user.id)) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'Se necesita una identidad autenticada para esta operación.'));
  }
  return next();
}

export function requireStorageAdmin(req, _res, next) {
  if (req.user.role !== 'admin') {
    return next(new AppError(403, 'ADMIN_REQUIRED', 'Esta operación requiere una cuenta de administrador.'));
  }
  return next();
}

export function parseUploadFields(body = {}) {
  if (Object.keys(body).some((key) => key !== 'folderId')) {
    throw new AppError(400, 'INVALID_MULTIPART', 'El formulario solo admite file y folderId opcional.');
  }
  const folderId = body.folderId;
  if (folderId === undefined || folderId === '') return { folderId: null };
  if (typeof folderId !== 'string' || !UUID_PATTERN.test(folderId)) {
    throw new AppError(400, 'INVALID_FOLDER_ID', 'folderId debe ser un UUID válido.');
  }
  return { folderId };
}

export function safeOriginalName(value) {
  const basename = String(value || '').replaceAll('\\', '/').split('/').pop();
  const clean = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(clean || 'imagen').slice(0, 255).join('');
}

export function parsePagination(query = {}) {
  const rawLimit = query.limit === undefined ? '20' : query.limit;
  if (typeof rawLimit !== 'string' || !/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
    throw new AppError(400, 'INVALID_LIMIT', 'limit debe ser un entero entre 1 y 100.');
  }
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!cursor || typeof cursor !== 'object' || typeof cursor.id !== 'string' || !UUID_PATTERN.test(cursor.id) || typeof cursor.createdAt !== 'string') throw new Error();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.createdAt)) throw new Error();
      const date = new Date(cursor.createdAt);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 23) !== cursor.createdAt.slice(0, 23)) throw new Error();
    } catch {
      throw new AppError(400, 'INVALID_CURSOR', 'El cursor de paginación no es válido.');
    }
  }
  return { limit: Number(rawLimit), cursor };
}

export function cursorFor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.cursor_created_at, id: row.id })).toString('base64url');
}

export function validateImageId(imageId) {
  if (typeof imageId !== 'string' || !UUID_PATTERN.test(imageId)) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'La imagen no existe o no está disponible para esta cuenta.');
  }
}
