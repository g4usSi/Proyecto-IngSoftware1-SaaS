import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, CloudUpload, Cog, Download, FileCheck2, Info, LoaderCircle, LockKeyhole, RefreshCw, Workflow } from 'lucide-react';
import { useSession } from '../auth/session.jsx';
import { formatFullDate, formatRelative } from './format.js';
import { ACTIVE_JOB_STATUSES as ACTIVE, isJobReady as isReady, jobFailureMessage as failureMessage, jobStatusLabel } from './jobs.api.js';
import { useLibrary } from './library.jsx';

const steps = [
  { status: 'queued', label: 'En cola', icon: Clock3 },
  { status: 'processing', label: 'Procesando', icon: Cog },
  { status: 'converted', label: 'Convertida', icon: FileCheck2 },
  { status: 'published', label: 'Disponible', icon: CheckCircle2 },
];
const filters = {
  all: { label: 'Todos', test: () => true },
  active: { label: 'En curso', test: (job) => ACTIVE.has(job.status) },
  ready: { label: 'Disponibles', test: isReady },
  unavailable: { label: 'No disponibles', test: (job) => job.status === 'published' && !isReady(job) },
  failed: { label: 'Con error', test: (job) => job.status === 'failed' },
};

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
      {session ? <JobsList /> : (
        <div className="panel panel-empty">
          <LockKeyhole strokeWidth={1.6} aria-hidden="true" className="panel-empty-icon" />
          <p>Inicia sesión para consultar tus procesos.</p>
          <Link className="btn btn-primary" to="/login">Iniciar sesión</Link>
        </div>
      )}
    </div>
  );
}

function JobsList() {
  const { jobs: state, refreshJobs: load, download, downloadingId } = useLibrary();
  const [filter, setFilter] = useState('all');
  useEffect(() => { load(); }, [load]);
  const active = state.items.filter((job) => ACTIVE.has(job.status));

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
          <p>Al subir una imagen verás aquí su conversión y publicación. Puedes seguir usando la aplicación mientras se procesa.</p>
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
            {jobStatusLabel(job)}
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
        <ol className="job-steps" aria-label={`Progreso: ${jobStatusLabel(job)}`}>
          {steps.map(({ status, label, icon: StepIcon }, stepIndex) => (
            <li key={status} className={stepIndex < current ? 'is-done' : stepIndex === current ? 'is-current' : undefined}>
              <span><StepIcon strokeWidth={2} aria-hidden="true" /></span>{status === 'published' && job.status === 'published' && !ready ? 'Publicada' : label}
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
        ) : job.status === 'published' ? (
          <span className="job-hint">La publicación terminó, pero esta imagen ya no está disponible en la biblioteca.</span>
        ) : null}
        {job.pollError && <span className="job-hint" role="status">{job.pollError}</span>}
      </div>
    </li>
  );
}
