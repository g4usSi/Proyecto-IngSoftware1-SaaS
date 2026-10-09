import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../components/Toaster.jsx';
import { ApiError } from '../../services/api.js';
import { downloadFile, listFiles, storageErrorMessage, validateImage, webpFilename } from './storage.api.js';
import { ACTIVE_JOB_STATUSES, getImageJob, getMyQuota, isJobReady, jobFailureMessage, listImageJobs, submitImageJob } from './jobs.api.js';

const LibraryContext = createContext(null);
const THUMB_CONCURRENCY = 4;
const UPLOAD_CONCURRENCY = 3;
const FINISHED_UPLOADS = new Set(['published', 'failed', 'rejected']);
const initialList = () => ({ items: [], nextCursor: null, loading: true, error: null, loaded: false });
const mergeById = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
const latestJob = (previous, incoming) => {
  if (!previous) return incoming;
  if (!ACTIVE_JOB_STATUSES.has(previous.status) && ACTIVE_JOB_STATUSES.has(incoming.status)) return previous;
  return Date.parse(previous.updatedAt) > Date.parse(incoming.updatedAt) ? previous : incoming;
};
const uncertainAdmission = (error) => !(error instanceof ApiError) || error.code === 'INVALID_RESPONSE' || error.status >= 500 || error.status === 408;

/** Estado privado de una sesión. Tokens, archivos y claves de admisión permanecen en memoria. */
export function LibraryProvider({ authorization, children }) {
  const { toast } = useToast();
  const [gallery, setGallery] = useState(() => ({ ...initialList(), unavailableItems: [] }));
  const [jobs, setJobs] = useState(initialList);
  const [quota, setQuota] = useState({ data: null, loading: true, error: null, loaded: false });
  const [queue, setQueue] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);
  const listRequest = useRef(null);
  const jobsRequest = useRef(null);
  const quotaRequest = useRef(null);
  const controllers = useRef(new Set());
  const thumbs = useRef(new Map());
  const thumbQueue = useRef({ active: 0, waiting: [] });
  const admissions = useRef(new Set());
  const polls = useRef(new Map());
  const queueRef = useRef([]);
  const jobsRef = useRef(initialList());
  const mounted = useRef(false);
  const generation = useRef(0);

  const updateQueue = useCallback((update) => {
    const next = update(queueRef.current);
    queueRef.current = next;
    setQueue(next);
  }, []);
  const updateJobs = useCallback((update) => {
    const next = update(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
  }, []);
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
      if (controller.signal.aborted || listRequest.current !== controller) return;
      setGallery((current) => ({
        items: cursor ? mergeById([...current.items, ...data.items]) : data.items,
        unavailableItems: cursor ? mergeById([...current.unavailableItems, ...(data.unavailableItems ?? [])]) : data.unavailableItems ?? [],
        nextCursor: data.nextCursor, loading: false, error: null, loaded: true,
      }));
    } catch (error) {
      if (listRequest.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      setGallery((current) => ({ ...current, loading: false, loaded: true, error: controller.signal.aborted ? 'El listado tardó demasiado. Vuelve a intentarlo.' : storageErrorMessage(error) }));
    } finally { clearTimeout(timeout); }
  }, [authorization]);

  const refreshQuota = useCallback(async () => {
    if (!authorization) return;
    quotaRequest.current?.abort();
    const controller = new AbortController();
    quotaRequest.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 15_000);
    setQuota((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getMyQuota({ ...authorization, signal: controller.signal });
      if (controller.signal.aborted || quotaRequest.current !== controller) return;
      setQuota({ data, loading: false, loaded: true, error: null });
    } catch (error) {
      if (quotaRequest.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      setQuota((current) => ({ ...current, loading: false, loaded: true, error: controller.signal.aborted ? 'La consulta de cuota tardó demasiado.' : storageErrorMessage(error) }));
    } finally { clearTimeout(timeout); }
  }, [authorization]);

  const acceptJob = useCallback((job) => {
    const next = latestJob(jobsRef.current.items.find((item) => item.id === job.id), job);
    updateJobs((current) => ({ ...current, items: current.items.some((item) => item.id === next.id)
      ? current.items.map((item) => item.id === next.id ? next : item) : [next, ...current.items] }));
    updateQueue((current) => current.map((item) => item.id === job.id ? {
      ...item, status: next.status, job: next, message: next.status === 'failed' ? jobFailureMessage(next) : null,
    } : item));
    return next;
  }, [updateQueue, updateJobs]);

  const refreshJobs = useCallback(async (cursor = null) => {
    if (!authorization) return;
    jobsRequest.current?.abort();
    const controller = new AbortController();
    jobsRequest.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 15_000);
    updateJobs((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listImageJobs({ ...authorization, cursor, signal: controller.signal });
      if (controller.signal.aborted || jobsRequest.current !== controller) return;
      const previous = jobsRef.current.items;
      const incoming = data.items.map((job) => latestJob(previous.find((item) => item.id === job.id), job));
      const completed = incoming.some((job) => !ACTIVE_JOB_STATUSES.has(job.status) && previous.some((item) => item.id === job.id && ACTIVE_JOB_STATUSES.has(item.status)));
      updateJobs((current) => ({ items: cursor ? mergeById([...current.items, ...incoming])
        : mergeById([...current.items.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)), ...incoming]),
      nextCursor: data.nextCursor, loading: false, loaded: true, error: null }));
      updateQueue((current) => current.map((item) => {
        const job = incoming.find((entry) => entry.id === item.id);
        return job ? { ...item, job, status: job.status, message: job.status === 'failed' ? jobFailureMessage(job) : null } : item;
      }));
      if (completed) { load(); refreshQuota(); }
    } catch (error) {
      if (jobsRequest.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      updateJobs((current) => ({ ...current, loading: false, loaded: true, error: controller.signal.aborted ? 'La consulta de procesos tardó demasiado.' : storageErrorMessage(error) }));
    } finally { clearTimeout(timeout); }
  }, [authorization, updateQueue, updateJobs, load, refreshQuota]);

  const refresh = useCallback(() => Promise.all([load(), refreshQuota(), refreshJobs()]), [load, refreshQuota, refreshJobs]);

  useEffect(() => {
    mounted.current = true;
    const currentGeneration = ++generation.current;
    refresh();
    const allControllers = controllers.current;
    const allThumbs = thumbs.current;
    const allPolls = polls.current;
    return () => {
      if (generation.current === currentGeneration) generation.current += 1;
      mounted.current = false;
      listRequest.current?.abort();
      jobsRequest.current?.abort();
      quotaRequest.current?.abort();
      allPolls.forEach((entry) => { clearTimeout(entry.timer); entry.controller?.abort(); });
      allPolls.clear();
      allControllers.forEach((controller) => controller.abort());
      allThumbs.forEach((entry) => { entry.invalid = true; if (entry.url) URL.revokeObjectURL(entry.url); });
      allThumbs.clear();
      thumbQueue.current.waiting.splice(0).forEach((job) => job.cancel());
      queueRef.current.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); });
    };
  }, [refresh]);

  // Un reloj por trabajo; respeta el intervalo de cada respuesta y sigue activo al cambiar de página.
  const scheduleJob = useCallback(function schedule(job, retry = false) {
    if (!mounted.current || !authorization || !ACTIVE_JOB_STATUSES.has(job.status) || polls.current.has(job.id)) return;
    const epoch = generation.current;
    const entry = {};
    const delay = Math.max(1000, Number(job.nextPollAfterMs) || 2000, retry ? 5000 : 0);
    entry.timer = setTimeout(async () => {
      const controller = new AbortController();
      entry.controller = controller;
      const timeout = setTimeout(() => controller.abort('timeout'), 15_000);
      let next = job;
      let failed = false;
      try {
        next = await getImageJob(job.id, { ...authorization, signal: controller.signal });
        if (generation.current !== epoch || controller.signal.aborted) return;
        next = acceptJob(next);
        if (!ACTIVE_JOB_STATUSES.has(next.status)) {
          refreshQuota();
          if (isJobReady(next)) {
            load();
            toast({ type: 'success', title: 'Imagen disponible', message: next.originalName });
          }
        }
      } catch (error) {
        if (generation.current !== epoch || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
        failed = true;
        updateJobs((current) => ({ ...current, items: current.items.map((item) => item.id === job.id
          ? { ...item, pollError: 'No se pudo actualizar. Reintentaremos automáticamente.' } : item) }));
      } finally {
        clearTimeout(timeout);
        if (polls.current.get(job.id) === entry) polls.current.delete(job.id);
        if (generation.current === epoch && !controller.signal.aborted) schedule(next, failed);
        else if (generation.current === epoch && controller.signal.reason === 'timeout') schedule(next, true);
      }
    }, delay);
    polls.current.set(job.id, entry);
  }, [authorization, acceptJob, refreshQuota, load, toast, updateJobs]);

  useEffect(() => {
    const activeIds = new Set(jobs.items.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)).map((job) => job.id));
    polls.current.forEach((entry, id) => {
      if (!activeIds.has(id)) { clearTimeout(entry.timer); entry.controller?.abort(); polls.current.delete(id); }
    });
    jobs.items.forEach((job) => scheduleJob(job));
  }, [jobs.items, scheduleJob]);

  // Varias admisiones simultáneas; ninguna espera a la conversión del worker.
  const admit = useCallback(async (entry) => {
    const epoch = generation.current;
    const alive = () => mounted.current && generation.current === epoch;
    updateQueue((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'uploading', message: null } : item));
    const request = async (operation) => {
      const controller = new AbortController();
      const untrack = track(controller);
      const timeout = setTimeout(() => controller.abort('timeout'), 120_000);
      try { return await operation(controller.signal); }
      finally { clearTimeout(timeout); untrack(); }
    };
    try {
      let job;
      if (entry.reconcile) {
        try { job = await request((signal) => getImageJob(entry.id, { ...authorization, signal })); }
        catch (error) { if (error.status !== 404 || !alive()) throw error; }
      }
      if (!alive()) return;
      if (!job) job = await request((signal) => submitImageJob(entry.file, { ...authorization, idempotencyKey: entry.id, folderId: entry.folderId, signal }));
      if (!alive()) return;
      acceptJob(job);
      if (isJobReady(job)) load();
    } catch (error) {
      if (!alive()) return;
      if (uncertainAdmission(error)) {
        // El UUID es también el ID del trabajo. Una respuesta perdida nunca crea una clave nueva.
        try {
          const job = await request((signal) => getImageJob(entry.id, { ...authorization, signal }));
          if (!alive()) return;
          acceptJob(job);
          if (isJobReady(job)) load();
          return;
        } catch { if (!alive()) return; }
        updateQueue((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'unknown', reconcile: true,
          message: 'No se pudo confirmar la admisión. Consulta o reintenta con la misma clave para evitar duplicados.' } : item));
      } else {
        updateQueue((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'rejected', message: storageErrorMessage(error) } : item));
      }
    } finally {
      admissions.current.delete(entry.id);
      if (alive()) refreshQuota();
    }
  }, [authorization, acceptJob, load, refreshQuota, updateQueue]);

  useEffect(() => {
    if (!authorization || !mounted.current) return;
    for (const entry of queue) {
      if (admissions.current.size >= UPLOAD_CONCURRENCY) break;
      if (entry.status !== 'waiting' || admissions.current.has(entry.id)) continue;
      admissions.current.add(entry.id);
      admit(entry);
    }
  }, [queue, authorization, admit]);

  const addFiles = useCallback((fileList, { folderId } = {}) => {
    const entries = [...fileList].map((file) => {
      const problem = validateImage(file);
      return { id: crypto.randomUUID(), file, folderId, name: file.name, size: file.size,
        preview: problem ? null : URL.createObjectURL(file), status: problem ? 'rejected' : 'waiting', message: problem,
        validationError: Boolean(problem) };
    });
    if (entries.length) updateQueue((current) => [...current, ...entries]);
  }, [updateQueue]);

  const retryUpload = useCallback((id) => {
    updateQueue((current) => current.map((item) => item.id === id && item.file && !item.validationError && ['unknown', 'failed', 'rejected'].includes(item.status)
      ? { ...item, id: item.status === 'unknown' ? item.id : crypto.randomUUID(), job: null,
        reconcile: item.status === 'unknown', status: 'waiting', message: null } : item));
  }, [updateQueue]);

  const dismissUpload = useCallback((id) => {
    updateQueue((current) => current.filter((item) => {
      if (item.id !== id || !FINISHED_UPLOADS.has(item.status)) return true;
      if (item.preview) URL.revokeObjectURL(item.preview);
      return false;
    }));
  }, [updateQueue]);

  const clearFinished = useCallback(() => {
    updateQueue((current) => current.filter((item) => {
      if (!FINISHED_UPLOADS.has(item.status)) return true;
      if (item.preview) URL.revokeObjectURL(item.preview);
      return false;
    }));
  }, [updateQueue]);

  const invalidateFile = useCallback((id) => {
    const entry = thumbs.current.get(id);
    if (entry) { entry.invalid = true; entry.controller?.abort(); if (entry.url) URL.revokeObjectURL(entry.url); thumbs.current.delete(id); }
    setGallery((current) => ({ ...current, items: current.items.filter((item) => item.id !== id), unavailableItems: current.unavailableItems.filter((item) => item.id !== id) }));
  }, []);

  const pumpThumbs = useCallback(function pump() {
    const state = thumbQueue.current;
    while (state.active < THUMB_CONCURRENCY && state.waiting.length) {
      const job = state.waiting.shift();
      state.active += 1;
      job.run().finally(() => { state.active -= 1; if (mounted.current) pump(); });
    }
  }, []);

  const getThumbnail = useCallback((file) => {
    const cached = thumbs.current.get(file.id);
    if (cached) return cached.promise;
    const epoch = generation.current;
    const entry = {};
    entry.promise = new Promise((resolve) => {
      thumbQueue.current.waiting.push({ cancel: () => resolve(null), run: async () => {
        if (entry.invalid || generation.current !== epoch) { resolve(null); return; }
        const controller = new AbortController();
        entry.controller = controller;
        const untrack = track(controller);
        try {
          const blob = await downloadFile(file.id, { ...authorization, signal: controller.signal });
          if (entry.invalid || controller.signal.aborted || generation.current !== epoch) { resolve(null); return; }
          entry.url = URL.createObjectURL(blob);
          resolve(entry.url);
        } catch {
          if (thumbs.current.get(file.id) === entry) thumbs.current.delete(file.id);
          resolve(null);
        } finally { untrack(); }
      } });
    });
    thumbs.current.set(file.id, entry);
    pumpThumbs();
    return entry.promise;
  }, [authorization, pumpThumbs]);

  const download = useCallback(async (file) => {
    const epoch = generation.current;
    setDownloadingId(file.id);
    const controller = new AbortController();
    const untrack = track(controller);
    try {
      const cached = thumbs.current.get(file.id);
      let url = cached?.url ?? null;
      let temporary = false;
      if (!url) {
        const blob = await downloadFile(file.id, { ...authorization, signal: controller.signal });
        if (controller.signal.aborted || generation.current !== epoch) return;
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
      if (!controller.signal.aborted && generation.current === epoch) toast({ type: 'error', title: 'No se pudo descargar', message: storageErrorMessage(error) });
    } finally { untrack(); if (generation.current === epoch) setDownloadingId(null); }
  }, [authorization, toast]);

  const stats = useMemo(() => {
    const originalBytes = gallery.items.reduce((sum, file) => sum + Number(file.originalSizeBytes || 0), 0);
    const webpBytes = gallery.items.reduce((sum, file) => sum + Number(file.optimizedSizeBytes || 0), 0);
    return { count: gallery.items.length, originalBytes, webpBytes,
      quotaBytes: quota.data ? Number(quota.data.usedBytes) : null,
      savedRatio: originalBytes > 0 ? (originalBytes - webpBytes) / originalBytes : 0,
      complete: gallery.loaded && !gallery.nextCursor, loaded: gallery.loaded && !gallery.error };
  }, [gallery, quota.data]);

  const value = useMemo(() => ({ enabled: Boolean(authorization), ...gallery, stats, queue, quota, jobs, downloadingId,
    refresh, refreshQuota, refreshJobs, loadMoreJobs: () => refreshJobs(jobs.nextCursor),
    loadMore: () => load(gallery.nextCursor), addFiles, retryUpload, dismissUpload, clearFinished, invalidateFile, download, getThumbnail,
  }), [authorization, gallery, stats, queue, quota, jobs, downloadingId, refresh, refreshQuota, refreshJobs, load, addFiles, retryUpload, dismissUpload, clearFinished, invalidateFile, download, getThumbnail]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary debe usarse dentro de <LibraryProvider>.');
  return context;
}
