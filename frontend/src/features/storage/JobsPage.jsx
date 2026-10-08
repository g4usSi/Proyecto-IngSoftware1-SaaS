import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, CloudUpload, Cog, Download, FileCheck2, ImageOff, Info, LoaderCircle, LockKeyhole, RefreshCw, Workflow } from 'lucide-react';
import { useSession } from '../auth/session.jsx';
import { formatFullDate, formatRelative } from './format.js';
import { ACTIVE_JOB_STATUSES as ACTIVE, isJobReady as isReady, jobFailureMessage as failureMessage, jobStatusLabel } from './jobs.api.js';
import { useLibrary } from './library.jsx';
import { useFileList } from './useFileList.js';
import { FileActions } from './FileActions.jsx';
import './organization.css';

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
  unavailable: { label: 'No disponibles', test: (job) => job.status === 'unavailable' || (job.status === 'published' && !isReady(job)) },
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
          <p>Sigue tus subidas y revisa las imágenes que necesitan atención.</p>
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
  const files = useFileList({ scanAll: true });
  const [params, setParams] = useSearchParams();
  const filter = Object.hasOwn(filters, params.get('filter')) ? params.get('filter') : 'all';
  const setFilter = (value) => setParams(value === 'all' ? {} : { filter: value }, { replace: true });
  useEffect(() => { load(); }, [load]);
  const active = state.items.filter((job) => ACTIVE.has(job.status));
  const entries = useMemo(() => {
    const missing = new Map(files.unavailableItems.map((file) => [file.id, file]));
    const jobs = state.items.map((job) => missing.has(job.imageId) ? { ...job, available: false, missingFile: missing.get(job.imageId) } : job);
    const linked = new Set(jobs.map((job) => job.imageId));
    return [...jobs, ...files.unavailableItems.filter((file) => !linked.has(file.id)).map((file) => ({ ...file, id: `file:${file.id}`, missingFile: file }))];
  }, [state.items, files.unavailableItems]);
  const refreshAll = () => { load(); files.refresh(); };

  const counts = useMemo(() => Object.fromEntries(Object.entries(filters).map(([key, { test }]) => [key, entries.filter(test).length])), [entries]);
  const visible = entries.filter(filters[filter].test);

  return (
    <>
      <div className="jobs-toolbar">
        <div className="segmented" role="group" aria-label="Filtrar procesos">
          {Object.entries(filters).map(([key, { label }]) => (
            <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? 'is-active' : undefined} onClick={() => setFilter(key)}>
              {label}<span>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="jobs-toolbar-right">
          {active.length > 0 && <span className="live-pill"><i aria-hidden="true" />Actualizando</span>}
          <button type="button" className={`icon-button${state.loading || files.loading ? ' is-spinning' : ''}`} onClick={refreshAll} disabled={state.loading || files.loading} aria-label="Actualizar procesos" title="Actualizar"><RefreshCw strokeWidth={2} /></button>
        </div>
      </div>
      <div className="process-guide">
        <p><Clock3 aria-hidden="true" /><span><strong>En curso</strong> Estamos convirtiendo o publicando la imagen.</span></p>
        <p><ImageOff aria-hidden="true" /><span><strong>No disponibles</strong> Imágenes registradas que ahora no se pueden descargar.</span></p>
        <p><AlertCircle aria-hidden="true" /><span><strong>Con error</strong> Subidas que no pudieron terminar. Revisa el motivo en cada una.</span></p>
      </div>
      {files.loading && <p className="panel-muted" role="status">Comprobando imágenes de la biblioteca…</p>}
      {files.error && <div className="gallery-error" role="alert"><p>No se pudieron comprobar las imágenes no disponibles. {files.error}</p><button type="button" className="btn btn-secondary" onClick={files.refresh}>Volver a comprobar</button></div>}
      {state.nextCursor && <p className="panel-muted">Los contadores incluyen los procesos cargados. Puedes consultar los anteriores al final.</p>}

      {state.error && (
        <div className="gallery-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={() => load()}>Volver a intentar</button></div>
      )}

      {!state.loaded && (
        <div className="jobs-list" aria-hidden="true">{[0, 1, 2].map((key) => <div className="job-card is-skeleton" key={key}><span className="sk-line" /><span className="sk-line short" /></div>)}</div>
      )}

      {state.loaded && files.loaded && !state.error && !files.error && entries.length === 0 && (
        <div className="panel panel-empty">
          <Workflow strokeWidth={1.6} aria-hidden="true" className="panel-empty-icon" />
          <h2>No tienes procesos en segundo plano</h2>
          <p>Al subir una imagen verás aquí su conversión y publicación. Puedes seguir usando la aplicación mientras se procesa.</p>
          <Link className="btn btn-secondary" to="/app/upload"><CloudUpload strokeWidth={2} aria-hidden="true" />Subir imágenes</Link>
        </div>
      )}

      {entries.length > 0 && visible.length === 0 && <p className="panel-muted jobs-none">No hay imágenes ni procesos en esta categoría.</p>}

      {visible.length > 0 && (
        <ul className="jobs-list">
          {visible.map((job, index) => job.missingFile ? <li key={job.id} className="job-card is-unavailable">
            <div className="job-title"><strong>{job.originalName}</strong><span className="job-pill"><ImageOff aria-hidden="true" />No disponible</span></div>
            <p className="job-hint">El archivo guardado falta o no supera la comprobación de integridad. Su registro sigue en tu biblioteca, pero no se puede ver ni descargar.</p>
            <div className="job-actions"><Link className="btn btn-secondary" to="/app/upload"><CloudUpload aria-hidden="true" />Volver a subir</Link><FileActions file={job.missingFile} onChanged={files.refresh} /></div>
          </li> : <JobCard key={job.id} job={job} index={index} downloading={downloadingId === job.imageId} onDownload={() => download({ id: job.imageId, originalName: job.originalName })} />)}
        </ul>
      )}

      {state.nextCursor && (
        <div className="gallery-more">
          <button type="button" className="btn btn-secondary" onClick={() => load(state.nextCursor)} disabled={state.loading}>
            {state.loading ? <><LoaderCircle className="spin" strokeWidth={2} aria-hidden="true" />Cargando…</> : 'Ver procesos anteriores'}
          </button>
        </div>
      )}

      <p className="privacy-footnote"><Info strokeWidth={2} aria-hidden="true" />Las subidas admitidas se recuperan al iniciar sesión. Un error temporal al consultar su estado no significa que la subida haya fallado.</p>
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
          <span className="job-hint">La publicación terminó, pero ahora no puede descargarse. Puede estar en la papelera, haberse eliminado o tener un problema de almacenamiento. <Link className="link-button" to="/app/trash">Revisar papelera</Link></span>
        ) : null}
        {job.pollError && <span className="job-hint" role="status">{job.pollError}</span>}
        {failed && <Link className="btn btn-secondary" to="/app/upload"><CloudUpload aria-hidden="true" />Volver a subir</Link>}
      </div>
    </li>
  );
}
