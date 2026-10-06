import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from '../lib/app-error.js';

export function normalizeJobId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
    throw new AppError(400, 'INVALID_JOB_ID', 'El identificador de trabajo no es válido.');
  }
  return id.toLowerCase();
}

export function jobPaths(storageRoot, id) {
  const directory = path.resolve(storageRoot, '.tmp', 'jobs', normalizeJobId(id));
  return { directory, original: path.join(directory, 'original'), result: path.join(directory, 'result.webp'),
    receipt: path.join(directory, 'result.json'), prepared: path.join(directory, 'prepared.webp') };
}

export async function statOrNull(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// No atravesar enlaces/junctions dentro del espacio privado de trabajos.
export async function checkJobDirectory(storageRoot, id, { create = false } = {}) {
  let directory = path.resolve(storageRoot);
  for (const part of ['', '.tmp', 'jobs', normalizeJobId(id)]) {
    directory = path.join(directory, part);
    if (create) await mkdir(directory, { recursive: true });
    const info = await statOrNull(directory);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new AppError(503, 'JOB_UNSAFE_PATH', 'Directorio temporal no válido.');
    if (!info && !create) return false;
  }
  return true;
}

export async function fingerprint(filename, limit = Infinity) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new AppError(422, 'JOB_INPUT_INVALID', 'El temporal no es un archivo válido.');
  if (info.size > limit) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filename)) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
    hash.update(chunk);
  }
  return { hash: hash.digest('hex'), size };
}

export async function saveResult(files, job, optimizedPath) {
  await rename(optimizedPath, files.prepared);
  const digest = await fingerprint(files.prepared);
  const handle = await open(files.prepared, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  const receipt = { version: 1, id: job.id, originalHash: job.original_hash, ...digest };
  const manifest = await open(`${files.receipt}.tmp`, 'w');
  try { await manifest.writeFile(JSON.stringify(receipt)); await manifest.sync(); }
  finally { await manifest.close(); }
  await rename(`${files.receipt}.tmp`, files.receipt);
  await rename(files.prepared, files.result);
}

export async function recoverResult(files, job) {
  const manifestInfo = await statOrNull(files.receipt);
  if (!manifestInfo) return false;
  if (!manifestInfo.isFile() || manifestInfo.size > 4096) throw new AppError(422, 'JOB_RESULT_INVALID', 'Resultado temporal inválido.');
  let receipt;
  try { receipt = JSON.parse(await readFile(files.receipt, 'utf8')); }
  catch { throw new AppError(422, 'JOB_RESULT_INVALID', 'Resultado temporal inválido.'); }
  const candidate = await statOrNull(files.result) ? files.result : files.prepared;
  if (!await statOrNull(candidate)) throw new AppError(422, 'JOB_RESULT_MISSING', 'Falta el resultado temporal.');
  const digest = await fingerprint(candidate);
  if (!receipt || receipt.version !== 1 || receipt.id !== job.id || receipt.originalHash !== job.original_hash ||
      receipt.hash !== digest.hash || receipt.size !== digest.size) {
    throw new AppError(422, 'JOB_RESULT_INVALID', 'Resultado temporal inválido.');
  }
  if (candidate === files.prepared) await rename(candidate, files.result);
  return true;
}

export async function verifyConverted(files, job) {
  if (await recoverResult(files, job)) return;
  // Compatibilidad con conversiones de S3-04 anteriores a los recibos.
  const info = await statOrNull(files.result);
  if (!info?.isFile() || !info.size) throw new AppError(422, 'JOB_RESULT_MISSING', 'Falta el resultado temporal.');
  try { if ((await sharp(files.result).metadata()).format === 'webp') return; } catch { /* below */ }
  throw new AppError(422, 'JOB_RESULT_INVALID', 'Resultado temporal inválido.');
}

// Se llama con el bloqueo PostgreSQL del UUID; jamás toca objetos definitivos.
export async function cleanJobFiles(storageRoot, id, { keepResult = false } = {}) {
  if (!await checkJobDirectory(storageRoot, id)) return;
  const files = jobPaths(storageRoot, id);
  if (!keepResult) return rm(files.directory, { recursive: true, force: true });
  for (const name of await readdir(files.directory)) {
    if (!['result.webp', 'result.json'].includes(name)) {
      await rm(path.join(files.directory, name), { recursive: true, force: true });
    }
  }
}
