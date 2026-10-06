import { apiRequest } from '../../services/api.js';

export const JOB_STATUS_LABELS = Object.freeze({ queued: 'En cola', processing: 'Procesando',
  converted: 'Conversión terminada; publicación pendiente', published: 'Disponible', failed: 'No se pudo completar' });

export function getImageJob(id, options = {}) {
  return apiRequest(`/jobs/${encodeURIComponent(id)}`, options);
}

export function listImageJobs({ cursor, limit = 20, ...options } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return apiRequest(`/jobs?${query}`, options);
}

// Reusar options.token y options.signal. El componente controla polling y cancelación.
// Para subir, continuar usando uploadFile de storage.api.js hasta S3-11.
