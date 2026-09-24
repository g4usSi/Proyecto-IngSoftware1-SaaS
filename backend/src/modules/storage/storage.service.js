import { open, unlink } from 'node:fs/promises';
import { AppError, notImplemented } from '../../lib/app-error.js';
import { createStorageRepository } from './storage.repository.js';
import { inspectStoredFile, prepareImage, publishImage, removeTemporary } from './storage.files.js';
import { cursorFor, parsePagination, parseUploadFields, safeOriginalName, validateImageId } from './storage.validation.js';

function imageDto(row, optimizedBytes) {
  return {
    id: row.id,
    originalName: row.original_name,
    createdAt: new Date(row.created_at).toISOString(),
    status: 'ready',
    originalSizeBytes: String(row.original_size_bytes),
    optimizedSizeBytes: optimizedBytes.toString(),
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
          await repository.assertUploadQuota(connection, ownerId, prepared.originalSizeBytes);
          let object = await repository.findObject(connection, prepared.hash);
          if (object) {
            if (object.status !== 'ready') {
              throw new AppError(409, 'STORAGE_OBJECT_NOT_READY', 'El contenido todavía no está disponible; vuelve a intentar la subida.');
            }
            if (BigInt(object.original_size_bytes) !== BigInt(prepared.originalSizeBytes)) {
              throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'Los metadatos del contenido almacenado son inconsistentes.');
            }
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
            });
          }
          const stored = await inspectStoredFile(storageRoot, object);
          const image = await repository.insertImage(connection, { ownerId, hash: prepared.hash, originalName, folderId });
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
      const pagination = parsePagination(query);
      const rows = await repository.listImages(ownerId, pagination);
      const more = rows.length > pagination.limit;
      const page = rows.slice(0, pagination.limit);
      const items = [];
      for (const row of page) {
        const stored = await inspectStoredFile(storageRoot, row);
        items.push(imageDto(row, stored.size));
      }
      return { items, nextCursor: more ? cursorFor(page.at(-1)) : null };
    },
    async downloadFile(ownerId, imageId) {
      validateImageId(imageId);
      const row = await repository.findImage(ownerId, imageId);
      if (!row) {
        throw new AppError(404, 'FILE_NOT_FOUND', 'La imagen no existe o no está disponible para esta cuenta.');
      }
      const stored = await inspectStoredFile(storageRoot, row);
      let handle;
      try {
        handle = await open(stored.filename, 'r');
        const info = await handle.stat({ bigint: true });
        if (!info.isFile() || info.size === 0n) throw new Error('Invalid object');
        const baseName = safeOriginalName(row.original_name).replace(/\.[^.]*$/, '') || 'imagen';
        return { handle, size: info.size.toString(), filename: `${baseName}.webp` };
      } catch {
        await handle?.close().catch(() => {});
        throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'No se pudo abrir el archivo de esta imagen.');
      }
    },
    async stats() {
      const objects = await repository.referencedObjects();
      let original = 0n;
      let uniqueOriginal = 0n;
      let optimized = 0n;
      let imageCount = 0n;
      for (const object of objects) {
        const references = BigInt(object.reference_count);
        const size = BigInt(object.original_size_bytes);
        const stored = await inspectStoredFile(storageRoot, object);
        original += size * references;
        uniqueOriginal += size;
        optimized += stored.size;
        imageCount += references;
      }
      const saved = original - optimized;
      return {
        originalSizeBytes: original.toString(),
        uniqueOriginalSizeBytes: uniqueOriginal.toString(),
        optimizedSizeBytes: optimized.toString(),
        savedBytes: saved.toString(),
        savedPercent: percentage(saved, original),
        imageCount: imageCount.toString(),
        objectCount: String(objects.length),
      };
    },
    async deleteFile() {
      return notImplemented('STORAGE_DELETE_NOT_IMPLEMENTED', 'El borrado de imágenes todavía no está implementado.');
    },
  };
}
