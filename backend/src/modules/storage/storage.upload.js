import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { AppError } from '../../lib/app-error.js';
import { MAX_UPLOAD_BYTES, removeTemporary } from './storage.files.js';

export function createUploadMiddleware(storageRoot) {
  const directory = path.join(storageRoot, '.tmp');
  const storage = multer.diskStorage({
    destination(_req, _file, callback) {
      mkdir(directory, { recursive: true }).then(
        () => callback(null, directory),
        () => callback(new AppError(503, 'STORAGE_UNAVAILABLE', 'No se pudo preparar el almacenamiento temporal.')),
      );
    },
    filename(_req, _file, callback) {
      callback(null, `${randomUUID()}.upload`);
    },
  });
  const receive = multer({
    storage,
    defParamCharset: 'utf8',
    // Busboy puede marcar truncado al alcanzar el límite. El servicio comprueba
    // > MAX_UPLOAD_BYTES para admitir exactamente 25,000,000 bytes.
    limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 1, fieldNameSize: 100, fieldSize: 100, parts: 3 },
  }).single('file');

  return (req, res, next) => {
    receive(req, res, (error) => {
      if (!error) return next();
      removeTemporary(req.file?.path).then(() => {
        if (error instanceof AppError) return next(error);
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.'));
        }
        if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(error.code)) {
          return next(new AppError(503, 'STORAGE_UNAVAILABLE', 'No se pudo escribir la imagen temporal.'));
        }
        return next(new AppError(400, 'INVALID_MULTIPART', 'El formulario de subida es inválido o contiene campos adicionales.'));
      }).catch(next);
    });
  };
}
