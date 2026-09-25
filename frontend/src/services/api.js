const API_BASE = '/api';

/** Se emite cuando una petición con token recibe 401: la sesión ya no es válida. */
export const UNAUTHORIZED_EVENT = 'smartstorage:unauthorized';

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
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
