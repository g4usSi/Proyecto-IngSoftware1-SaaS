import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../services/api.js';
import { useSession } from '../auth/session.jsx';

const query = (params) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') search.set(key, String(value)); });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const getAdminSummary = (options) => apiRequest('/admin/summary', options);
export const getStorageStats = (options) => apiRequest('/admin/storage/stats', options);

// Usuarios: paginación page/pageSize, total numérico.
export const listUsers = ({ q, status, page, pageSize }, options) => apiRequest(`/admin/users${query({ q, status, page, pageSize })}`, options);
export const getUser = (id, options) => apiRequest(`/admin/users/${encodeURIComponent(id)}`, options);
export const setUserStatus = (id, active, options) => apiRequest(`/admin/users/${encodeURIComponent(id)}/status`, { ...options, method: 'PATCH', body: { active } });

// Suscripciones, consumo, cola y bitácora: paginación limit/offset, total como string.
export const listAdmin = (path, params, options) => apiRequest(`/admin/${path}${query(params)}`, options);

/** Consulta con carga/error/reintento. Nunca devuelve datos en cero cuando la API falla. */
export function useAdminQuery(fetcher, deps) {
  const { session } = useSession();
  const [state, setState] = useState({ data: null, loading: true, error: null, forbidden: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);
  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await run({ token: session.token, signal });
      if (!signal?.aborted) setState({ data, loading: false, error: null, forbidden: false });
    } catch (error) {
      if (signal?.aborted) return;
      setState((current) => ({ ...current, loading: false, forbidden: error?.status === 403 && error.code === 'FORBIDDEN',
        error: error instanceof ApiError ? error.message : 'No se pudo conectar con el servicio. Vuelve a intentarlo.' }));
    }
  }, [run, session.token]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  return { ...state, reload: () => load() };
}

export const AUDIT_TYPES = {
  login_success: 'Inicio de sesión',
  login_failed: 'Inicio de sesión fallido',
  logout: 'Cierre de sesión',
  password_changed: 'Cambio de contraseña',
  password_reset: 'Restablecimiento de contraseña',
  account_status_changed: 'Cambio de estado de cuenta',
};
export const AUDIT_REASONS = {
  invalid_credentials: 'Credenciales incorrectas',
  locked: 'Bloqueo por intentos',
  account_disabled: 'Cuenta desactivada',
  email_not_verified: 'Correo sin verificar',
};
export const JOB_STATES = {
  queued: { label: 'Pendiente', tone: 'muted' },
  processing: { label: 'Procesando', tone: 'accent' },
  converted: { label: 'Convertida', tone: 'accent' },
  published: { label: 'Listo', tone: 'success' },
  failed: { label: 'Error', tone: 'danger' },
};
