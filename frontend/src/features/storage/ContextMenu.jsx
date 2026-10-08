import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** El mismo menú sirve para clic derecho y para el botón de acciones en pantallas táctiles. */
export function ContextMenu({ position, items, onClose }) {
  const ref = useRef(null);
  const [point, setPoint] = useState(position);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const menu = ref.current;
    const rect = menu.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, innerWidth - rect.width - 8)), y: Math.max(8, Math.min(position.y, innerHeight - rect.height - 8)) });
    menu.querySelector('button')?.focus({ preventScroll: true });
    const outside = (event) => { if (!menu.contains(event.target)) onClose(); };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('wheel', dismiss, { passive: true });
    window.addEventListener('touchmove', dismiss, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('wheel', dismiss);
      window.removeEventListener('touchmove', dismiss);
      previous?.focus?.({ preventScroll: true });
    };
  }, [position, onClose]);
  function keyboard(event) {
    const buttons = [...ref.current.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    } else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
  }
  return createPortal(<div ref={ref} role="menu" aria-label="Acciones" className="library-context-menu" style={{ left: point.x, top: point.y }} onKeyDown={keyboard} onContextMenu={(event) => event.preventDefault()}>
    {items.map(({ label, icon: Icon, run, danger }) => <button key={label} type="button" role="menuitem" className={danger ? 'is-danger' : undefined} onClick={() => { onClose(); run(); }}><Icon aria-hidden="true" />{label}</button>)}
  </div>, document.body);
}

export const IMAGE_DRAG_TYPE = 'application/x-smartstorage-image';
export function dragImage(event, file) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(IMAGE_DRAG_TYPE, JSON.stringify({ id: file.id, folderId: file.folderId, originalName: file.originalName }));
}
