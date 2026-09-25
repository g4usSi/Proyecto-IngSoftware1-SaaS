import { Link } from 'react-router-dom';
import { CloudUpload, ShieldCheck } from 'lucide-react';
import { Gallery } from './Gallery.jsx';
import { useLibrary } from './library.jsx';

/** Mis imágenes: la galería completa. */
export function StoragePage() {
  const { stats } = useLibrary();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Biblioteca</span>
          <h1>Mis imágenes</h1>
          <p>{stats.loaded ? `${stats.count}${stats.complete ? '' : '+'} ${stats.count === 1 ? 'imagen' : 'imágenes'} en WebP. Haz clic en una para verla en grande.` : 'Cargando…'}</p>
        </div>
        <Link className="btn btn-secondary" to="/app/upload"><CloudUpload strokeWidth={2} aria-hidden="true" />Subir</Link>
      </header>
      <Gallery />
      <p className="privacy-footnote"><ShieldCheck strokeWidth={2} aria-hidden="true" />Solo tú puedes ver y descargar estas imágenes. Guardamos únicamente la versión WebP, sin datos de ubicación.</p>
    </div>
  );
}
