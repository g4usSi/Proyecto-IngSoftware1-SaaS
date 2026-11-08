import { open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/app-error.js';
import { createQuotasRepository } from '../quotas/quotas.repository.js';
import { createStorageCleanup } from './storage.cleanup.js';
import { createStorageRepository } from './storage.repository.js';
import { ORIGINAL_FORMATS, convertStoredImage, inspectStoredFile, prepareImage, publishImage, removeTemporary } from './storage.files.js';
import { cursorFor, parseDownloadFormat, parseImageMove, parseLibraryQuery, parseUploadFields, safeOriginalName, validateImageId } from './storage.validation.js';

const DUPLICATE_ITEMS = 20;

function imageDto(row, optimizedBytes) {
  return {
    id: row.id,
    originalName: row.original_name,
    createdAt: new Date(row.created_at).toISOString(),
    folderId: row.folder_id ?? null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    status: 'ready',
    originalSizeBytes: String(row.original_size_bytes),
    optimizedSizeBytes: optimizedBytes.toString(),
    // RF-STO-10/11: huella corta (nunca el hash completo), formato publicado y duplicado dentro de la misma cuenta.
    hashPrefix: row.hash_sha256.slice(0, 12),
    optimizedFormat: 'webp',
    originalFormat: row.original_format ?? null,
    folderName: row.folder_name ?? null,
    duplicate: Boolean(row.has_duplicate),
  };
}

function percentage(saved, original) {
  if (original === 0n) return '0.00';
  const absolute = saved < 0n ? -saved : saved;
  const scaled = (absolute * 10_000n + original / 2n) / original;
  return `${saved < 0n && scaled !== 0n ? '-' : ''}${scaled / 100n}.${String(scaled % 100n).padStart(2, '0')}`;
}

export function createStorageService({ database, storageRoot }) {
  const repository = createStorageRepository(database);
  const quotas = createQuotasRepository(database);
  const cleanup = createStorageCleanup({ database, storageRoot });

  async function cleanUncommittedObject(hash, filename) {
    // Puede ejecutarse después de un COMMIT cuya respuesta se perdió. Volver
    // a bloquear y consultar evita borrar un archivo confirmado o reutilizado.
    try {
      await repository.withObjectLock(hash, async (connection) => {
        if (await repository.findObject(connection, hash)) return;
        try {
          await unlink(filename);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      });
    } catch {
      console.error('Storage conservó un posible objeto huérfano porque no pudo verificar sus referencias.');
    }
  }

  return {
    async uploadFile(ownerId, file, body) {
      let prepared;
      let published;
      try {
        const { folderId } = parseUploadFields(body);
        prepared = await prepareImage(file, storageRoot);
        const originalName = safeOriginalName(file.originalname);
        return await repository.withUploadTransaction(ownerId, prepared.hash, async (connection) => {
          await repository.assertFolderOwner(connection, ownerId, folderId);
          const reservationKey = randomUUID();
          await quotas.reserve(connection, { userId: ownerId, reservationKey, bytes: prepared.originalSizeBytes });
          let object = await repository.findObject(connection, prepared.hash);
          if (object) {
            if (object.status !== 'ready') {
              throw new AppError(409, 'STORAGE_OBJECT_NOT_READY', 'El contenido todavía no está disponible; vuelve a intentar la subida.');
            }
            if (BigInt(object.original_size_bytes) !== BigInt(prepared.originalSizeBytes)) {
              throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'Los metadatos del contenido almacenado son inconsistentes.');
            }
            await repository.noteObjectFormat(connection, prepared.hash, prepared.originalFormat);
          } else {
            published = await publishImage(prepared.optimizedPath, storageRoot, prepared.hash);
            object = {
              hash_sha256: prepared.hash,
              original_size_bytes: prepared.originalSizeBytes,
              storage_key: published.storageKey,
              status: 'ready',
            };
            await repository.insertObject(connection, {
              hash: prepared.hash,
              originalSizeBytes: prepared.originalSizeBytes,
              storageKey: published.storageKey,
              originalFormat: prepared.originalFormat,
            });
          }
          const stored = await inspectStoredFile(storageRoot, object);
          const image = await repository.insertImage(connection, { ownerId, hash: prepared.hash, originalName, folderId });
          await quotas.confirm(connection, reservationKey, ownerId, image.id);
          return { image: imageDto(image, stored.size) };
        });
      } catch (error) {
        if (published) await cleanUncommittedObject(prepared.hash, published.filename);
        throw error;
      } finally {
        await removeTemporary(file?.path);
        await removeTemporary(prepared?.optimizedPath);
      }
    },
    async listFiles(ownerId, query) {
      const pagination = parseLibraryQuery(query);
      const rows = await repository.listImages(ownerId, pagination);
      const more = rows.length > pagination.limit;
      const page = rows.slice(0, pagination.limit);
      const items = [];
      const unavailableItems = [];
      for (const row of page) {
        try {
          const stored = await inspectStoredFile(storageRoot, row);
          items.push(imageDto(row, stored.size));
        } catch (error) {
          if (error.code !== 'STORAGE_INTEGRITY_ERROR') throw error;
          // Conservar el registro y la paginación sin bloquear los archivos sanos.
          unavailableItems.push({
            id: row.id, originalName: row.original_name,
            createdAt: new Date(row.created_at).toISOString(),
            folderId: row.folder_id ?? null,
            deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
            originalSizeBytes: String(row.original_size_bytes),
            status: 'unavailable', errorCode: 'STORAGE_INTEGRITY_ERROR',
          });
        }
      }
      return { items, unavailableItems, nextCursor: more ? cursorFor(page.at(-1)) : null };
    },
    async moveFile(ownerId, imageId, body) {
      validateImageId(imageId);
      const { folderId } = parseImageMove(body);
      return repository.withImageTransaction(ownerId, imageId, async (connection, image) => {
        if (image.deleted_at) throw new AppError(409, 'FILE_IN_TRASH', 'Restaura la imagen antes de cambiar su álbum.');
        await repository.assertFolderOwner(connection, ownerId, folderId);
        await repository.setImageFolder(connection, ownerId, imageId, folderId);
        return { imageId, folderId };
      });
    },
    async trashFile(ownerId, imageId) {
      validateImageId(imageId);
      return repository.withImageTransaction(ownerId, imageId, async (connection) => {
        const deletedAt = await repository.trashImage(connection, ownerId, imageId);
        return { trashed: true, imageId, deletedAt: new Date(deletedAt).toISOString() };
      });
    },
    async restoreFile(ownerId, imageId) {
      validateImageId(imageId);
      return repository.withImageTransaction(ownerId, imageId, async (connection) => {
        await repository.restoreImage(connection, ownerId, imageId);
        return { restored: true, imageId };
      });
    },
    async downloadFile(ownerId, imageId, query = {}) {
      validateImageId(imageId);
      const format = parseDownloadFormat(query);
      const row = await repository.findImage(ownerId, imageId);
      if (!row) {
        throw new AppError(404, 'FILE_NOT_FOUND', 'La imagen no existe o no está disponible para esta cuenta.');
      }
      const stored = await inspectStoredFile(storageRoot, row);
      const target = format === 'original' ? ORIGINAL_FORMATS[row.original_format] : null;
      if (format === 'original' && !target && row.original_format !== 'webp') {
        throw new AppError(409, 'ORIGINAL_FORMAT_UNKNOWN',
          'Esta imagen se subió antes de registrar su formato original; descárgala en WebP.');
      }
      if (target) {
        let buffer;
        try {
          buffer = await convertStoredImage(stored.filename, row.original_format);
        } catch {
          throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'No se pudo convertir el archivo de esta imagen.');
        }
        const baseName = safeOriginalName(row.original_name).replace(/\.[^.]*$/, '') || 'imagen';
        return { buffer, size: String(buffer.length), contentType: target.contentType,
          filename: `${baseName}.${target.extension}` };
      }
      let handle;
      try {
        handle = await open(stored.filename, 'r');
        const info = await handle.stat({ bigint: true });
        if (!info.isFile() || info.size === 0n) throw new Error('Invalid object');
        const baseName = safeOriginalName(row.original_name).replace(/\.[^.]*$/, '') || 'imagen';
        return { handle, size: info.size.toString(), contentType: 'image/webp', filename: `${baseName}.webp` };
      } catch {
        await handle?.close().catch(() => {});
        throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'No se pudo abrir el archivo de esta imagen.');
      }
    },
    // RF-STO-12 / RF-PAG-04: espacio lógico de la cuenta frente al físico real y ahorro acumulado.
    // Lógico = originales de todas sus referencias (incluida la papelera, como en la cuota).
    // Físico = WebP de cada objeto distinto, una sola vez aunque la cuenta lo repita.
    async summary(ownerId) {
      const objects = await repository.ownerObjects(ownerId);
      let logical = 0n;
      let physical = 0n;
      let images = 0n;
      let trash = 0n;
      let duplicates = 0n;
      let unavailable = 0n;
      for (const object of objects) {
        const active = BigInt(object.active_references);
        const trashed = BigInt(object.trash_references);
        const references = active + trashed;
        images += active;
        trash += trashed;
        logical += BigInt(object.original_size_bytes) * references;
        duplicates += references - 1n;
        try {
          physical += (await inspectStoredFile(storageRoot, object)).size;
        } catch (error) {
          if (error.code !== 'STORAGE_INTEGRITY_ERROR') throw error;
          unavailable += 1n;
        }
      }
      const saved = logical - physical;
      return {
        logicalBytes: logical.toString(),
        physicalBytes: physical.toString(),
        savedBytes: saved.toString(),
        savedPercent: unavailable > 0n ? null : percentage(saved, logical),
        imageCount: images.toString(),
        trashCount: trash.toString(),
        uniqueObjectCount: String(objects.length),
        duplicateCount: duplicates.toString(),
        unavailableObjectCount: unavailable.toString(),
      };
    },
    async stats() {
      const objects = await repository.referencedObjects();
      let original = 0n;
      let uniqueOriginal = 0n;
      let optimized = 0n;
      let imageCount = 0n;
      // Contenido repetido: solo contadores y tamaños. Nunca hash, nombres, miniaturas ni cuentas,
      // para que el administrador no vea imágenes privadas de nadie.
      const repeated = [];
      for (const object of objects) {
        const references = BigInt(object.reference_count);
        const size = BigInt(object.original_size_bytes);
        const stored = await inspectStoredFile(storageRoot, object);
        original += size * references;
        uniqueOriginal += size;
        optimized += stored.size;
        imageCount += references;
        if (references > 1n) {
          repeated.push({ references, accounts: object.account_count, originalSizeBytes: size, optimizedSizeBytes: stored.size,
            avoidedBytes: stored.size * (references - 1n) });
        }
      }
      repeated.sort((a, b) => (b.avoidedBytes > a.avoidedBytes ? 1 : b.avoidedBytes < a.avoidedBytes ? -1 : Number(b.references - a.references)));
      const saved = original - optimized;
      return {
        originalSizeBytes: original.toString(),
        uniqueOriginalSizeBytes: uniqueOriginal.toString(),
        optimizedSizeBytes: optimized.toString(),
        savedBytes: saved.toString(),
        savedPercent: percentage(saved, original),
        imageCount: imageCount.toString(),
        objectCount: String(objects.length),
        duplicates: {
          objectCount: String(repeated.length),
          extraReferenceCount: repeated.reduce((sum, item) => sum + item.references - 1n, 0n).toString(),
          avoidedBytes: repeated.reduce((sum, item) => sum + item.avoidedBytes, 0n).toString(),
          items: repeated.slice(0, DUPLICATE_ITEMS).map((item) => ({
            references: item.references.toString(),
            accounts: String(item.accounts),
            originalSizeBytes: item.originalSizeBytes.toString(),
            optimizedSizeBytes: item.optimizedSizeBytes.toString(),
            avoidedBytes: item.avoidedBytes.toString(),
          })),
        },
      };
    },
    async deleteFile(ownerId, imageId) {
      validateImageId(imageId);
      let object;
      const result = await repository.withImageTransaction(ownerId, imageId, async (connection, image) => {
        object = image;
        await repository.deleteImageReference(connection, ownerId, imageId, image);
        return { deleted: true, imageId };
      });
      // Releer después de COMMIT bajo bloqueo evita borrar un objeto adoptado
      // por una subida concurrente; el historial de cuota conserva la reserva.
      try { await cleanup.remove(object.hash_sha256); }
      catch { console.error('Borrado confirmado; limpieza física pendiente de recuperación.'); }
      return result;
    },
  };
}
