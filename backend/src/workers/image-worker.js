import { database } from '../config/database.js';
import { env } from '../config/env.js';
import { createImageJobs } from './image-jobs.js';
import { createImageQueue, createImageWorker, readWorkerConfig } from './image-queue.js';
import { createImageRecovery, startRecoveryLoop } from './image-recovery.js';

const config = readWorkerConfig();
let worker;
let queue;
let recoveryLoop;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    await recoveryLoop?.close();
    await worker?.close();
  } finally {
    try { await queue?.close(); }
    finally { await database.close(); }
  }
}
try {
  // Fallar antes de consumir si falta la migración, sin imprimir credenciales.
  await database.query('SELECT expires_at, quota_managed FROM image_processing_jobs LIMIT 0');
  const jobs = createImageJobs({ database, storageRoot: env.storageRoot });
  queue = createImageQueue(config);
  worker = createImageWorker({ ...config, jobs,
    onError: () => console.error('El worker perdió la conexión con Redis; comprobar el servicio.') });
  process.once('SIGINT', () => { close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { close().catch(() => { process.exitCode = 1; }); });
  await worker.waitUntilReady();
  recoveryLoop = startRecoveryLoop(createImageRecovery({ database, storageRoot: env.storageRoot, jobs, queue }),
    { onError: () => console.error('Recuperación pendiente: comprobar PostgreSQL, Redis y permisos de temporales.') });
  console.log('Worker y recuperación S3-05 listos. Publicación y cuotas reales requieren el adaptador S3-08/S3-11.');
} catch {
  console.error('No se pudo iniciar el worker. Comprueba PostgreSQL, migraciones y Redis.');
  process.exitCode = 1;
  await close();
}
