import { database } from '../config/database.js';
import { env } from '../config/env.js';
import { createManagedImageJobs } from './image-lifecycle.js';
import { createImageQueue, readWorkerConfig } from './image-queue.js';
import { createImageRecovery } from './image-recovery.js';

let queue;
try {
  queue = createImageQueue(readWorkerConfig());
  await queue.waitUntilReady();
  const jobs = createManagedImageJobs({ database, storageRoot: env.storageRoot });
  const summary = await createImageRecovery({ database, storageRoot: env.storageRoot, jobs, queue }).runOnce();
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
} catch {
  console.error('No se pudo completar la recuperación. Comprobar migraciones, PostgreSQL, Redis y almacenamiento.');
  process.exitCode = 1;
} finally {
  try { await queue?.close(); } finally { await database.close(); }
}
