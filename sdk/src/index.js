// SDK de SmartStorage para Node.js 18 o superior. Sin dependencias: usa fetch, FormData y Blob nativos.
// Se autentica con una clave de API (ss_...) creada en la aplicación: Cuenta → Claves de API.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class SmartStorageError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details } = {}) {
    super(message);
    this.name = 'SmartStorageError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (error) => error.code === 'NETWORK_ERROR' || error.status >= 500;

export class SmartStorageClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey Clave de API (empieza con "ss_").
   * @param {string} [options.baseUrl] URL base de la API, por defecto http://127.0.0.1:3000/api.
   * @param {number} [options.timeoutMs] Tiempo máximo de cada petición HTTP.
   */
  constructor({ apiKey, baseUrl = 'http://127.0.0.1:3000/api', timeoutMs = 30_000, fetch = globalThis.fetch } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.startsWith('ss_')) {
      throw new TypeError('apiKey debe ser una clave de API de SmartStorage (empieza con "ss_").');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetch = fetch;
  }

  async #request(route, { method = 'GET', body, headers = {}, raw = false } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${route}`, {
        method,
        body,
        headers: { Authorization: `Bearer ${this.apiKey}`, ...headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SmartStorageError(`No se pudo conectar con SmartStorage: ${error.message}`);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const failure = payload?.error ?? {};
      throw new SmartStorageError(failure.message ?? `Error HTTP ${response.status}`, {
        status: response.status, code: failure.code ?? 'HTTP_ERROR', details: failure.details,
      });
    }
    if (raw) return response;
    return (await response.json()).data;
  }

  #json(route, method, value) {
    return this.#request(route, { method, body: JSON.stringify(value ?? {}), headers: { 'Content-Type': 'application/json' } });
  }

  /** Plan vigente, capacidad y consumo diario. */
  quota() { return this.#request('/quotas/me'); }

  /** Espacio lógico frente a físico y ahorro acumulado de la cuenta. */
  summary() { return this.#request('/files/summary'); }

  /** Una página de imágenes: { items, unavailableItems, nextCursor }. */
  listImages({ limit, cursor, folderId, trash } = {}) {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set('limit', String(limit));
    if (cursor) query.set('cursor', cursor);
    if (folderId !== undefined) query.set('folderId', folderId === null ? 'none' : folderId);
    if (trash !== undefined) query.set('trash', String(trash));
    return this.#request(`/files${query.size ? `?${query}` : ''}`);
  }

  /** Recorre todas las imágenes, página por página. */
  async *images(options = {}) {
    let cursor;
    do {
      const page = await this.listImages({ ...options, cursor });
      yield* page.items;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /**
   * Sube una imagen JPG, PNG o WebP de hasta 25 MB y, por defecto, espera a que se publique.
   * @param {string|Buffer|Uint8Array|Blob} input Ruta del archivo o su contenido.
   * @returns {Promise<object>} El trabajo; con wait, incluye imageId y available.
   */
  async uploadImage(input, { filename, folderId, wait = true, timeoutMs = 120_000, idempotencyKey = randomUUID() } = {}) {
    const name = filename ?? (typeof input === 'string' ? path.basename(input) : 'imagen');
    const content = typeof input === 'string' ? await readFile(input) : input;
    const blob = content instanceof Blob ? content : new Blob([content]);
    // La misma Idempotency-Key en cada reintento: si la primera respuesta se perdió, el servidor
    // devuelve el mismo trabajo en lugar de admitir otra carga.
    let job;
    for (let attempt = 1; ; attempt += 1) {
      const form = new FormData();
      form.append('file', blob, name);
      if (folderId) form.append('folderId', folderId);
      try {
        job = await this.#request('/jobs', { method: 'POST', body: form, headers: { 'Idempotency-Key': idempotencyKey } });
        break;
      } catch (error) {
        if (attempt >= 3 || !retryable(error)) throw error;
        await sleep(500 * attempt);
      }
    }
    return wait ? this.waitForJob(job.id, { timeoutMs }) : job;
  }

  getJob(jobId) { return this.#request(`/jobs/${encodeURIComponent(jobId)}`); }

  /** Consulta el trabajo hasta que termina. Lanza JOB_FAILED o JOB_TIMEOUT. */
  async waitForJob(jobId, { timeoutMs = 120_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getJob(jobId);
      if (job.status === 'published') return job;
      if (job.status === 'failed') {
        throw new SmartStorageError('La imagen no se pudo procesar.', { status: 422, code: 'JOB_FAILED', details: { jobId, errorCode: job.errorCode } });
      }
      if (Date.now() >= deadline) {
        throw new SmartStorageError('La imagen sigue en proceso; consulta el trabajo más tarde.', { code: 'JOB_TIMEOUT', details: { jobId } });
      }
      await sleep(Math.min(job.nextPollAfterMs ?? 1000, Math.max(0, deadline - Date.now())));
    }
  }

  /** Contenido WebP de una imagen propia, como Buffer. */
  async downloadImage(imageId) {
    const response = await this.#request(`/files/${encodeURIComponent(imageId)}/download`, { raw: true });
    return Buffer.from(await response.arrayBuffer());
  }

  /** Descarga el WebP a un archivo y devuelve su ruta. */
  async downloadImageTo(imageId, filePath) {
    await writeFile(filePath, await this.downloadImage(imageId));
    return filePath;
  }

  listAlbums() { return this.#request('/albums'); }
  createAlbum(name) { return this.#json('/albums', 'POST', { name }); }
  moveImage(imageId, folderId) { return this.#json(`/files/${encodeURIComponent(imageId)}`, 'PATCH', { folderId }); }
  trashImage(imageId) { return this.#json(`/files/${encodeURIComponent(imageId)}/trash`, 'POST'); }
  restoreImage(imageId) { return this.#json(`/files/${encodeURIComponent(imageId)}/restore`, 'POST'); }
  deleteImage(imageId) { return this.#request(`/files/${encodeURIComponent(imageId)}`, { method: 'DELETE' }); }
}
