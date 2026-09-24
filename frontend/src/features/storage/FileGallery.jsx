import { Icon } from '../../components/Icon.jsx';
import { PendingState } from '../../components/PendingState.jsx';

const byteFormat = new Intl.NumberFormat('es-GT', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short' });

function formatBytes(value) {
  if (value === null || value === undefined || value === '') return 'No disponible';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'No disponible';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = bytes > 0 ? Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(1000)), 0), units.length - 1) : 0;
  return `${byteFormat.format(bytes / 1000 ** index)} ${units[index]}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Fecha no disponible' : dateFormat.format(date);
}

const statusLabels = { ready: 'Lista', processing: 'En proceso', failed: 'No disponible' };

export function FileGallery({ files, loading, error, nextCursor, onRefresh, onLoadMore, onRetry, onDownload, downloadingId, downloadError }) {
  return (
    <section className="library-panel storage-gallery" aria-labelledby="storage-gallery-title" aria-busy={loading}>
      <div className="panel-heading"><span id="storage-gallery-title"><Icon name="image" /> Mis imágenes</span><button type="button" className="storage-link-button" onClick={onRefresh} disabled={loading}>Actualizar</button></div>
      {error && <div className="storage-gallery-feedback" role="alert"><p>{error}</p><button className="button button-dark button-small" type="button" onClick={onRetry} disabled={loading}>Volver a intentar</button></div>}
      {downloadError && <p className="storage-message storage-message-error storage-download-feedback" role="alert">{downloadError}</p>}
      {loading && <p className="storage-loading" role="status">Cargando imágenes…</p>}
      {!loading && !error && files.length === 0 && <PendingState icon="image" title="Todavía no tienes imágenes." eyebrow="Tu biblioteca">Selecciona tu primera imagen y súbela para verla aquí.</PendingState>}
      {files.length > 0 && <ul className="storage-file-list">{files.map((file) => <li className="storage-file-row" key={file.id}>
        <div className="storage-file-name"><Icon name="image" /><div><h2>{file.originalName}</h2><time dateTime={file.createdAt}>{formatDate(file.createdAt)}</time></div></div>
        <dl className="storage-file-sizes"><div><dt>Original</dt><dd>{formatBytes(file.originalSizeBytes)}</dd></div><div><dt>WebP</dt><dd>{formatBytes(file.optimizedSizeBytes)}</dd></div></dl>
        <div className="storage-file-actions"><span className="small-badge">{statusLabels[file.status] ?? 'No disponible'}</span><button type="button" className="button button-dark button-small" onClick={() => onDownload(file)} disabled={file.status !== 'ready' || Boolean(downloadingId)} aria-label={`Descargar ${file.originalName} como WebP`}>{downloadingId === file.id ? 'Preparando…' : 'Descargar WebP'}</button></div>
      </li>)}</ul>}
      {nextCursor && <div className="storage-load-more"><button className="button button-dark button-small" type="button" disabled={loading} onClick={onLoadMore}>{loading ? 'Cargando…' : 'Cargar más'}</button></div>}
      <div className="library-note"><Icon name="lock" /><span>Solo se muestran los archivos de la cuenta seleccionada. Las descargas son WebP.</span></div>
    </section>
  );
}
