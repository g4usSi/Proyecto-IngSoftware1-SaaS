import { unlink } from 'node:fs/promises';
import { AppError } from '../lib/app-error.js';
import { createQuotasRepository } from '../modules/quotas/quotas.repository.js';
import { createStorageRepository } from '../modules/storage/storage.repository.js';
import { inspectStoredFile, objectPath, publishImage } from '../modules/storage/storage.files.js';
import { createImageJobs } from './image-jobs.js';

export function createImageLifecycle({ database, storageRoot }) {
  const quotas = createQuotasRepository(database);
  const storage = createStorageRepository(database);
  return {
    async reserve(client, payload) {
      await quotas.reserve(client, { reservationKey: payload.jobId, userId: payload.userId, bytes: payload.originalSizeBytes });
      await storage.assertFolderOwner(client, payload.userId, payload.folderId);
    },
    async confirm(client, payload) {
      await quotas.lockUser(client, payload.userId);
      const reservation = await quotas.getReservation(client, payload.jobId, payload.userId);
      if (reservation.status === 'confirmed') {
        if (!reservation.image_id) throw new AppError(409, 'RESERVATION_CONFLICT', 'La reserva confirmada no tiene una imagen publicada.');
        return { imageId: reservation.image_id };
      }
      if (reservation.status !== 'pending' || reservation.reserved_bytes !== payload.originalSizeBytes) {
        throw new AppError(409, 'RESERVATION_CONFLICT', 'La reserva no coincide con el trabajo.');
      }
      await storage.lockObject(client, payload.originalHash);
      await storage.assertFolderOwner(client, payload.userId, payload.folderId);
      let object = await storage.findObject(client, payload.originalHash);
      if (object && (object.status !== 'ready' || object.original_size_bytes !== payload.originalSizeBytes)) {
        throw new AppError(503, 'STORAGE_INTEGRITY_ERROR', 'Los metadatos del objeto son inconsistentes.');
      }
      let needsPublication = !object;
      if (object) {
        try { await inspectStoredFile(storageRoot, object); }
        catch (error) { if (error.code !== 'STORAGE_INTEGRITY_ERROR') throw error; needsPublication = true; }
      }
      if (needsPublication) {
        const published = await publishImage(payload.resultPath, storageRoot, payload.originalHash, { preserveSource: true });
        if (!object) {
          await storage.insertObject(client, { hash: payload.originalHash, originalSizeBytes: payload.originalSizeBytes, storageKey: published.storageKey });
          object = { hash_sha256: payload.originalHash, storage_key: published.storageKey };
        }
      }
      await inspectStoredFile(storageRoot, object);
      const image = await storage.insertImage(client, { ownerId: payload.userId, hash: payload.originalHash,
        originalName: payload.originalName, folderId: payload.folderId });
      await quotas.confirm(client, payload.jobId, payload.userId, image.id);
      return { imageId: image.id };
    },
    async release(client, payload) {
      await quotas.release(client, payload.jobId, payload.userId);
      await storage.lockObject(client, payload.originalHash);
      // Un rollback de publicación puede dejar un archivo recuperable sin fila.
      // Sólo retirarlo al liberar, con el hash bloqueado y sin objeto.
      if (!await storage.findObject(client, payload.originalHash)) {
        const filename = objectPath(storageRoot, { hash_sha256: payload.originalHash,
          storage_key: `${payload.originalHash.slice(0, 2)}/${payload.originalHash}.webp` });
        try { await unlink(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
  };
}

export function createManagedImageJobs(options) {
  return createImageJobs({ ...options, lifecycle: createImageLifecycle(options) });
}
