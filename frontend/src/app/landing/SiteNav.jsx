import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Brand } from '../../components/Brand.jsx';
import { useSession } from '../../features/auth/session.jsx';

export const sections = [
  { id: 'proceso', label: 'Cómo funciona' },
  { id: 'ahorro', label: 'Ahorro' },
  { id: 'privacidad', label: 'Privacidad' },
  { id: 'planes', label: 'Planes' },
  { id: 'preguntas', label: 'Preguntas' },
];

export function SiteNav() {
  const { session } = useSession();
  const navRef = useRef(null);
  const linksRef = useRef(null);
  const progressRef = useRef(null);
  const [active, setActive] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [indicator, setIndicator] = useState({ x: 0, width: 0, visible: false });
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Compactar, ocultar al bajar / mostrar al subir y barra de progreso de lectura.
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setCompact(y > 40);
      setHidden(y > 320 && y > lastY + 4);
      if (y < lastY - 4 || y < 320) setHidden(false);
      lastY = y;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressRef.current?.style.setProperty('--progress', max > 0 ? String(y / max) : '0');
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  // Sección activa según lo que se ve en pantalla.
  useEffect(() => {
    const elements = sections.map(({ id }) => document.getElementById(id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) setActive(entry.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    elements.forEach((element) => observer.observe(element));
    const onTop = () => { if (window.scrollY < 200) setActive(null); };
    window.addEventListener('scroll', onTop, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('scroll', onTop); };
  }, []);

  // El indicador se desliza hacia el enlace señalado o, si no, hacia la sección activa.
  const target = hovered ?? active;
  const measure = useCallback(() => {
    const link = target && linksRef.current?.querySelector(`[data-id="${target}"]`);
    if (!link) { setIndicator((value) => ({ ...value, visible: false })); return; }
    setIndicator({ x: link.offsetLeft, width: link.offsetWidth, visible: true });
  }, [target]);
  useLayoutEffect(() => { measure(); }, [measure, compact]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const className = ['site-nav', compact && 'is-compact', hidden && !menuOpen && 'is-hidden', menuOpen && 'is-open'].filter(Boolean).join(' ');

  return (
    <header className={className} ref={navRef}>
      <nav className="nav-pill" aria-label="Navegación principal">
        <Brand light />
        <div className="nav-links" ref={linksRef} onMouseLeave={() => setHovered(null)}>
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={{ transform: `translateX(${indicator.x}px)`, width: indicator.width, opacity: indicator.visible ? 1 : 0 }}
          />
          {sections.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              data-id={id}
              className={active === id ? 'is-active' : undefined}
              aria-current={active === id ? 'location' : undefined}
              onMouseEnter={() => setHovered(id)}
              onFocus={() => setHovered(id)}
              onBlur={() => setHovered(null)}
            >
              {label}
            </a>
          ))}
        </div>
        <div className="nav-actions">
          {session ? (
            <Link className="nav-cta" to="/app"><span>Mi biblioteca</span><ArrowUpRight strokeWidth={2} /></Link>
          ) : (
            <>
              <Link className="nav-login" to="/login">Iniciar sesión</Link>
              <Link className="nav-cta" to="/register"><span>Crear cuenta</span><ArrowUpRight strokeWidth={2} /></Link>
            </>
          )}
          <button
            type="button"
            className="nav-burger"
            aria-expanded={menuOpen}
            aria-controls="nav-sheet"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span /><span />
          </button>
        </div>
        <span className="nav-progress" ref={progressRef} aria-hidden="true" />
      </nav>

      <div className="nav-sheet" id="nav-sheet" inert={!menuOpen} aria-hidden={!menuOpen}>
        <ol>
          {sections.map(({ id, label }, index) => (
            <li key={id} style={{ '--i': index }}>
              <a href={`#${id}`} onClick={() => setMenuOpen(false)}><small>0{index + 1}</small>{label}</a>
            </li>
          ))}
        </ol>
        <div className="nav-sheet-actions">
          {session
            ? <Link className="button button-orange" to="/app">Mi biblioteca</Link>
            : <><Link className="button button-orange" to="/register">Crear cuenta gratis</Link><Link className="nav-sheet-login" to="/login">Ya tengo cuenta</Link></>}
        </div>
      </div>
    </header>
  );
}
