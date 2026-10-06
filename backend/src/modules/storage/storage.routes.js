import { Router } from 'express';
import { database as defaultDatabase } from '../../config/database.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { createStorageService } from './storage.service.js';
import { createStorageController } from './storage.controller.js';
import { createUploadMiddleware } from './storage.upload.js';
import { requireStorageAdmin, requireStorageIdentity } from './storage.validation.js';

function privateResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  next();
}

export function createStorageRouter({ database = defaultDatabase, storageRoot = env.storageRoot, authenticate = requireAuth } = {}) {
  const router = Router();
  const controller = createStorageController(createStorageService({ database, storageRoot }));
  router.use(privateResponse, authenticate, requireStorageIdentity);
  router.get('/', controller.list);
  router.post('/', createUploadMiddleware(storageRoot), controller.upload);
  router.get('/:fileId/download', controller.download);
  router.delete('/:fileId', controller.remove);
  return router;
}

export function createStorageAdminRouter({ database = defaultDatabase, storageRoot = env.storageRoot, authenticate = requireAuth } = {}) {
  const router = Router();
  const controller = createStorageController(createStorageService({ database, storageRoot }));
  router.use(privateResponse, authenticate, requireStorageIdentity, requireStorageAdmin);
  router.get('/stats', controller.stats);
  return router;
}
