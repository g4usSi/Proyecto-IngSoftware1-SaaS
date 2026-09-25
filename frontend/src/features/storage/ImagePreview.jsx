import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from 'lucide-react';
import { formatBytes, formatFullDate, formatPercent, savingRatio } from './format.js';
import { useLibrary } from './library.jsx';
import { webpFilename } from './storage.api.js';

/** Vista previa grande con detalles; ← → navega, Esc cierra. */
export function ImagePreview({ file, position, onClose, onPrev, onNext }) {
  const { getThumbnail, download, downloadingId } = useLibrary();
  const [url, setUrl] = useState(null);
  const [dimensions, setDimensions] = useState(null);
  const closeRef = useRef(null);
  const restoreFocus = useRef(document.activeElement);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setDimensions(null);
    getThumbnail(file).then((value) => { if (active) setUrl(value); });
    return () => { active = false; };
  }, [file, getThumbnail]);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = restoreFocus.current;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; previous?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && onPrev) onPrev();
      if (event.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const ratio = savingRatio(file);

  return createPortal(
    <div className="preview-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="preview" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <div className="preview-stage">
          {url ? <img key={url} src={url} alt={file.originalName} onLoad={(event) => setDimensions([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])} /> : <LoaderCircle className="spin preview-loader" strokeWidth={1.6} aria-label="Cargando imagen" />}
          {onPrev && <button type="button" className="preview-nav is-prev" onClick={onPrev} aria-label="Imagen anterior"><ChevronLeft strokeWidth={2} /></button>}
          {onNext && <button type="button" className="preview-nav is-next" onClick={onNext} aria-label="Imagen siguiente"><ChevronRight strokeWidth={2} /></button>}
        </div>
        <aside className="preview-info">
          <div className="preview-head">
            <span className="preview-position">{position}</span>
            <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Cerrar vista previa"><X strokeWidth={2} /></button>
          </div>
          <h2 id="preview-title">{file.originalName}</h2>
          <p className="preview-date">{formatFullDate(file.createdAt)}</p>

          <div className="preview-saving">
            <span>Ahorro</span>
            <strong className={ratio < 0 ? 'is-negative' : undefined}>{formatPercent(ratio)}</strong>
            <div className="compare-bars" aria-hidden="true">
              <i style={{ '--w': '100%' }} />
              <i className="is-webp" style={{ '--w': `${Math.max(2, Math.min(100, (Number(file.optimizedSizeBytes) / Math.max(1, Number(file.originalSizeBytes))) * 100))}%` }} />
            </div>
          </div>

          <dl className="preview-details">
            <div><dt>Original</dt><dd>{formatBytes(file.originalSizeBytes)}</dd></div>
            <div><dt>WebP</dt><dd>{formatBytes(file.optimizedSizeBytes)}</dd></div>
            <div><dt>Dimensiones</dt><dd>{dimensions ? `${dimensions[0]} × ${dimensions[1]} px` : '—'}</dd></div>
            <div><dt>Archivo</dt><dd title={webpFilename(file.originalName)}>{webpFilename(file.originalName)}</dd></div>
          </dl>

          <button type="button" className="btn btn-primary preview-download" onClick={() => download(file)} disabled={Boolean(downloadingId)}>
            {downloadingId === file.id ? <LoaderCircle className="spin" strokeWidth={2} aria-hidden="true" /> : <Download strokeWidth={2} aria-hidden="true" />}
            Descargar WebP
          </button>
          <p className="preview-note">Sin metadatos EXIF ni ubicación · misma resolución que el original</p>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
