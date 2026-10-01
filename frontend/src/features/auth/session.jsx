import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { UNAUTHORIZED_EVENT } from '../../services/api.js';
import * as authApi from './auth.api.js';

const SessionContext = createContext(null);

// La sesión vive solo en memoria: recargar la página obliga a iniciar sesión de nuevo.
// La persistencia entre recargas queda pendiente de acordar con el equipo.
export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);

  const clearSession = useCallback(() => setSession(null), []);

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, clearSession);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, clearSession);
  }, [clearSession]);

  // No hay renovación automática: al llegar expiresAt se cierra la sesión local.
  useEffect(() => {
    if (!session?.expiresAt) return undefined;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (!(remaining > 0)) { clearSession(); return undefined; }
    const timer = setTimeout(clearSession, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [session?.expiresAt, clearSession]);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setSession({ token: data.token, expiresAt: data.expiresAt, user: data.user });
    return data.user;
  }, []);

  // Devuelve false si la cuenta se creó pero el inicio de sesión automático falló.
  const register = useCallback(async ({ name, email, password }) => {
    await authApi.registerAccount({ name, email, password });
    try {
      await login({ email, password });
      return true;
    } catch {
      return false;
    }
  }, [login]);

  const logout = useCallback(async () => {
    const token = session?.token;
    clearSession();
    if (token) await authApi.logout(token).catch(() => {});
  }, [session?.token, clearSession]);

  const value = useMemo(() => ({ session, login, register, logout }), [session, login, register, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession debe usarse dentro de <SessionProvider>.');
  return context;
}
