const API_BASE = '/api';

/** Se emite cuando una petición con token recibe 401: la sesión ya no es válida. */
export const UNAUTHORIZED_EVENT = 'smartstorage:unauthorized';

export class ApiError extends Error {
  constructor(message, code, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, { body, token, headers, ...options } = {}, accept = 'application/json') {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', accept);
  const isFormData = body instanceof FormData;

  // The browser must add the multipart boundary when sending files.
  if (isFormData) requestHeaders.delete('Content-Type');
  else if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: requestHeaders,
    ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
  });
  if (token && response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  return response;
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new ApiError('El servicio devolvió una respuesta inesperada.', 'INVALID_RESPONSE', response.status);
  }
}

async function throwResponseError(response) {
  const payload = await parseJson(response);
  throw new ApiError(
    typeof payload?.error?.message === 'string' ? payload.error.message : 'No se pudo completar la solicitud.',
    typeof payload?.error?.code === 'string' ? payload.error.code : 'REQUEST_FAILED',
    response.status,
    payload?.error?.details ?? null,
  );
}

/** Returns { data } content. Supports JSON or FormData; never persists tokens. */
export async function apiRequest(path, options = {}) {
  const response = await request(path, options);
  if (!response.ok) await throwResponseError(response);
  if (response.status === 204) return undefined;
  const payload = await parseJson(response);

  if (!payload || !Object.hasOwn(payload, 'data')) {
    throw new ApiError('El servicio devolvió una respuesta inesperada.', 'INVALID_RESPONSE', response.status);
  }

  return payload.data;
}

/** Authorized binary download; JSON API errors keep their original code. */
export async function apiBlobRequest(path, options = {}) {
  const response = await request(path, options, 'image/webp');
  if (!response.ok) await throwResponseError(response);
  return response.blob();
}

/** Descarga autenticada que respeta el nombre de Content-Disposition (p. ej. recibos PDF). */
export async function downloadAuthorized(path, { fallbackName, accept = 'application/pdf', ...options } = {}) {
  const response = await request(path, options, accept);
  if (!response.ok) await throwResponseError(response);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1] ?? match[2]) : fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return filename;
}
