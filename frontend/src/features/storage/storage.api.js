import { ApiError, apiBlobRequest, apiRequest } from '../../services/api.js';

export const MAX_IMAGE_BYTES = 25_000_000;
export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateImage(file) {
  if (!file) return 'Selecciona una imagen para continuar.';
  if (file.size === 0) return 'La imagen está vacía. Selecciona otro archivo.';
  if (file.size > MAX_IMAGE_BYTES) return 'La imagen supera los 25 MB (25,000,000 bytes).';
  if (!/\.(jpe?g|png|webp)$/i.test(file.name) || (file.type && !imageTypes.has(file.type))) {
    return 'Selecciona una imagen JPG, PNG o WebP.';
  }
  return null;
}

export async function getDemoConfiguration(options = {}) {
  const data = await apiRequest('/dev/storage-demo', options);
  if (typeof data?.enabled !== 'boolean' || (data.enabled && !Array.isArray(data.accounts))) {
    throw new ApiError('No se pudo consultar la configuración de la demo.', 'INVALID_RESPONSE', 200);
  }
  return data;
}

// Options carry either a verified session token or explicitly selected demo headers.
export async function listFiles({ cursor, ...options } = {}) {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const data = await apiRequest(`/files?${query}`, options);
  if (!Array.isArray(data?.items) || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) {
    throw new ApiError('El listado de imágenes tiene un formato inesperado.', 'INVALID_RESPONSE', 200);
  }
  return data;
}

export async function uploadFile(file, options = {}) {
  const validation = validateImage(file);
  if (validation) throw new ApiError(validation, 'INVALID_IMAGE', 400);
  const body = new FormData();
  body.append('file', file);
  const data = await apiRequest('/files', { ...options, method: 'POST', body });
  if (!data?.image?.id) {
    throw new ApiError('No se pudo confirmar la subida. Actualiza la galería antes de volver a intentarlo.', 'INVALID_RESPONSE', 200);
  }
  return data.image;
}

export async function downloadFile(id, options = {}) {
  const blob = await apiBlobRequest(`/files/${encodeURIComponent(id)}/download`, options);
  if (blob.type.split(';')[0] !== 'image/webp' || blob.size === 0) {
    throw new ApiError('El servicio no devolvió una imagen WebP válida.', 'INVALID_RESPONSE', 200);
  }
  return blob;
}

export function webpFilename(originalName) {
  const basename = String(originalName || 'imagen').split(/[\\/]/).pop();
  const stem = basename.replace(/\.[^.]*$/, '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 150);
  const safeStem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `imagen-${stem}` : stem;
  return `${safeStem || 'imagen'}.webp`;
}

export function storageErrorMessage(error, fallback = 'No se pudo conectar con el servicio. Vuelve a intentarlo.') {
  return error instanceof ApiError ? error.message : fallback;
}
