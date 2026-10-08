import assert from 'node:assert/strict';
import pg from 'pg';
import { createManagedImageJobs } from '../../src/workers/image-lifecycle.js';
import { createImageWorker, readWorkerConfig } from '../../src/workers/image-queue.js';

assert.match(process.env.TEST_SCHEMA, /^worker_test_[a-f0-9]{32}$/);
assert.ok(process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL && process.send);
assert.ok(['beforeCommit', 'afterCommit'].includes(process.env.CRASH_PHASE));
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${process.env.TEST_SCHEMA},public`, max: 6 });
const database = {
  query: (...args) => pool.query(...args),
  async connect() {
    const client = await pool.connect();
    const original = client.query.bind(client);
    let publishing = false;
    client.query = async (sql, ...args) => {
      if (sql.includes("SET status = 'published'")) publishing = true;
      if (publishing && sql === 'COMMIT') {
        if (process.env.CRASH_PHASE === 'afterCommit') await original(sql, ...args);
        process.send({ phase: 'checkpoint' });
        await new Promise(() => {});
      }
      return original(sql, ...args);
    };
    return client;
  },
};
const jobs = createManagedImageJobs({ database, storageRoot: process.env.TEST_STORAGE_ROOT });
const config = readWorkerConfig({ REDIS_URL: process.env.TEST_REDIS_URL });
const worker = createImageWorker({ ...config, name: process.env.TEST_QUEUE, jobs, lockDuration: 1000, stalledInterval: 1000 });
await worker.waitUntilReady();
