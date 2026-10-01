import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CloudUpload, LoaderCircle, X } from 'lucide-react';
import { IMAGE_ACCEPT } from './storage.api.js';
import { formatBytes, formatPercent, savingRatio } from './format.js';
import { useLibrary } from './library.jsx';

const statusLabel = { queued: 'En cola', uploading: 'Convirtiendo a WebP…', done: 'Guardada', error: 'No se subió' };

/** Única entrada de subida: toda la zona es clicable y acepta arrastrar varias imágenes. */
export function UploadDropzone() {
  const { addFiles } = useLibrary();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const open = () => inputRef.current?.click();

  return (
    <div
      className={`dropzone${dragging ? ' is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-describedby="dropzone-help"
      onClick={open}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); addFiles(event.dataTransfer.files); }}
    >
      <span className="dropzone-icon" aria-hidden="true"><CloudUpload strokeWidth={1.6} /></span>
      <h2>{dragging ? 'Suelta para subir' : 'Arrastra tus imágenes o haz clic para elegirlas'}</h2>
      <p id="dropzone-help">Puedes elegir varias a la vez. Se suben una por una y se convierten a WebP.</p>
      <input
        ref={inputRef} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
      />
    </div>
  );
}

/** Lista de subidas de esta sesión con su estado. */
export function UploadQueue() {
  const { queue, dismissUpload, clearFinished } = useLibrary();
  if (!queue.length) return null;
  const busy = queue.some((item) => item.status === 'uploading' || item.status === 'queued');
  const finished = queue.some((item) => item.status === 'done' || item.status === 'error');

  return (
    <section className="panel upload-queue" aria-labelledby="queue-title">
      <div className="panel-head">
        <h2 id="queue-title">{busy ? 'Subiendo…' : 'Subidas de esta sesión'}</h2>
        {finished && <button type="button" className="link-button" onClick={clearFinished}>Limpiar lista</button>}
      </div>
      <ul>
        {queue.map((item) => (
          <li key={item.id} className={`upload-item is-${item.status}`}>
            <span className="upload-thumb">{item.preview ? <img src={item.preview} alt="" /> : <AlertCircle strokeWidth={1.8} aria-hidden="true" />}</span>
            <div className="upload-info">
              <strong title={item.name}>{item.name}</strong>
              <span>
                {item.status === 'done' && item.image
                  ? <>{formatBytes(item.image.originalSizeBytes)} → {formatBytes(item.image.optimizedSizeBytes)} <b>{formatPercent(savingRatio(item.image))}</b></>
                  : item.status === 'error' ? item.message : `${formatBytes(item.size)} · ${statusLabel[item.status]}`}
              </span>
              {item.status === 'uploading' && <span className="upload-progress" aria-hidden="true"><i /></span>}
            </div>
            <span className="upload-status" aria-label={statusLabel[item.status]}>
              {item.status === 'uploading' && <LoaderCircle className="spin" strokeWidth={2} />}
              {item.status === 'done' && <CheckCircle2 strokeWidth={2} />}
              {item.status === 'error' && <AlertCircle strokeWidth={2} />}
            </span>
            {(item.status === 'done' || item.status === 'error') && (
              <button type="button" className="icon-button is-small" onClick={() => dismissUpload(item.id)} aria-label={`Quitar ${item.name} de la lista`}><X strokeWidth={2} /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
