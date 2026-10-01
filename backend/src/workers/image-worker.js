import { database } from '../config/database.js';
import { env } from '../config/env.js';
import { createImageJobs } from './image-jobs.js';
import { createImageWorker, readWorkerConfig } from './image-queue.js';

const config = readWorkerConfig();
let worker;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await worker?.close(); }
  finally { await database.close(); }
}
try {
  // Fallar antes de consumir si falta la migración, sin imprimir credenciales.
  await database.query('SELECT id FROM image_processing_jobs LIMIT 0');
  worker = createImageWorker({ ...config, jobs: createImageJobs({ database, storageRoot: env.storageRoot }),
    onError: () => console.error('El worker perdió la conexión con Redis; comprobar el servicio.') });
  process.once('SIGINT', () => { close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { close().catch(() => { process.exitCode = 1; }); });
  await worker.waitUntilReady();
  console.log('Worker de conversión listo. La publicación y las cuotas asíncronas siguen pendientes de S3-08.');
} catch {
  console.error('No se pudo iniciar el worker. Comprueba PostgreSQL, migraciones y Redis.');
  process.exitCode = 1;
  await close();
}
