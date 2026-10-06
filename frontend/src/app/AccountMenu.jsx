import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, CircleHelp, FlaskConical, House, LogIn, LogOut, Rocket } from 'lucide-react';
import { useSession } from '../features/auth/session.jsx';

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase() || '?';
}

/** Botón de cuenta al pie de la barra lateral: plan, mejora de plan y sesión. El tema vive en la barra superior. */
export function AccountMenu({ demoAccount, onExitDemo }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();
  const isDemo = !session && Boolean(demoAccount);
  const user = session?.user ?? demoAccount;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); rootRef.current?.querySelector('.account-trigger')?.focus(); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  const close = () => setOpen(false);

  return (
    <div className={`account${open ? ' is-open' : ''}`} ref={rootRef}>
      <div className="account-menu" id={menuId} role="menu" aria-label="Cuenta" inert={!open}>
        <div className="account-menu-head">
          <span className="account-avatar is-large" aria-hidden="true">{user ? initials(user.name) : '?'}</span>
          <div>
            <strong>{user?.name ?? 'Invitado'}</strong>
            <span>{user?.email ?? 'Sin sesión iniciada'}</span>
          </div>
        </div>

        {session && (
          <div className="account-plan">
            <div><span className="account-plan-label">Tu plan</span><strong>Free</strong></div>
            <Link to="/app/plans" className="account-upgrade" role="menuitem" onClick={close}><Rocket strokeWidth={2} aria-hidden="true" />Mejorar plan</Link>
          </div>
        )}

        {isDemo && <div className="account-plan"><div><span className="account-plan-label">Cuenta de prueba</span><strong>Plan Free</strong></div><Link to="/app/plans" className="account-upgrade" role="menuitem" onClick={close}><Rocket strokeWidth={2} aria-hidden="true" />Ver planes</Link></div>}

        <nav className="account-links">
          <Link to="/" role="menuitem" onClick={close}><House strokeWidth={1.9} aria-hidden="true" />Página de inicio</Link>
          <Link to="/#preguntas" role="menuitem" onClick={close}><CircleHelp strokeWidth={1.9} aria-hidden="true" />Ayuda y preguntas</Link>
          {session
            ? <button type="button" role="menuitem" className="is-danger" onClick={handleLogout}><LogOut strokeWidth={1.9} aria-hidden="true" />Cerrar sesión</button>
            : <>
                {isDemo && <button type="button" role="menuitem" onClick={() => { close(); onExitDemo(); navigate('/app/storage'); }}><FlaskConical strokeWidth={1.9} aria-hidden="true" />Cambiar cuenta demo</button>}
                <Link to="/login" role="menuitem" onClick={close}><LogIn strokeWidth={1.9} aria-hidden="true" />Iniciar sesión</Link>
              </>}
        </nav>
      </div>

      <button type="button" className="account-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>
        <span className="account-avatar" aria-hidden="true">{user ? initials(user.name) : '?'}</span>
        <span className="account-trigger-text">
          <strong>{user?.name ?? 'Invitado'}</strong>
          <span>{isDemo ? 'Demo local · Free' : user ? 'Plan Free' : 'Sin sesión'}</span>
        </span>
        <ChevronsUpDown className="account-chevron" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
