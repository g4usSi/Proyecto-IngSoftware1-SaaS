import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from '../../lib/app-error.js';

export const MAX_UPLOAD_BYTES = 25_000_000;
export const MAX_INPUT_PIXELS = 40_000_000;

// libvips no debe conservar descriptores de originales temporales entre
// operaciones: en Windows impedirían eliminar PNG/WebP al finalizar.
sharp.cache({ files: 0 });

export function storageKeyFor(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'El objeto almacenado no tiene una clave válida.');
  }
  return `${hash.slice(0, 2)}/${hash}.webp`;
}

export function objectPath(storageRoot, object) {
  const expectedKey = storageKeyFor(object.hash_sha256);
  if (object.storage_key !== expectedKey) {
    throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'La referencia del objeto almacenado no es válida.');
  }
  return path.join(storageRoot, ...expectedKey.split('/'));
}

export async function inspectStoredFile(storageRoot, object) {
  const filename = objectPath(storageRoot, object);
  try {
    const info = await lstat(filename, { bigint: true });
    if (!info.isFile() || info.size === 0n) throw new Error('Invalid object');
    return { filename, size: info.size };
  } catch {
    throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'Una imagen registrada no tiene un archivo válido en disco.');
  }
}

export async function removeTemporary(filename) {
  if (!filename) return;
  try {
    await unlink(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudo eliminar un archivo temporal de Storage.');
  }
}

async function signatureFormat(filename) {
  const file = await open(filename, 'r');
  try {
    const bytes = Buffer.alloc(12);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytesRead >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (bytesRead >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Solo se admiten imágenes JPG, PNG o WebP de contenido válido.');
  } finally {
    await file.close();
  }
}

async function rejectAnimatedPng(filename) {
  // El lector PNG de libvips puede mostrar solo el primer fotograma de APNG y
  // omitir metadata.pages. acTL identifica la animación sin descomprimirla.
  const file = await open(filename, 'r');
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(8);
    let position = 8; // Firma PNG ya verificada.
    while (position + 12 <= size) {
      const { bytesRead } = await file.read(header, 0, 8, position);
      const length = header.readUInt32BE(0);
      if (bytesRead !== 8 || length > size - position - 12) {
        throw new AppError(400, 'INVALID_IMAGE', 'La estructura PNG está incompleta.');
      }
      const type = header.toString('ascii', 4, 8);
      if (type === 'acTL') {
        throw new AppError(415, 'ANIMATED_IMAGE_NOT_SUPPORTED', 'Solo se admiten imágenes estáticas; este PNG contiene animación.');
      }
      if (type === 'IEND') return;
      position += length + 12;
    }
    throw new AppError(400, 'INVALID_IMAGE', 'La estructura PNG está incompleta.');
  } finally {
    await file.close();
  }
}

export async function prepareImage(file, storageRoot) {
  if (!file || !file.path) throw new AppError(400, 'UPLOAD_REQUIRED', 'Selecciona una imagen en el campo file.');
  if (file.size === 0) throw new AppError(400, 'EMPTY_FILE', 'La imagen está vacía.');
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
  const detected = await signatureFormat(file.path);
  if (detected === 'png') await rejectAnimatedPng(file.path);
  const hash = createHash('sha256');
  let originalSize = 0n;
  for await (const chunk of createReadStream(file.path)) {
    hash.update(chunk);
    originalSize += BigInt(chunk.length);
  }
  if (originalSize === 0n) throw new AppError(400, 'EMPTY_FILE', 'La imagen está vacía.');
  if (originalSize > BigInt(MAX_UPLOAD_BYTES)) throw new AppError(413, 'FILE_TOO_LARGE', 'La imagen supera el máximo de 25 MB.');
  const temporaryDirectory = path.join(storageRoot, '.tmp');
  await mkdir(temporaryDirectory, { recursive: true });
  const optimizedPath = path.join(temporaryDirectory, `${randomUUID()}.webp.tmp`);
  try {
    const image = sharp(file.path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning', animated: true });
    const metadata = await image.metadata();
    if (metadata.format !== detected || !metadata.width || !metadata.height) {
      throw new AppError(400, 'INVALID_IMAGE', 'No se pudo interpretar el contenido de la imagen.');
    }
    if ((metadata.pages || 1) > 1) {
      throw new AppError(415, 'ANIMATED_IMAGE_NOT_SUPPORTED', 'Solo se admiten imágenes estáticas; esta imagen contiene animación.');
    }
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      throw new AppError(413, 'IMAGE_DIMENSIONS_EXCEEDED', 'La imagen supera el límite de 40 millones de píxeles.');
    }
    // Aplica EXIF sin redimensionar. Sharp elimina metadatos por defecto.
    await image.rotate().webp({ quality: 80 }).toFile(optimizedPath);
    return { hash: hash.digest('hex'), originalSizeBytes: originalSize.toString(), optimizedPath };
  } catch (error) {
    await removeTemporary(optimizedPath);
    if (error instanceof AppError) throw error;
    if (/pixel limit/i.test(error.message || '')) {
      throw new AppError(413, 'IMAGE_DIMENSIONS_EXCEEDED', 'La imagen supera el límite de 40 millones de píxeles.');
    }
    if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(error.code)) {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No se pudo escribir la imagen en el almacenamiento local.');
    }
    throw new AppError(400, 'INVALID_IMAGE', 'La imagen está dañada, incompleta o no se puede decodificar.');
  }
}

export async function publishImage(optimizedPath, storageRoot, hash) {
  const storageKey = storageKeyFor(hash);
  const filename = path.join(storageRoot, ...storageKey.split('/'));
  try {
    await mkdir(path.dirname(filename), { recursive: true });
    // Mismo filesystem y bloqueo de hash. Un destino sin fila es un huérfano.
    await rename(optimizedPath, filename);
  } catch {
    throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No se pudo guardar la imagen en el almacenamiento local.');
  }
  return { filename, storageKey };
}
