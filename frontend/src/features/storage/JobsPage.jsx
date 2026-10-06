import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, CloudUpload, Cog, Download, FileCheck2, Info, LoaderCircle, LockKeyhole, RefreshCw, Workflow } from 'lucide-react';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { formatFullDate, formatRelative } from './format.js';
import { getImageJob, JOB_STATUS_LABELS, listImageJobs } from './jobs.api.js';
import { useLibrary } from './library.jsx';
import { storageErrorMessage } from './storage.api.js';

const steps = [
  { status: 'queued', label: 'En cola', icon: Clock3 },
  { status: 'processing', label: 'Procesando', icon: Cog },
  { status: 'converted', label: 'Convertida', icon: FileCheck2 },
  { status: 'published', label: 'Disponible', icon: CheckCircle2 },
];
const ACTIVE = new Set(['queued', 'processing', 'converted']);
const filters = {
  all: { label: 'Todos', test: () => true },
  active: { label: 'En curso', test: (job) => ACTIVE.has(job.status) },
  ready: { label: 'Disponibles', test: (job) => job.status === 'published' },
  failed: { label: 'Con error', test: (job) => job.status === 'failed' },
};
// Mensajes seguros por errorCode: nunca se muestran detalles internos.
const failureMessages = {
  JOB_EXPIRED: 'El proceso venció antes de terminar. Sube la imagen de nuevo.',
};
const failureMessage = (job) => failureMessages[job.errorCode] ?? 'No pudimos procesar esta imagen. Vuelve a subirla más tarde.';
const isReady = (job) => job.status === 'published' && job.available && job.imageId;

/** Procesos de imagen: estados reales de GET /api/jobs con consultas periódicas cancelables. */
export function JobsPage() {
  const { session } = useSession();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Biblioteca</span>
          <h1>Procesos</h1>
          <p>Sigue el estado de las imágenes que se procesan en segundo plano.</p>
        </div>
      </header>
      {session ? <JobsList token={session.token} /> : (
        <div className="panel panel-empty">
          <LockKeyhole strokeWidth={1.6} aria-hidden="true" className="panel-empty-icon" />
          <p>Inicia sesión para consultar tus procesos.</p>
          <Link className="btn btn-primary" to="/login">Iniciar sesión</Link>
        </div>
      )}
    </div>
  );
}

function JobsList({ token }) {
  const { refresh, download, downloadingId } = useLibrary();
  const { toast } = useToast();
  const [state, setState] = useState({ items: [], nextCursor: null, loading: true, error: null, loaded: false });
  const [filter, setFilter] = useState('all');
  const listController = useRef(null);

  const load = useCallback(async (cursor = null) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listImageJobs({ token, cursor, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((current) => ({
        items: cursor ? [...current.items, ...data.items.filter((job) => !current.items.some((item) => item.id === job.id))] : data.items ?? [],
        nextCursor: data.nextCursor ?? null,
        loading: false,
        error: null,
        loaded: true,
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((current) => ({ ...current, loading: false, loaded: true, error: storageErrorMessage(error) }));
    }
  }, [token]);

  useEffect(() => {
    load();
    return () => listController.current?.abort();
  }, [load]);

  // Consulta solo los trabajos activos, cuando el servidor lo indique (nextPollAfterMs).
  const active = state.items.filter((job) => ACTIVE.has(job.status) && job.nextPollAfterMs != null);
  const pollKey = JSON.stringify(active.map(({ id, nextPollAfterMs }) => ({ id, nextPollAfterMs })));
  useEffect(() => {
    const jobs = JSON.parse(pollKey);
    if (!jobs.length) return undefined;
    const controller = new AbortController();
    const delay = Math.max(1000, Math.min(...jobs.map((job) => job.nextPollAfterMs)));
    let timer;
    async function poll() {
      const request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 15_000);
      const cancel = () => request.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      const results = await Promise.allSettled(jobs.map((job) => getImageJob(job.id, { token, signal: request.signal })));
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', cancel);
      if (controller.signal.aborted) return;
      const updated = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      const failed = results.some((result) => result.status === 'rejected');
      const newlyReady = updated.filter((job) => isReady(job));
      setState((current) => ({ ...current,
        error: failed ? 'No se pudo actualizar algún proceso. Volveremos a intentarlo automáticamente.' : null,
        items: current.items.map((item) => updated.find((job) => job.id === item.id) ?? item),
      }));
      if (newlyReady.length) {
        refresh();
        toast({ type: 'success', title: newlyReady.length === 1 ? 'Imagen disponible' : `${newlyReady.length} imágenes disponibles`, message: newlyReady.map((job) => job.originalName).join(', ') });
      }
      // Repetir también si el servidor devuelve el mismo estado o falla temporalmente.
      timer = setTimeout(poll, failed ? Math.max(delay, 5000) : delay);
    }
    timer = setTimeout(poll, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pollKey, token, refresh, toast]);

  const counts = useMemo(() => Object.fromEntries(Object.entries(filters).map(([key, { test }]) => [key, state.items.filter(test).length])), [state.items]);
  const visible = state.items.filter(filters[filter].test);

  return (
    <>
      <div className="jobs-toolbar">
        <div className="segmented" role="tablist" aria-label="Filtrar procesos">
          {Object.entries(filters).map(([key, { label }]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'is-active' : undefined} onClick={() => setFilter(key)}>
              {label}<span>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="jobs-toolbar-right">
          {active.length > 0 && <span className="live-pill"><i aria-hidden="true" />Actualizando</span>}
          <button type="button" className={`icon-button${state.loading ? ' is-spinning' : ''}`} onClick={() => load()} disabled={state.loading} aria-label="Actualizar procesos" title="Actualizar"><RefreshCw strokeWidth={2} /></button>
        </div>
      </div>

      {state.error && (
        <div className="gallery-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={() => load()}>Volver a intentar</button></div>
      )}

      {!state.loaded && (
        <div className="jobs-list" aria-hidden="true">{[0, 1, 2].map((key) => <div className="job-card is-skeleton" key={key}><span className="sk-line" /><span className="sk-line short" /></div>)}</div>
      )}

      {state.loaded && !state.error && state.items.length === 0 && (
        <div className="panel panel-empty">
          <Workflow strokeWidth={1.6} aria-hidden="true" className="panel-empty-icon" />
          <h2>No tienes procesos en segundo plano</h2>
          <p>Por ahora las subidas se convierten al momento y aparecen directo en tu biblioteca. Cuando se active el procesamiento en segundo plano, verás aquí su avance.</p>
          <Link className="btn btn-secondary" to="/app/upload"><CloudUpload strokeWidth={2} aria-hidden="true" />Subir imágenes</Link>
        </div>
      )}

      {state.items.length > 0 && visible.length === 0 && <p className="panel-muted jobs-none">No hay procesos en esta categoría.</p>}

      {visible.length > 0 && (
        <ul className="jobs-list">
          {visible.map((job, index) => <JobCard key={job.id} job={job} index={index} downloading={downloadingId === job.imageId} onDownload={() => download({ id: job.imageId, originalName: job.originalName })} />)}
        </ul>
      )}

      {state.nextCursor && (
        <div className="gallery-more">
          <button type="button" className="btn btn-secondary" onClick={() => load(state.nextCursor)} disabled={state.loading}>
            {state.loading ? <><LoaderCircle className="spin" strokeWidth={2} aria-hidden="true" />Cargando…</> : 'Ver procesos anteriores'}
          </button>
        </div>
      )}

      <p className="privacy-footnote"><Info strokeWidth={2} aria-hidden="true" />Si recargas la página, el estado se recupera solo: no hace falta volver a subir la imagen.</p>
    </>
  );
}

function JobCard({ job, index, downloading, onDownload }) {
  const failed = job.status === 'failed';
  const ready = isReady(job);
  const current = steps.findIndex((step) => step.status === job.status);

  return (
    <li className={`job-card is-${job.status}`} style={{ '--i': Math.min(index, 10) }}>
      <div className="job-main">
        <div className="job-title">
          <strong title={job.originalName}>{job.originalName}</strong>
          <span className={`job-pill is-${job.status}`}>
            {ACTIVE.has(job.status) && job.status !== 'converted' && <LoaderCircle className="spin" strokeWidth={2.2} aria-hidden="true" />}
            {failed && <AlertCircle strokeWidth={2.2} aria-hidden="true" />}
            {ready && <CheckCircle2 strokeWidth={2.2} aria-hidden="true" />}
            {JOB_STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>
        <p className="job-meta">
          <time dateTime={job.createdAt} title={formatFullDate(job.createdAt)}>Creado {formatRelative(job.createdAt)}</time>
          {job.attempts > 0 && <> · intento {job.attempts} de {job.maxAttempts}</>}
          {ACTIVE.has(job.status) && job.expiresAt && <> · vence {formatRelative(job.expiresAt)}</>}
        </p>
      </div>

      {failed ? (
        <p className="job-error"><AlertCircle strokeWidth={2} aria-hidden="true" />{failureMessage(job)}</p>
      ) : (
        <ol className="job-steps" aria-label={`Progreso: ${JOB_STATUS_LABELS[job.status] ?? job.status}`}>
          {steps.map(({ status, label, icon: StepIcon }, stepIndex) => (
            <li key={status} className={stepIndex < current ? 'is-done' : stepIndex === current ? 'is-current' : undefined}>
              <span><StepIcon strokeWidth={2} aria-hidden="true" /></span>{label}
            </li>
          ))}
        </ol>
      )}

      <div className="job-actions">
        {ready ? (
          <button type="button" className="btn btn-primary" onClick={onDownload} disabled={downloading}>
            {downloading ? <LoaderCircle className="spin" strokeWidth={2} aria-hidden="true" /> : <Download strokeWidth={2} aria-hidden="true" />}Descargar WebP
          </button>
        ) : job.status === 'converted' ? (
          <span className="job-hint">La imagen está convertida y se está publicando; aún no está en tu biblioteca.</span>
        ) : null}
      </div>
    </li>
  );
}
