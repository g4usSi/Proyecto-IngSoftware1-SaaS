import { useRef } from 'react';
import { AlertCircle, CheckCircle2, CloudUpload, LoaderCircle, X } from 'lucide-react';
import { IMAGE_ACCEPT } from './storage.api.js';
import { formatBytes } from './format.js';
import { useLibrary } from './library.jsx';
import { isJobReady, jobStatusLabel } from './jobs.api.js';

const statusLabel = { waiting: 'Esperando envío', uploading: 'Enviando…', queued: 'En cola del servidor', processing: 'Convirtiendo a WebP…', converted: 'Publicando…', published: 'Disponible', failed: 'No se pudo procesar', rejected: 'No se admitió', unknown: 'Admisión sin confirmar' };
const busyStatuses = new Set(['waiting', 'uploading', 'queued', 'processing', 'converted']);
const finishedStatuses = new Set(['published', 'failed', 'rejected']);

/** Única entrada de subida: toda la zona es clicable y acepta arrastrar varias imágenes. */
export function UploadDropzone({ folderId } = {}) {
  const { addFiles } = useLibrary();
  const inputRef = useRef(null);
  const open = () => inputRef.current?.click();

  return (
    <div
      className="dropzone"
      role="button"
      tabIndex={0}
      aria-describedby="dropzone-help"
      onClick={open}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}
    >
      <span className="dropzone-icon" aria-hidden="true"><CloudUpload strokeWidth={1.6} /></span>
      <h2>Arrastra tus imágenes o haz clic para elegirlas</h2>
      <p id="dropzone-help">Puedes elegir varias a la vez. Se procesan en segundo plano; puedes seguir usando tu biblioteca.</p>
      <input
        ref={inputRef} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => { addFiles(event.target.files, { folderId }); event.target.value = ''; }}
      />
    </div>
  );
}

/** Lista de subidas de esta sesión con su estado. */
export function UploadQueue() {
  const { queue, dismissUpload, clearFinished, retryUpload } = useLibrary();
  if (!queue.length) return null;
  const busy = queue.some((item) => busyStatuses.has(item.status));
  const finished = queue.some((item) => finishedStatuses.has(item.status));

  return (
    <section className="panel upload-queue" aria-labelledby="queue-title">
      <div className="panel-head">
        <h2 id="queue-title">{busy ? 'Subidas en curso' : 'Subidas de esta sesión'}</h2>
        {finished && <button type="button" className="link-button" onClick={clearFinished}>Limpiar lista</button>}
      </div>
      <ul>
        {queue.map((item) => (
          <li key={item.id} className={`upload-item is-${item.status}${['failed', 'rejected'].includes(item.status) ? ' is-error' : item.job && isJobReady(item.job) ? ' is-done' : ''}`}>
            <span className="upload-thumb">{item.preview ? <img src={item.preview} alt="" /> : <AlertCircle strokeWidth={1.8} aria-hidden="true" />}</span>
            <div className="upload-info">
              <strong title={item.name}>{item.name}</strong>
              <span>
                {item.message ?? `${formatBytes(item.size)} · ${item.job ? jobStatusLabel(item.job) : statusLabel[item.status]}`}
              </span>
              {busyStatuses.has(item.status) && <span className="upload-progress" aria-hidden="true"><i /></span>}
            </div>
            <span className="upload-status" aria-label={statusLabel[item.status]}>
              {busyStatuses.has(item.status) && <LoaderCircle className="spin" strokeWidth={2} />}
              {item.job && isJobReady(item.job) && <CheckCircle2 strokeWidth={2} />}
              {['failed', 'rejected', 'unknown'].includes(item.status) && <AlertCircle strokeWidth={2} />}
            </span>
            {item.file && !item.validationError && ['unknown', 'failed', 'rejected'].includes(item.status) && (
              <button type="button" className="link-button" onClick={() => retryUpload(item.id)}>{item.status === 'unknown' ? 'Consultar / reintentar' : 'Volver a subir'}</button>
            )}
            {finishedStatuses.has(item.status) && (
              <button type="button" className="icon-button is-small" onClick={() => dismissUpload(item.id)} aria-label={`Quitar ${item.name} de la lista`}><X strokeWidth={2} /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
