import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, ImageOff, LayoutGrid, List, LoaderCircle, RefreshCw, Search, SearchX } from 'lucide-react';
import { formatBytes, formatFullDate, formatPercent, formatRelative, savingRatio } from './format.js';
import { useLibrary } from './library.jsx';
import { ImagePreview } from './ImagePreview.jsx';

const sorters = {
  recent: { label: 'Más recientes', fn: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) },
  oldest: { label: 'Más antiguas', fn: (a, b) => new Date(a.createdAt) - new Date(b.createdAt) },
  name: { label: 'Nombre (A–Z)', fn: (a, b) => a.originalName.localeCompare(b.originalName, 'es') },
  saving: { label: 'Mayor ahorro', fn: (a, b) => savingRatio(b) - savingRatio(a) },
  size: { label: 'Más pesadas', fn: (a, b) => Number(b.originalSizeBytes) - Number(a.originalSizeBytes) },
};

/** Carga la miniatura (el WebP real) cuando la tarjeta se acerca a la pantalla. */
function useThumbnail(file) {
  const { getThumbnail } = useLibrary();
  const ref = useRef(null);
  const [state, setState] = useState({ url: null, failed: false });

  useEffect(() => {
    let active = true;
    const start = () => getThumbnail(file).then((url) => { if (active) setState({ url, failed: !url }); });
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') { start(); return () => { active = false; }; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { observer.disconnect(); start(); }
    }, { rootMargin: '300px' });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, [file, getThumbnail]);

  return [ref, state];
}

export function Thumb({ file, className }) {
  const [ref, { url, failed }] = useThumbnail(file);
  const [loaded, setLoaded] = useState(false);
  return (
    <span ref={ref} className={`thumb ${className}${loaded ? ' is-loaded' : ''}`}>
      {url && <img src={url} alt="" onLoad={() => setLoaded(true)} />}
      {failed && <ImageOff className="thumb-fallback" strokeWidth={1.6} aria-hidden="true" />}
    </span>
  );
}

export function SavingBadge({ file }) {
  const ratio = savingRatio(file);
  return <span className={`saving-badge${ratio < 0 ? ' is-negative' : ''}`} title="Diferencia entre el original y el WebP">{formatPercent(ratio)}</span>;
}

export function Gallery() {
  const navigate = useNavigate();
  const { items, loading, loaded, error, nextCursor, refresh, loadMore, download, downloadingId } = useLibrary();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid');
  const [previewId, setPreviewId] = useState(null);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es');
    const filtered = term ? items.filter((file) => file.originalName.toLocaleLowerCase('es').includes(term)) : items;
    return [...filtered].sort(sorters[sort].fn);
  }, [items, query, sort]);

  const previewIndex = visible.findIndex((file) => file.id === previewId);
  const initialLoading = loading && !loaded;

  return (
    <section className="gallery" aria-labelledby="gallery-title" aria-busy={loading}>
      <div className="gallery-toolbar">
        <div className="gallery-title">
          <h2 id="gallery-title">Todas</h2>
          {loaded && <span className="count-pill">{items.length}{nextCursor ? '+' : ''}</span>}
        </div>
        <div className="gallery-controls">
          <label className="search-field">
            <Search strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Buscar por nombre</span>
            <input type="search" placeholder="Buscar por nombre…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="select-field">
            <span className="sr-only">Ordenar</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {Object.entries(sorters).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <div className="view-switch" role="radiogroup" aria-label="Vista" style={{ '--index': view === 'grid' ? 0 : 1 }}>
            <span className="view-switch-thumb" aria-hidden="true" />
            <button type="button" role="radio" aria-checked={view === 'grid'} onClick={() => setView('grid')} aria-label="Cuadrícula" title="Cuadrícula"><LayoutGrid strokeWidth={2} /></button>
            <button type="button" role="radio" aria-checked={view === 'list'} onClick={() => setView('list')} aria-label="Lista" title="Lista"><List strokeWidth={2} /></button>
          </div>
          <button type="button" className={`icon-button${loading ? ' is-spinning' : ''}`} onClick={refresh} disabled={loading} aria-label="Actualizar" title="Actualizar"><RefreshCw strokeWidth={2} /></button>
        </div>
      </div>

      {error && (
        <div className="gallery-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={refresh}>Volver a intentar</button>
        </div>
      )}

      {initialLoading && (
        <div className="grid-view" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <div className="img-card is-skeleton" key={index}><span className="thumb" /><span className="sk-line" /><span className="sk-line short" /></div>)}
        </div>
      )}

      {loaded && !error && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-art" aria-hidden="true"><span /><span /><span /></div>
          <h3>Tu biblioteca está vacía</h3>
          <p>Sube tu primera imagen: la convertimos a WebP y la verás aquí al instante.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/app/upload')}>Subir mi primera imagen</button>
        </div>
      )}

      {items.length > 0 && visible.length === 0 && (
        <div className="empty-state is-compact">
          <SearchX strokeWidth={1.6} aria-hidden="true" />
          <h3>Sin resultados para “{query}”</h3>
          <p>{nextCursor ? 'La búsqueda solo revisa las imágenes cargadas. Carga más para buscar en el resto.' : 'Prueba con otra parte del nombre.'}</p>
        </div>
      )}

      {visible.length > 0 && view === 'grid' && (
        <ul className="grid-view">
          {visible.map((file, index) => (
            <li className="img-card" key={file.id} style={{ '--i': Math.min(index, 12) }}>
              <button type="button" className="img-card-media" onClick={() => setPreviewId(file.id)} aria-label={`Ver ${file.originalName}`}>
                <Thumb file={file} className="is-card" />
                <SavingBadge file={file} />
                <span className="img-card-overlay" aria-hidden="true"><Eye strokeWidth={2} />Ver</span>
              </button>
              <div className="img-card-body">
                <div>
                  <h3 title={file.originalName}>{file.originalName}</h3>
                  <p><time dateTime={file.createdAt} title={formatFullDate(file.createdAt)}>{formatRelative(file.createdAt)}</time> · {formatBytes(file.optimizedSizeBytes)}</p>
                </div>
                <button type="button" className="icon-button" onClick={() => download(file)} disabled={Boolean(downloadingId)} aria-label={`Descargar ${file.originalName} en WebP`} title="Descargar WebP">
                  {downloadingId === file.id ? <LoaderCircle className="spin" strokeWidth={2} /> : <Download strokeWidth={2} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {visible.length > 0 && view === 'list' && (
        <div className="list-view" role="table" aria-label="Imágenes">
          <div className="list-row is-head" role="row">
            <span role="columnheader">Imagen</span><span role="columnheader">Original</span><span role="columnheader">WebP</span><span role="columnheader">Ahorro</span><span role="columnheader"><span className="sr-only">Acciones</span></span>
          </div>
          {visible.map((file, index) => (
            <div className="list-row" role="row" key={file.id} style={{ '--i': Math.min(index, 12) }}>
              <span role="cell" className="list-name">
                <button type="button" className="list-thumb" onClick={() => setPreviewId(file.id)} aria-label={`Ver ${file.originalName}`}><Thumb file={file} className="is-small" /></button>
                <span><strong title={file.originalName}>{file.originalName}</strong><time dateTime={file.createdAt}>{formatFullDate(file.createdAt)}</time></span>
              </span>
              <span role="cell" className="list-num">{formatBytes(file.originalSizeBytes)}</span>
              <span role="cell" className="list-num">{formatBytes(file.optimizedSizeBytes)}</span>
              <span role="cell"><SavingBadge file={file} /></span>
              <span role="cell" className="list-actions">
                <button type="button" className="icon-button" onClick={() => setPreviewId(file.id)} aria-label={`Ver ${file.originalName}`} title="Ver"><Eye strokeWidth={2} /></button>
                <button type="button" className="icon-button" onClick={() => download(file)} disabled={Boolean(downloadingId)} aria-label={`Descargar ${file.originalName} en WebP`} title="Descargar WebP">
                  {downloadingId === file.id ? <LoaderCircle className="spin" strokeWidth={2} /> : <Download strokeWidth={2} />}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="gallery-more">
          <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loading}>
            {loading ? <><LoaderCircle className="spin" strokeWidth={2} aria-hidden="true" />Cargando…</> : 'Cargar más imágenes'}
          </button>
        </div>
      )}

      {previewIndex >= 0 && (
        <ImagePreview
          file={visible[previewIndex]}
          position={`${previewIndex + 1} de ${visible.length}`}
          onClose={() => setPreviewId(null)}
          onPrev={previewIndex > 0 ? () => setPreviewId(visible[previewIndex - 1].id) : null}
          onNext={previewIndex < visible.length - 1 ? () => setPreviewId(visible[previewIndex + 1].id) : null}
        />
      )}
    </section>
  );
}
