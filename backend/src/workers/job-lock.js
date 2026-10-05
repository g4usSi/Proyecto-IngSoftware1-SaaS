import { normalizeJobId } from './image-job-files.js';

// Todos los productores, consumidores, publicadores y limpiadores comparten esto.
export async function withJobLock(database, id, operation, { tryOnly = false } = {}) {
  id = normalizeJobId(id);
  const client = await database.connect();
  const key = `smartstorage:conversion:${id}`;
  let acquired = false;
  let broken;
  const onError = (error) => { broken = error; };
  client.on?.('error', onError);
  try {
    if (tryOnly) {
      const { rows: [row] } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [key]);
      if (!row.acquired) return { skipped: true };
    } else await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
    acquired = true;
    return await operation(client);
  } finally {
    try {
      if (acquired && !broken) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
    } catch (error) { broken = error; }
    client.removeListener?.('error', onError);
    client.release(broken);
  }
}

export async function transaction(client, operation) {
  await client.query('BEGIN');
  try {
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
