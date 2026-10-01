import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { AppError } from '../lib/app-error.js';
import { normalizeJobId } from './image-jobs.js';

export const IMAGE_QUEUE = 'smartstorage-image-conversion';
export const IMAGE_JOB_OPTIONS = Object.freeze({ attempts: 3, backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } });

export function readWorkerConfig(source = process.env) {
  let url;
  try { url = new URL(source.REDIS_URL || 'redis://127.0.0.1:6379/0'); }
  catch { throw new Error('REDIS_URL debe ser una URL Redis válida.'); }
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.search || url.hash || !/^\/(\d+)?$/.test(url.pathname || '/')) {
    throw new Error('REDIS_URL debe usar redis:// o rediss:// y una base numérica.');
  }
  const concurrency = Number(source.IMAGE_WORKER_CONCURRENCY || 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('IMAGE_WORKER_CONCURRENCY debe estar entre 1 y 8.');
  const connection = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
  if (connection.port < 1 || connection.port > 65535 || !Number.isSafeInteger(connection.db)) throw new Error('Puerto o base Redis inválidos.');
  return { connection, concurrency };
}

export function createImageQueue({ connection, name = IMAGE_QUEUE, onError = () => {} }) {
  const queue = new Queue(name, { connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    defaultJobOptions: IMAGE_JOB_OPTIONS });
  queue.on('error', onError);
  return queue;
}

export async function enqueueImageJob(queue, id) {
  id = normalizeJobId(id);
  // Redis recibe solo un ID; usuario, nombres y archivos permanecen en PostgreSQL/disco.
  return queue.add('convert', { id }, { jobId: id });
}

export function createImageWorker({ jobs, connection, concurrency = 2, name = IMAGE_QUEUE, onError = () => {} }) {
  const worker = new Worker(name, async (job) => {
    if (job.name !== 'convert' || job.data?.id !== job.id) throw new UnrecoverableError('INVALID_JOB');
    try {
      return await jobs.process(job.id, { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts || 1) });
    } catch (error) {
      if (error instanceof AppError && error.status < 500) throw new UnrecoverableError(error.code);
      // No persistir mensajes de conexión, SQL o rutas privadas en Redis.
      throw new Error('PROCESSING_UNAVAILABLE');
    }
  }, { connection: { ...connection, maxRetriesPerRequest: null }, concurrency });
  worker.on('error', onError);
  return worker;
}
