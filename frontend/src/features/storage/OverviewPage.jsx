import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CloudUpload, Images, Scale, TrendingDown, Weight } from 'lucide-react';
import { RowsSkeleton } from '../../components/Skeletons.jsx';
import { useSession } from '../auth/session.jsx';
import { formatBytes, formatRelative } from './format.js';
import { SavingBadge, Thumb } from './Gallery.jsx';
import { useLibrary } from './library.jsx';
import { StatCard } from './StatCard.jsx';
import { PlanPromotion } from '../subscriptions/PlanPromotion.jsx';
import { QuotaSummary } from './QuotaSummary.jsx';

export function OverviewPage() {
  const { session } = useSession();
  const { stats, items, loaded, error, refresh } = useLibrary();
  // Si el resumen falla no hay cifras: "No disponible", ni un esqueleto eterno ni un 0.
  const statsSettled = stats.loaded || Boolean(stats.error);
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const recent = useMemo(() => [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4), [items]);
  const saved = stats.originalBytes - stats.webpBytes;
  const grew = saved < 0;
  const direction = grew ? 'más' : 'menos';
  const percent = stats.savedRatio === null ? null : Math.round(stats.savedRatio * 100);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Resumen</span>
          <h1>{firstName ? `Hola, ${firstName}` : 'Tu espacio'}</h1>
          <p>{!statsSettled ? 'Cargando tu biblioteca…' : stats.loaded && stats.count === 0 ? 'Todavía no tienes imágenes. Empieza subiendo la primera.' : 'Así va tu biblioteca.'}</p>
        </div>
        <Link className="btn btn-primary" to="/app/upload"><CloudUpload strokeWidth={2} aria-hidden="true" />Subir imágenes</Link>
      </header>

      <PlanPromotion pathname="/app" />

      {stats.error && <div className="gallery-error" role="alert"><p>{stats.error}</p><button type="button" className="btn btn-secondary" onClick={refresh}>Volver a intentar</button></div>}

      <div className="stats-grid">
        <StatCard icon={Images} label="Imágenes" value={stats.loaded ? stats.count : null} format={(v) => String(Math.round(v))} ready={statsSettled} index={0} />
        <StatCard icon={Weight} label="Peso original" value={stats.loaded ? stats.originalBytes : null} format={formatBytes} ready={statsSettled} index={1} />
        <StatCard icon={Scale} label="Peso en WebP" value={stats.loaded ? stats.webpBytes : null} format={formatBytes} ready={statsSettled} index={2} />
        <StatCard icon={TrendingDown} label={grew ? 'Aumento de peso' : 'Ahorro'} value={percent === null ? null : Math.abs(percent)} format={(v) => `${Math.round(v)} %`} ready={statsSettled} accent={!grew} index={3} />
      </div>

      <QuotaSummary upgrade={false} />

      <div className="overview-grid">
        <section className="panel" aria-labelledby="recent-title">
          <div className="panel-head">
            <h2 id="recent-title">Subidas recientes</h2>
            {recent.length > 0 && <Link className="panel-link" to="/app/storage">Ver todas <ArrowRight strokeWidth={2} aria-hidden="true" /></Link>}
          </div>
          {!loaded && <RowsSkeleton rows={3} panel={false} label="Cargando tus subidas recientes…" />}
          {loaded && !error && recent.length === 0 && (
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
          <div className="ring" style={{ '--p': percent ? Math.max(0, percent) : 0 }} role="img" aria-label={!statsSettled ? 'Calculando tu ahorro' : percent === null ? 'Ahorro no disponible' : `${Math.abs(percent)} % ${direction} peso que los originales`}>
            <div><strong>{!statsSettled ? <span className="sk-line ring-sk" /> : percent === null ? '—' : `${Math.abs(percent)} %`}</strong><span>{!statsSettled ? 'calculando' : percent === null ? 'no disponible' : `${direction} peso`}</span></div>
          </div>
          <p className="saving-text">{!statsSettled ? 'Calculando cuánto ahorras…' : !stats.loaded ? 'No pudimos calcular tu ahorro por ahora.' : stats.unavailableCount > 0 ? 'Falta algún archivo en el servidor, así que el ahorro no se puede calcular por ahora.' : stats.count ? <>Tus WebP pesan <strong>{formatBytes(Math.abs(saved))}</strong> {direction} que los originales.</> : 'Sube imágenes para ver cuánto ahorras.'}</p>
        </section>
      </div>
    </div>
  );
}
