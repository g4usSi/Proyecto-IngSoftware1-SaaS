import { AppError } from '../../lib/app-error.js';
import { createStorageRepository } from './storage.repository.js';
import { parseAlbumName, validateAlbumId } from './storage.validation.js';

function albumDto(row) {
  return { id: row.id, name: row.name, createdAt: new Date(row.created_at).toISOString(), imageCount: row.image_count || '0' };
}

export function createAlbumsService({ database }) {
  const repository = createStorageRepository(database);
  async function write(ownerId, operation) {
    try { return await repository.withUserTransaction(ownerId, operation); }
    catch (error) {
      if (error.code === '23505') throw new AppError(409, 'ALBUM_NAME_CONFLICT', 'Ya tienes un álbum con ese nombre.');
      throw error;
    }
  }
  return {
    async list(ownerId) {
      return { items: (await repository.listAlbums(ownerId)).map(albumDto) };
    },
    async create(ownerId, body) {
      const name = parseAlbumName(body);
      return write(ownerId, async (client) => ({ album: albumDto(await repository.insertAlbum(client, ownerId, name)) }));
    },
    async rename(ownerId, albumId, body) {
      validateAlbumId(albumId);
      const name = parseAlbumName(body);
      return write(ownerId, async (client) => {
        await repository.findAlbum(client, ownerId, albumId);
        return { album: albumDto(await repository.renameAlbum(client, ownerId, albumId, name)) };
      });
    },
    async remove(ownerId, albumId) {
      validateAlbumId(albumId);
      return write(ownerId, async (client) => {
        await repository.findAlbum(client, ownerId, albumId);
        await repository.removeAlbum(client, ownerId, albumId);
        return { deleted: true, albumId };
      });
    },
  };
}
