import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { parsePagination } from '../src/modules/storage/storage.validation.js';

const missing = {
  id: '11111111-1111-4111-8111-111111111111', original_name: 'ausente.png',
  created_at: new Date('2026-10-05T12:00:00Z'), cursor_created_at: '2026-10-05T12:00:00.000000Z',
  hash_sha256: 'a'.repeat(64), storage_key: `aa/${'a'.repeat(64)}.webp`, original_size_bytes: '120', status: 'ready',
};
const healthy = { ...missing, id: '22222222-2222-4222-8222-222222222222', original_name: 'disponible.png',
  hash_sha256: 'b'.repeat(64), storage_key: `bb/${'b'.repeat(64)}.webp` };

async function fixture(t, rows) {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'smartstorage-availability-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(storageRoot)), path.resolve(os.tmpdir()));
    assert.match(path.basename(storageRoot), /^smartstorage-availability-[\w-]+$/);
    await rm(storageRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(storageRoot, 'bb'));
  await writeFile(path.join(storageRoot, healthy.storage_key), Buffer.from('stored-content'));
  const database = { query: async () => ({ rows }) };
  return createStorageService({ database, storageRoot });
}

test('una referencia sin archivo no bloquea imágenes disponibles ni expone rutas internas', async (t) => {
  const service = await fixture(t, [missing, healthy]);
  const result = await service.listFiles('owner', {});
  assert.deepEqual(result.items.map((image) => image.id), [healthy.id]);
  assert.equal(result.items[0].optimizedSizeBytes, '14');
  assert.deepEqual(result.unavailableItems, [{
    id: missing.id, originalName: 'ausente.png', createdAt: missing.created_at.toISOString(),
    folderId: null, deletedAt: null,
    originalSizeBytes: '120', status: 'unavailable', errorCode: 'STORAGE_INTEGRITY_ERROR',
  }]);
  assert.equal(result.nextCursor, null);
});

test('una página enteramente no disponible conserva el cursor para seguir navegando', async (t) => {
  const service = await fixture(t, [missing, healthy]);
  const result = await service.listFiles('owner', { limit: '1' });
  assert.deepEqual(result.items, []);
  assert.equal(result.unavailableItems.length, 1);
  assert.equal(parsePagination({ cursor: result.nextCursor }).cursor.id, missing.id);
});

test('la descarga de un archivo ausente sigue rechazándose', async (t) => {
  const service = await fixture(t, [missing]);
  await assert.rejects(service.downloadFile('owner', missing.id), { code: 'STORAGE_INTEGRITY_ERROR' });
});
