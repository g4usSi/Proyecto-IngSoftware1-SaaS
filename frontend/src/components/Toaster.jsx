import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
const icons = { success: CheckCircle2, error: AlertCircle, info: Info };

/** Avisos flotantes breves. `toast({ type, title, message })`. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 260);
  }, []);

  const toast = useCallback(({ type = 'info', title, message, duration = 4200 }) => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-3), { id, type, title, message }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toaster" aria-live="polite" aria-relevant="additions">
        {toasts.map(({ id, type, title, message, leaving }) => {
          const ToastIcon = icons[type] ?? Info;
          return (
            <div key={id} className={`toast toast-${type}${leaving ? ' is-leaving' : ''}`} role={type === 'error' ? 'alert' : 'status'}>
              <ToastIcon className="toast-icon" strokeWidth={2} aria-hidden="true" />
              <div className="toast-body">{title && <strong>{title}</strong>}{message && <p>{message}</p>}</div>
              <button type="button" className="toast-close" onClick={() => dismiss(id)} aria-label="Cerrar aviso"><X strokeWidth={2} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>.');
  return context;
}
