// Proceso real que el padre mata en un punto determinista. Nunca se usa en runtime.
import pg from 'pg';
import { createImageJobs } from '../../src/workers/image-jobs.js';
import { prepareImage } from '../../src/modules/storage/storage.files.js';
import { createImageWorker, readWorkerConfig } from '../../src/workers/image-queue.js';

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${process.env.TEST_SCHEMA},public` });
const checkpoint = async () => { process.send({ phase: 'checkpoint' }); await new Promise(() => {}); };
const database = {
  query: (...args) => pool.query(...args),
  async connect() {
    const client = await pool.connect();
    const query = client.query.bind(client);
    client.query = async (...args) => {
      if (process.env.CRASH_PHASE === 'result' && /SET status = 'converted'/.test(args[0])) await checkpoint();
      return query(...args);
    };
    return client;
  },
};
const jobs = createImageJobs({ database, storageRoot: process.env.TEST_STORAGE_ROOT,
  convert: async (...args) => { if (process.env.CRASH_PHASE === 'processing') await checkpoint(); return prepareImage(...args); } });
createImageWorker({ ...readWorkerConfig({ REDIS_URL: process.env.TEST_REDIS_URL }), name: process.env.TEST_QUEUE,
  jobs, lockDuration: 1000, stalledInterval: 1000 });
