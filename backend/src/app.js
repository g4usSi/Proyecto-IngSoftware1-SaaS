import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { database as defaultDatabase } from './config/database.js';
import { AppError } from './lib/app-error.js';
import { notFound, errorHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createStorageRouter, createStorageAdminRouter } from './modules/storage/storage.routes.js';
import { createStorageDemo } from './dev/storage-demo.js';
import { createSubscriptionsRouter } from './modules/subscriptions/subscriptions.routes.js';

export function createApp({
  database = defaultDatabase, corsOrigins = env.corsOrigins,
  storageRoot = env.storageRoot, storageDemo = env.storageDemo, storageAuthenticate,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'El origen de la solicitud no está autorizado.'));
    },
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ data: { status: 'ok', service: 'smartstorage-api' } });
  });

  app.get('/api/ready', async (_req, res) => {
    try {
      await database.query('SELECT 1');
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'PostgreSQL no está disponible o DATABASE_URL no está configurada.');
    }
    res.json({ data: { status: 'ready', database: 'connected' } });
  });

  app.use('/api/auth', createAuthRouter());
  const demo = createStorageDemo({ database, enabled: storageDemo });
  const storageOptions = { database, storageRoot, authenticate: storageAuthenticate || demo.authenticate };
  app.use('/api/dev', demo.router);
  app.use('/api/files', createStorageRouter(storageOptions));
  app.use('/api/admin/storage', createStorageAdminRouter(storageOptions));
  app.use('/api', createSubscriptionsRouter(database));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
