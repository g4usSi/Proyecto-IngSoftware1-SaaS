import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChartNoAxesColumn, CloudUpload, FlaskConical, HardDrive, History, House, Images, Menu, Moon, Sun, X } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { ServiceStatus } from '../components/ServiceStatus.jsx';
import { ToastProvider } from '../components/Toaster.jsx';
import { useSession } from '../features/auth/session.jsx';
import { LibraryProvider, useLibrary } from '../features/storage/library.jsx';
import { formatBytes } from '../features/storage/format.js';
import { NoIdentity } from '../features/storage/NoIdentity.jsx';
import { FREE_CAPACITY_BYTES } from '../features/subscriptions/plans.data.js';
import { AccountMenu } from './AccountMenu.jsx';
import { useTheme } from './theme.jsx';

const DemoContext = createContext({ demoAccount: null, setDemoAccount: () => {} });
export const useDemoAccount = () => useContext(DemoContext);

export const navGroups = [
  {
    label: 'Biblioteca',
    items: [
      { to: '/app', end: true, label: 'Resumen', icon: House },
      { to: '/app/storage', label: 'Mis imágenes', icon: Images, count: true },
      { to: '/app/upload', label: 'Subir', icon: CloudUpload, activity: true },
      { to: '/app/history', label: 'Historial', icon: History },
    ],
  },
  { label: 'Análisis', items: [{ to: '/app/insights', label: 'Ahorro', icon: ChartNoAxesColumn }] },
];
// Planes no va en la barra lateral: se abre desde "Mejorar plan" en el menú de la cuenta.
const titles = { ...Object.fromEntries(navGroups.flatMap((group) => group.items.map((item) => [item.to, item.label]))), '/app/plans': 'Mejorar plan' };

export function AppLayout() {
  const { session } = useSession();
  const [demoAccount, setDemoAccount] = useState(null);
  useEffect(() => { if (session) setDemoAccount(null); }, [session]);
  // Con sesión se usa el JWT; sin sesión, solo la cuenta demo elegida explícitamente (modo dev:demo).
  const authorization = useMemo(() => {
    if (session) return { token: session.token };
    if (demoAccount) return { headers: { 'X-Storage-Demo-User': demoAccount.id } };
    return null;
  }, [session, demoAccount]);
  const identity = session ? `session:${session.user.id}` : demoAccount ? `demo:${demoAccount.id}` : 'none';

  return (
    <ToastProvider>
      <DemoContext.Provider value={{ demoAccount, setDemoAccount }}>
        <LibraryProvider key={identity} authorization={authorization}>
          <Shell />
        </LibraryProvider>
      </DemoContext.Provider>
    </ToastProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { session } = useSession();
  const { demoAccount, setDemoAccount } = useDemoAccount();
  const { enabled, addFiles } = useLibrary();
  const [drawer, setDrawer] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);
  const needsLibrary = pathname !== '/app/plans';

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
    const leave = (event) => { if (hasFiles(event)) { depth = Math.max(0, depth - 1); if (!depth) setPageDrag(false); } };
    const over = (event) => { if (hasFiles(event)) event.preventDefault(); };
    const drop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setPageDrag(false);
      addFiles(event.dataTransfer.files);
      navigate('/app/upload');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
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
        <AccountMenu demoAccount={!session ? demoAccount : null} onExitDemo={() => setDemoAccount(null)} />
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
          {demoAccount && !session && (
            <div className="demo-banner" role="status">
              <FlaskConical strokeWidth={2} aria-hidden="true" />
              <span>Modo demo: estás usando <strong>{demoAccount.name}</strong>. No es un inicio de sesión real.</span>
              <button type="button" className="link-button" onClick={() => setDemoAccount(null)}>Cambiar de cuenta</button>
            </div>
          )}
          {needsLibrary && !enabled ? <NoIdentity /> : <Outlet />}
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
  const uploading = queue.filter((item) => item.status === 'queued' || item.status === 'uploading').length;

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
  const { demoAccount } = useDemoAccount();
  const { enabled, stats } = useLibrary();
  if ((!session && !demoAccount) || !enabled) return null;
  // La capacidad del plan se mide con el tamaño original de cada subida.
  const ratio = Math.min(1, stats.originalBytes / FREE_CAPACITY_BYTES);
  const known = stats.loaded;

  return (
    <div className="usage-card">
      <div className="usage-head">
        <span><HardDrive strokeWidth={1.9} aria-hidden="true" />Almacenamiento</span>
        <span className="usage-plan">{known ? `${Math.round(ratio * 100)} %` : '…'}</span>
      </div>
      <div className="usage-bar" role="meter" aria-label="Espacio usado del plan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <i style={{ transform: `scaleX(${known ? Math.max(ratio, 0.012) : 0})` }} />
      </div>
      <p className="usage-text">
        {known ? <><strong>{stats.complete ? '' : 'Al menos '}{formatBytes(stats.originalBytes)}</strong> de 2 GB · Plan Free</> : 'Calculando…'}
      </p>
    </div>
  );
}
