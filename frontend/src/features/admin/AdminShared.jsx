import { ChevronLeft, ChevronRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { useSession } from '../auth/session.jsx';
import './admin.css';

export const isAdmin = (session) => session?.user?.role === 'admin';

/** Solo oculta la interfaz: la protección real es del servidor (403 a clientes). */
export function AdminGate({ children }) {
  const { session } = useSession();
  if (isAdmin(session)) return children;
  return (
    <div className="panel panel-empty">
      <ShieldAlert aria-hidden="true" className="panel-empty-icon" />
      <h2>No tienes permiso para ver esta sección</h2>
      <p>La administración solo está disponible para cuentas administradoras.</p>
    </div>
  );
}

export function AdminHead({ title, description, onRefresh, loading, children }) {
  return (
    <header className="page-head">
      <div><span className="kicker">Administración</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
      <div className="admin-head-actions">
        {children}
        {onRefresh && (
          <button type="button" className="icon-button" onClick={onRefresh} disabled={loading} aria-label="Actualizar" title="Actualizar">
            <RefreshCw className={loading ? 'spin' : undefined} strokeWidth={2} />
          </button>
        )}
      </div>
    </header>
  );
}

/** Error con reintento. 403 = sin permiso (no es un fallo de red). */
export function QueryError({ query }) {
  if (!query.error) return null;
  if (query.forbidden) return <div className="gallery-error" role="alert"><p>Tu cuenta ya no tiene permiso de administración.</p></div>;
  return <div className="gallery-error" role="alert"><p>{query.error}</p><button type="button" className="btn btn-secondary" onClick={query.reload}>Volver a intentar</button></div>;
}

export function StatusPill({ tone = 'muted', children }) {
  return <span className={`status-pill is-${tone}`}>{children}</span>;
}

/** Consulta en curso cuando todavía no hay datos que mostrar. */
export const isFirstLoad = (query) => !query.data && !query.error;

/** Paginación limit/offset; `total` llega como string en estas rutas. */
export function OffsetPager({ total, limit, offset, onChange, loading }) {
  const count = Number(total);
  if (!(count > limit)) return count > 0 ? <p className="pager-count">{count} {count === 1 ? 'resultado' : 'resultados'}</p> : null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(count / limit);
  return (
    <nav className="pager" aria-label="Páginas">
      <button type="button" className="icon-button" onClick={() => onChange(offset - limit)} disabled={offset === 0 || loading} aria-label="Página anterior"><ChevronLeft strokeWidth={2} /></button>
      <span>Página {page} de {pages} · {count} resultados</span>
      <button type="button" className="icon-button" onClick={() => onChange(offset + limit)} disabled={page >= pages || loading} aria-label="Página siguiente"><ChevronRight strokeWidth={2} /></button>
    </nav>
  );
}

/** Barra de porcentaje; null = sin plan o sin dato, nunca se dibuja como 0. */
export function UsageBar({ percent }) {
  if (percent === null || percent === undefined) return <span className="muted">Sin plan</span>;
  const value = Number(percent);
  const tone = value >= 100 ? 'danger' : value >= 80 ? 'warn' : 'ok';
  return (
    <span className={`usage-meter is-${tone}`}>
      <span className="usage-meter-track" aria-hidden="true"><i style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span>{value.toFixed(1)} %</span>
    </span>
  );
}
