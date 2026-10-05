import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createImageJobs } from '../../src/workers/image-jobs.js';
export async function fixture(t, serviceOptions = {}) {
  const schema = `worker_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  let database;
  let storageRoot;
  t.after(async () => {
    await database?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    if (storageRoot) {
      assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
      assert.match(path.basename(storageRoot), /^smartstorage-worker-[\w-]+$/);
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  database = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 6 });
  const migrationDir = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(migrationDir)).filter((f) => /^\d+[-_].*\.sql$/.test(f)).sort()) {
    await database.query(await readFile(new URL(file, migrationDir), 'utf8'));
  }
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-worker-'));
  const users = [];
  for (const name of ['A', 'B']) {
    users.push((await database.query("INSERT INTO users (name, email, password_hash) VALUES ($1, $2, '!test') RETURNING id", [name, `${name.toLowerCase()}@worker.test`])).rows[0].id);
  }
  const jobs = createImageJobs({ database, storageRoot, ...serviceOptions });
  async function stage(buffer, ownerId = users[0]) {
    const file = path.join(storageRoot, `${randomUUID()}.png`);
    await writeFile(file, buffer);
    return jobs.stage({ ownerId, file: { path: file, originalname: 'prueba.png' } });
  }
  return { database, storageRoot, users, jobs, stage, schema };
}
