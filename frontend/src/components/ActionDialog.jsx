import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** El diálogo nativo mantiene el foco dentro y lo devuelve al control de origen. */
export function ActionDialog({ title, children, confirmLabel, onConfirm, onClose, busy, error, disabled }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { dialog.current?.close(); previous?.focus?.(); };
  }, []);
  return createPortal(
    <dialog ref={dialog} className="action-dialog" aria-labelledby="action-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && !disabled) onConfirm(); }}>
        <h2 id="action-dialog-title">{title}</h2>
        {children}
        {error && <p className="action-error" role="alert">{error}</p>}
        <div className="action-dialog-buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || disabled}>{busy ? 'Guardando…' : confirmLabel}</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
