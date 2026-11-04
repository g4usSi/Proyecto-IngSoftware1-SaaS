import { apiRequest } from '../../services/api.js';

/** Claves de API del SDK (CU-14). La clave completa solo llega en la respuesta de createApiKey. */
export const listApiKeys = ({ token, signal } = {}) => apiRequest('/keys', { token, signal });
export const createApiKey = (name, { token } = {}) => apiRequest('/keys', { method: 'POST', body: { name }, token });
export const revokeApiKey = (id, { token } = {}) => apiRequest(`/keys/${encodeURIComponent(id)}`, { method: 'DELETE', token });

/** Ejemplo listo para copiar con la clave recién creada o un marcador. */
export function sdkSnippet(secret = 'ss_tu_clave') {
  return [
    "import { SmartStorageClient } from './sdk/src/index.js';",
    '',
    `const client = new SmartStorageClient({ apiKey: '${secret}' });`,
    "const job = await client.uploadImage('foto.jpg');",
    "await client.downloadImageTo(job.imageId, 'foto.webp');",
  ].join('\n');
}
