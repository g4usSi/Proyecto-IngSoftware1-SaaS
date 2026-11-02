import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';

/**
 * El diálogo nativo mantiene el foco dentro y lo devuelve al control de origen.
 * stepKey: en un flujo por pasos, cambia el contenido sin cerrar el diálogo y lleva el foco a la acción del paso nuevo.
 * hideActions: el paso no admite acciones (p. ej. mientras se procesa un pago).
 */
export function ActionDialog({ title, children, confirmLabel, onConfirm, onClose, busy, error, disabled, busyLabel = 'Guardando…', cancelLabel = 'Cancelar', hideCancel = false, hideActions = false, stepKey }) {
  const dialog = useRef(null);
  const firstStep = useRef(true);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { dialog.current?.close(); previous?.focus?.(); };
  }, []);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const root = dialog.current;
    // El paso anterior se desmontó con su foco; un campo con autoFocus del paso nuevo tiene prioridad.
    if (root.contains(document.activeElement) && document.activeElement !== root) return;
    (root.querySelector('[type="submit"]') ?? root).focus();
  }, [stepKey]);
  return createPortal(
    <dialog ref={dialog} tabIndex={-1} className="action-dialog" aria-labelledby="action-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && !disabled) onConfirm(); }}>
        <h2 id="action-dialog-title">{title}</h2>
        <div className="action-dialog-step" key={stepKey}>{children}</div>
        {error && <p className="action-error" role="alert">{error}</p>}
        {!hideActions && (
          <div className="action-dialog-buttons">
            {!hideCancel && <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>}
            <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
              {busy ? <><LoaderCircle className="spin" aria-hidden="true" />{busyLabel}</> : confirmLabel}
            </button>
          </div>
        )}
      </form>
    </dialog>, document.body,
  );
}
