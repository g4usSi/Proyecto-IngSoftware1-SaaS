import { Router } from 'express';
import { database as defaultDatabase } from '../../config/database.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { createStorageService } from './storage.service.js';
import { createAlbumsService } from './albums.service.js';
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
  router.patch('/:fileId', controller.move);
  router.post('/:fileId/trash', controller.trash);
  router.post('/:fileId/restore', controller.restore);
  router.delete('/:fileId', controller.remove);
  return router;
}

export function createAlbumsRouter({ database = defaultDatabase, authenticate = requireAuth } = {}) {
  const router = Router();
  const albums = createAlbumsService({ database });
  router.use(privateResponse, authenticate, requireStorageIdentity);
  router.get('/', async (req, res) => { res.json({ data: await albums.list(req.user.id) }); });
  router.post('/', async (req, res) => { res.status(201).json({ data: await albums.create(req.user.id, req.body) }); });
  router.patch('/:albumId', async (req, res) => { res.json({ data: await albums.rename(req.user.id, req.params.albumId, req.body) }); });
  router.delete('/:albumId', async (req, res) => { res.json({ data: await albums.remove(req.user.id, req.params.albumId) }); });
  return router;
}

export function createStorageAdminRouter({ database = defaultDatabase, storageRoot = env.storageRoot, authenticate = requireAuth } = {}) {
  const router = Router();
  const controller = createStorageController(createStorageService({ database, storageRoot }));
  router.use(privateResponse, authenticate, requireStorageIdentity, requireStorageAdmin);
  router.get('/stats', controller.stats);
  return router;
}
