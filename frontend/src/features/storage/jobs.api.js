import { ApiError, apiRequest } from '../../services/api.js';
import { validateImage } from './storage.api.js';

export const JOB_STATUS_LABELS = Object.freeze({ queued: 'En cola', processing: 'Procesando',
  converted: 'Conversión terminada; publicación pendiente', published: 'Disponible', failed: 'No se pudo completar' });
export const ACTIVE_JOB_STATUSES = new Set(['queued', 'processing', 'converted']);
export const isJobReady = (job) => job.status === 'published' && job.available === true && Boolean(job.imageId);

export function jobStatusLabel(job) {
  return job.status === 'published' && !isJobReady(job) ? 'Publicada · no disponible' : JOB_STATUS_LABELS[job.status] ?? job.status;
}

export function jobFailureMessage(job) {
  return ({ JOB_EXPIRED: 'El proceso venció antes de terminar. Puedes volver a subir la imagen.',
    INVALID_IMAGE: 'El contenido del archivo no es una imagen válida.',
    UNSUPPORTED_IMAGE: 'El formato de esta imagen no está admitido.',
    ANIMATED_IMAGE_NOT_SUPPORTED: 'Las imágenes animadas no están admitidas.',
    IMAGE_DIMENSIONS_EXCEEDED: 'La imagen supera el límite de 40 megapíxeles.',
  })[job.errorCode] ?? 'No pudimos procesar esta imagen. Puedes volver a subirla más tarde.';
}

function requireJob(data) {
  if (!data?.id || !Object.hasOwn(JOB_STATUS_LABELS, data.status)) {
    throw new ApiError('No se pudo confirmar el estado de la subida.', 'INVALID_RESPONSE', 200);
  }
  return data;
}

export async function submitImageJob(file, { idempotencyKey, folderId, headers, ...options } = {}) {
  const problem = validateImage(file);
  if (problem) throw new ApiError(problem, 'INVALID_IMAGE', 400);
  const body = new FormData();
  body.set('file', file, file.name);
  if (folderId) body.set('folderId', folderId);
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Idempotency-Key', idempotencyKey);
  return requireJob(await apiRequest('/jobs', { ...options, headers: requestHeaders, method: 'POST', body }));
}

export async function getImageJob(id, options = {}) {
  return requireJob(await apiRequest(`/jobs/${encodeURIComponent(id)}`, options));
}

export async function listImageJobs({ cursor, limit = 20, ...options } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  const data = await apiRequest(`/jobs?${query}`, options);
  if (!Array.isArray(data?.items) || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) {
    throw new ApiError('El listado de procesos tiene un formato inesperado.', 'INVALID_RESPONSE', 200);
  }
  data.items.forEach(requireJob);
  return data;
}

export async function getMyQuota(options = {}) {
  const data = await apiRequest('/quotas/me', options);
  const decimal = (value) => /^\d+$/.test(String(value));
  if (!data?.plan?.name || !data.daily ||
    !['capacityBytes', 'usedBytes', 'reservedBytes', 'availableBytes'].every((key) => decimal(data[key])) ||
    !['uploadsUsed', 'uploadsReserved', 'bytesUsed', 'bytesReserved'].every((key) => decimal(data.daily[key])) ||
    !['uploadLimit', 'bytesLimit'].every((key) => data.daily[key] === null || decimal(data.daily[key]))) {
    throw new ApiError('No se pudo confirmar la cuota de tu cuenta.', 'INVALID_RESPONSE', 200);
  }
  return data;
}
