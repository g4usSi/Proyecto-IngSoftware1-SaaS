import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChartNoAxesColumn, CloudUpload, FolderOpen, HardDrive, History, House, Images, Menu, Moon, Sun, Trash2, Workflow, X } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { ServiceStatus } from '../components/ServiceStatus.jsx';
import { ToastProvider } from '../components/Toaster.jsx';
import { useSession } from '../features/auth/session.jsx';
import { LibraryProvider, useLibrary } from '../features/storage/library.jsx';
import { formatBytes } from '../features/storage/format.js';
import { describeQuota } from '../features/storage/quota.model.js';
import { SessionRequired } from '../features/auth/SessionRequired.jsx';
import { AccountMenu } from './AccountMenu.jsx';
import { useTheme } from './theme.jsx';

export const navGroups = [
  {
    label: 'Biblioteca',
    items: [
      { to: '/app', end: true, label: 'Resumen', icon: House },
      { to: '/app/storage', label: 'Mis imágenes', icon: Images, count: true },
      { to: '/app/albums', label: 'Álbumes', icon: FolderOpen },
      { to: '/app/upload', label: 'Subir', icon: CloudUpload, activity: true },
      { to: '/app/history', label: 'Historial', icon: History },
      { to: '/app/jobs', label: 'Procesos', icon: Workflow },
      { to: '/app/trash', label: 'Papelera', icon: Trash2 },
    ],
  },
  { label: 'Análisis', items: [{ to: '/app/insights', label: 'Ahorro', icon: ChartNoAxesColumn }] },
];
// Planes no va en la barra lateral: se abre desde "Mejorar plan" en el menú de la cuenta.
const titles = { ...Object.fromEntries(navGroups.flatMap((group) => group.items.map((item) => [item.to, item.label]))), '/app/plans': 'Mejorar plan', '/app/security': 'Cambiar contraseña' };

export function AppLayout() {
  const { session } = useSession();
  const authorization = useMemo(() => session ? { token: session.token } : null, [session]);
  if (!session) return <SessionRequired />;

  return (
    <ToastProvider>
      <LibraryProvider key={session.user.id} authorization={authorization}>
        <Shell />
      </LibraryProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { enabled, addFiles, error, items, unavailableItems, refresh } = useLibrary();
  const showLibraryNotice = ['/app', '/app/history', '/app/insights'].includes(pathname);
  const [drawer, setDrawer] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);

  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  // Soltar imágenes en cualquier pantalla del panel las sube y lleva a "Subir" para ver el progreso.
  useEffect(() => {
    if (!enabled) return undefined;
    let depth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
    const enter = (event) => { if (hasFiles(event)) { depth += 1; setPageDrag(true); } };
    const reset = () => { depth = 0; setPageDrag(false); };
    const leave = (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth || event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) reset();
    };
    const over = (event) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } };
    const drop = (event) => {
      reset();
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      // Copiar mientras el evento conserva acceso a DataTransfer.
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      addFiles(files);
      navigate('/app/upload');
    };
    const keydown = (event) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop, true);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop, true);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('keydown', keydown);
      reset();
    };
  }, [enabled, addFiles, navigate]);

  return (
    <div className={`app-shell${drawer ? ' is-drawer-open' : ''}`}>
      <aside className="app-sidebar" aria-label="Barra lateral">
        <div className="sidebar-top">
          <Brand light />
          <button type="button" className="sidebar-close" onClick={() => setDrawer(false)} aria-label="Cerrar menú"><X strokeWidth={2} /></button>
        </div>
        <SidebarNav />
        <UsageCard />
        <AccountMenu />
      </aside>
      <button type="button" className="drawer-scrim" aria-label="Cerrar menú" tabIndex={-1} onClick={() => setDrawer(false)} />

      <div className="app-main">
        <header className="app-topbar">
          <button type="button" className="icon-button topbar-menu" onClick={() => setDrawer(true)} aria-label="Abrir menú"><Menu strokeWidth={2} /></button>
          <nav className="breadcrumb" aria-label="Ubicación">
            <span>Tu espacio</span>
            <span aria-hidden="true">/</span>
            <strong aria-current="page">{titles[pathname] ?? 'SmartStorage'}</strong>
          </nav>
          <div className="topbar-actions">
            <ServiceStatus />
            <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}>
              <Sun className="sun" strokeWidth={2} aria-hidden="true" />
              <Moon className="moon" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="app-content" id="main-content" key={pathname}>
          {showLibraryNotice && error && (
            <div className="gallery-error" role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={refresh}>Volver a intentar</button></div>
          )}
          {showLibraryNotice && unavailableItems.length > 0 && (
            <p className="gallery-unavailable" role="status">Hay {unavailableItems.length} archivos no disponibles. Los totales de ahorro solo incluyen archivos disponibles. <Link to="/app/storage">Revisar imágenes</Link></p>
          )}
          {!(showLibraryNotice && error && !items.length) && <Outlet />}
        </main>
      </div>

      <div className={`page-drop${pageDrag ? ' is-active' : ''}`} aria-hidden="true">
        <div><CloudUpload strokeWidth={1.5} /><strong>Suelta para subir</strong><span>Las convertiremos a WebP</span></div>
      </div>
    </div>
  );
}

function SidebarNav() {
  const { enabled, loaded, items, nextCursor, queue } = useLibrary();
  const uploading = queue.filter((item) => ['waiting', 'uploading', 'unknown', 'queued', 'processing', 'converted'].includes(item.status)).length;

  return (
    <nav className="app-nav" aria-label="Secciones">
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <span className="sidebar-label">{group.label}</span>
          {group.items.map(({ to, end, label, icon: ItemIcon, count, activity }) => (
            <NavLink key={to} to={to} end={end}>
              <ItemIcon strokeWidth={1.9} aria-hidden="true" />
              <span>{label}</span>
              {count && enabled && loaded && <span className="nav-count">{items.length}{nextCursor ? '+' : ''}</span>}
              {activity && uploading > 0 && <span className="nav-activity" aria-label={`${uploading} en proceso`}>{uploading}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Solo informa el uso; la mejora de plan está en el menú de la cuenta. */
function UsageCard() {
  const { session } = useSession();
  const { enabled, quota, refreshQuota } = useLibrary();
  if (!session || !enabled) return null;
  // La capacidad del plan se mide con el tamaño original de cada subida.
  const data = quota?.data;
  const known = Boolean(data) && !quota.error;
  const used = Number(data?.usedBytes ?? 0);
  const reserved = Number(data?.reservedBytes ?? 0);
  const capacity = Number(data?.capacityBytes ?? 0);
  const ratio = capacity > 0 ? Math.min(1, (used + reserved) / capacity) : 0;
  const level = known ? describeQuota(data).meters[0].level : 'ok';

  return (
    <div className={`usage-card is-${level}`}>
      <div className="usage-head">
        <span><HardDrive strokeWidth={1.9} aria-hidden="true" />Almacenamiento</span>
        <span className="usage-plan">{known ? `${Math.round(ratio * 100)} %` : '…'}</span>
      </div>
      <div className="usage-bar" role="meter" aria-label="Espacio usado del plan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <i style={{ transform: `scaleX(${known ? Math.max(ratio, 0.012) : 0})` }} />
      </div>
      <p className="usage-text">
        {known ? <><strong>{formatBytes(used)}</strong> de {formatBytes(capacity)} · {data.plan.name}{reserved > 0 && <><br />{formatBytes(reserved)} reservados</>}</> : quota?.error ? 'Cuota no disponible' : 'Consultando cuota…'}
      </p>
      {quota?.error && <button type="button" className="link-button" onClick={refreshQuota}>Reintentar cuota</button>}
    </div>
  );
}
