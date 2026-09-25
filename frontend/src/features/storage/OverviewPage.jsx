import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CloudUpload, Images, Scale, TrendingDown, Weight } from 'lucide-react';
import { useSession } from '../auth/session.jsx';
import { formatBytes, formatRelative } from './format.js';
import { SavingBadge, Thumb } from './Gallery.jsx';
import { useLibrary } from './library.jsx';
import { StatCard } from './StatCard.jsx';

export function OverviewPage() {
  const { session } = useSession();
  const { stats, items, loaded } = useLibrary();
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const recent = useMemo(() => [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4), [items]);
  const saved = Math.max(0, stats.originalBytes - stats.webpBytes);
  const percent = Math.round(stats.savedRatio * 100);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Resumen</span>
          <h1>{firstName ? `Hola, ${firstName}` : 'Tu espacio'}</h1>
          <p>{!loaded ? 'Cargando tu biblioteca…' : stats.count === 0 ? 'Todavía no tienes imágenes. Empieza subiendo la primera.' : 'Así va tu biblioteca.'}</p>
        </div>
        <Link className="btn btn-primary" to="/app/upload"><CloudUpload strokeWidth={2} aria-hidden="true" />Subir imágenes</Link>
      </header>

      <div className="stats-grid">
        <StatCard icon={Images} label="Imágenes" value={stats.count} format={(v) => `${Math.round(v)}${stats.complete ? '' : '+'}`} ready={stats.loaded} index={0} />
        <StatCard icon={Weight} label="Peso original" value={stats.originalBytes} format={formatBytes} ready={stats.loaded} index={1} />
        <StatCard icon={Scale} label="Peso en WebP" value={stats.webpBytes} format={formatBytes} ready={stats.loaded} index={2} />
        <StatCard icon={TrendingDown} label="Ahorro" value={stats.savedRatio * 100} format={(v) => `${Math.round(v)} %`} ready={stats.loaded} accent index={3} />
      </div>

      <div className="overview-grid">
        <section className="panel" aria-labelledby="recent-title">
          <div className="panel-head">
            <h2 id="recent-title">Subidas recientes</h2>
            {recent.length > 0 && <Link className="panel-link" to="/app/storage">Ver todas <ArrowRight strokeWidth={2} aria-hidden="true" /></Link>}
          </div>
          {loaded && recent.length === 0 && (
            <div className="panel-empty">
              <p>Aquí aparecerán tus últimas imágenes.</p>
              <Link className="btn btn-secondary" to="/app/upload">Subir la primera</Link>
            </div>
          )}
          {recent.length > 0 && (
            <ul className="recent-grid">
              {recent.map((file, index) => (
                <li key={file.id} style={{ '--i': index }}>
                  <Link to="/app/storage" className="recent-item" title={file.originalName}>
                    <Thumb file={file} className="is-card" />
                    <SavingBadge file={file} />
                    <span className="recent-name">{file.originalName}</span>
                    <span className="recent-meta">{formatRelative(file.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel saving-panel" aria-labelledby="saving-title">
          <div className="panel-head">
            <h2 id="saving-title">Tu ahorro</h2>
            <Link className="panel-link" to="/app/insights">Detalle <ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
          </div>
          <div className="ring" style={{ '--p': loaded ? Math.max(0, percent) : 0 }} role="img" aria-label={`${percent} % menos peso que los originales`}>
            <div><strong>{loaded ? `${percent} %` : '—'}</strong><span>menos peso</span></div>
          </div>
          <p className="saving-text">{stats.count ? <>Tus WebP pesan <strong>{formatBytes(saved)}</strong> menos que los originales.</> : 'Sube imágenes para ver cuánto ahorras.'}</p>
        </section>
      </div>
    </div>
  );
}
