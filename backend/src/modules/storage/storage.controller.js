import { pipeline } from 'node:stream/promises';

export function createStorageController(service) {
  return {
    async list(req, res) {
      res.json({ data: await service.listFiles(req.user.id, req.query) });
    },
    async upload(req, res) {
      res.status(201).json({ data: await service.uploadFile(req.user.id, req.file, req.body) });
    },
    async download(req, res) {
      const file = await service.downloadFile(req.user.id, req.params.fileId);
      try {
        res.attachment(file.filename);
        res.type('image/webp');
        res.set('Content-Length', file.size);
        res.set('Cache-Control', 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        await pipeline(file.handle.createReadStream(), res);
      } catch (error) {
        if (res.headersSent || res.destroyed) {
          res.destroy();
          return;
        }
        throw error;
      } finally {
        await file.handle.close().catch(() => {});
      }
    },
    async remove(req, res) {
      res.json({ data: await service.deleteFile(req.user.id, req.params.fileId) });
    },
    async stats(_req, res) {
      res.json({ data: await service.stats() });
    },
  };
}
