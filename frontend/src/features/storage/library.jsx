import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../components/Toaster.jsx';
import { downloadFile, listFiles, storageErrorMessage, uploadFile, validateImage, webpFilename } from './storage.api.js';

const LibraryContext = createContext(null);
const THUMB_CONCURRENCY = 4;

/**
 * Estado de la biblioteca de una identidad (sesión JWT o cuenta demo).
 * `authorization` son las opciones de petición: { token } o { headers }.
 * Las miniaturas son el propio WebP descargado con la misma autorización.
 */
export function LibraryProvider({ authorization, children }) {
  const { toast } = useToast();
  const [gallery, setGallery] = useState({ items: [], nextCursor: null, loading: Boolean(authorization), error: null, loaded: false });
  const [queue, setQueue] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);
  const listRequest = useRef(null);
  const controllers = useRef(new Set());
  const thumbs = useRef(new Map());
  const thumbQueue = useRef({ active: 0, waiting: [] });
  const queueRunning = useRef(false);
  const queueRef = useRef([]);
  queueRef.current = queue;

  const track = (controller) => { controllers.current.add(controller); return () => controllers.current.delete(controller); };

  const load = useCallback(async (cursor = null) => {
    if (!authorization) return;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 15_000);
    setGallery((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listFiles({ ...authorization, cursor, signal: controller.signal });
      if (listRequest.current !== controller) return;
      setGallery((current) => ({
        items: cursor ? [...new Map([...current.items, ...data.items].map((file) => [file.id, file])).values()] : data.items,
        nextCursor: data.nextCursor,
        loading: false,
        error: null,
        loaded: true,
      }));
    } catch (error) {
      if (listRequest.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      setGallery((current) => ({ ...current, loading: false, loaded: true, error: controller.signal.aborted ? 'El listado tardó demasiado. Vuelve a intentarlo.' : storageErrorMessage(error) }));
    } finally {
      clearTimeout(timeout);
    }
  }, [authorization]);

  useEffect(() => {
    load();
    const allControllers = controllers.current;
    const allThumbs = thumbs.current;
    return () => {
      listRequest.current?.abort();
      allControllers.forEach((controller) => controller.abort());
      allThumbs.forEach((entry) => { if (entry.url) URL.revokeObjectURL(entry.url); });
      allThumbs.clear();
    };
  }, [load]);

  // ── Subidas: cola secuencial (el servidor valida cuota y límites en cada una). ──
  const runQueue = useCallback(async () => {
    if (queueRunning.current || !authorization) return;
    queueRunning.current = true;
    let done = 0;
    let failed = 0;
    try {
      for (;;) {
        const next = queueRef.current.find((item) => item.status === 'queued');
        if (!next) break;
        setQueue((current) => current.map((item) => (item.id === next.id ? { ...item, status: 'uploading' } : item)));
        const controller = new AbortController();
        const untrack = track(controller);
        const timeout = setTimeout(() => controller.abort('timeout'), 120_000);
        try {
          const image = await uploadFile(next.file, { ...authorization, signal: controller.signal });
          setQueue((current) => current.map((item) => (item.id === next.id ? { ...item, status: 'done', image } : item)));
          setGallery((current) => ({ ...current, items: [image, ...current.items.filter((file) => file.id !== image.id)] }));
          done += 1;
        } catch (error) {
          if (controller.signal.aborted && controller.signal.reason !== 'timeout') break;
          const message = controller.signal.aborted
            ? 'Tardó demasiado. Actualiza la galería: podría haberse guardado.'
            : storageErrorMessage(error, 'No se pudo subir. Vuelve a intentarlo.');
          setQueue((current) => current.map((item) => (item.id === next.id ? { ...item, status: 'error', message } : item)));
          failed += 1;
        } finally {
          clearTimeout(timeout);
          untrack();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      queueRunning.current = false;
    }
    if (done && !failed) toast({ type: 'success', title: done === 1 ? 'Imagen guardada en WebP' : `${done} imágenes guardadas en WebP` });
    else if (failed) toast({ type: 'error', title: failed === 1 ? 'Una imagen no se pudo subir' : `${failed} imágenes no se pudieron subir`, message: 'Revisa el detalle en la lista de subidas.' });
  }, [authorization, toast]);

  const addFiles = useCallback((fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    const entries = files.map((file) => {
      const problem = validateImage(file);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        preview: problem ? null : URL.createObjectURL(file),
        status: problem ? 'error' : 'queued',
        message: problem,
      };
    });
    setQueue((current) => {
      const next = [...current, ...entries];
      queueRef.current = next;
      return next;
    });
    setTimeout(runQueue, 0);
  }, [runQueue]);

  const dismissUpload = useCallback((id) => {
    setQueue((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  const clearFinished = useCallback(() => {
    setQueue((current) => {
      current.filter((item) => item.status === 'done' || item.status === 'error').forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      return current.filter((item) => item.status === 'queued' || item.status === 'uploading');
    });
  }, []);

  // ── Miniaturas con concurrencia limitada y caché por id. ──
  const pumpThumbs = useCallback(() => {
    const state = thumbQueue.current;
    while (state.active < THUMB_CONCURRENCY && state.waiting.length) {
      const job = state.waiting.shift();
      state.active += 1;
      job().finally(() => { state.active -= 1; pumpThumbs(); });
    }
  }, []);

  const getThumbnail = useCallback((file) => {
    const cached = thumbs.current.get(file.id);
    if (cached) return cached.promise;
    const entry = {};
    entry.promise = new Promise((resolve) => {
      thumbQueue.current.waiting.push(async () => {
        const controller = new AbortController();
        const untrack = track(controller);
        try {
          const blob = await downloadFile(file.id, { ...authorization, signal: controller.signal });
          entry.url = URL.createObjectURL(blob);
          resolve(entry.url);
        } catch {
          thumbs.current.delete(file.id);
          resolve(null);
        } finally {
          untrack();
        }
      });
      pumpThumbs();
    });
    thumbs.current.set(file.id, entry);
    return entry.promise;
  }, [authorization, pumpThumbs]);

  const download = useCallback(async (file) => {
    setDownloadingId(file.id);
    const controller = new AbortController();
    const untrack = track(controller);
    try {
      const cached = thumbs.current.get(file.id);
      let url = cached?.url ?? null;
      let temporary = false;
      if (!url) {
        const blob = await downloadFile(file.id, { ...authorization, signal: controller.signal });
        url = URL.createObjectURL(blob);
        temporary = true;
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = webpFilename(file.originalName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      if (temporary) setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast({ type: 'success', title: 'Descarga lista', message: webpFilename(file.originalName) });
    } catch (error) {
      if (!controller.signal.aborted) toast({ type: 'error', title: 'No se pudo descargar', message: storageErrorMessage(error) });
    } finally {
      untrack();
      setDownloadingId(null);
    }
  }, [authorization, toast]);

  const stats = useMemo(() => {
    const originalBytes = gallery.items.reduce((sum, file) => sum + Number(file.originalSizeBytes || 0), 0);
    const webpBytes = gallery.items.reduce((sum, file) => sum + Number(file.optimizedSizeBytes || 0), 0);
    return {
      count: gallery.items.length,
      originalBytes,
      webpBytes,
      savedRatio: originalBytes > 0 ? (originalBytes - webpBytes) / originalBytes : 0,
      complete: gallery.loaded && !gallery.nextCursor,
      loaded: gallery.loaded,
    };
  }, [gallery.items, gallery.loaded, gallery.nextCursor]);

  const value = useMemo(() => ({
    enabled: Boolean(authorization),
    ...gallery,
    stats,
    queue,
    downloadingId,
    refresh: () => load(),
    loadMore: () => load(gallery.nextCursor),
    addFiles,
    dismissUpload,
    clearFinished,
    download,
    getThumbnail,
  }), [authorization, gallery, stats, queue, downloadingId, load, addFiles, dismissUpload, clearFinished, download, getThumbnail]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary debe usarse dentro de <LibraryProvider>.');
  return context;
}
