import { unlink } from 'node:fs/promises';
import { objectPath } from './storage.files.js';
import { createStorageRepository } from './storage.repository.js';

export function createStorageCleanup({ database, storageRoot }) {
  const repository = createStorageRepository(database);
  async function remove(hash) {
    return repository.withObjectLock(hash, async (client) => {
      const { rows: [task] } = await client.query('SELECT * FROM storage_cleanup_tasks WHERE hash_sha256=$1', [hash]);
      if (!task) return false;
      if (!await repository.findObject(client, hash)) {
        try { await unlink(objectPath(storageRoot, task)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      // Si otra subida adoptó el hash, su objeto se conserva y la tarea termina.
      await client.query('DELETE FROM storage_cleanup_tasks WHERE hash_sha256=$1', [hash]);
      return true;
    });
  }
  return {
    remove,
    async runOnce() {
      let cursor = '';
      let removed = 0;
      let errors = 0;
      for (;;) {
        const { rows } = await database.query(`SELECT hash_sha256 FROM storage_cleanup_tasks
          WHERE hash_sha256 > $1 ORDER BY hash_sha256 LIMIT 100`, [cursor]);
        if (!rows.length) break;
        for (const row of rows) {
          try { if (await remove(row.hash_sha256)) removed++; }
          catch { errors++; }
        }
        cursor = rows.at(-1).hash_sha256;
      }
      return { removed, errors };
    },
  };
}
