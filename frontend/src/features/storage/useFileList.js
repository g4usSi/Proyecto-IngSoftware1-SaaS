import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../auth/session.jsx';
import { listFiles, storageErrorMessage } from './storage.api.js';

export function useFileList({ folderId, trash = false, scanAll = false }) {
  const { session } = useSession();
  const [state, setState] = useState({ items: [], unavailableItems: [], nextCursor: null, loading: true, loaded: false, error: null });
  const request = useRef(null);
  const load = useCallback(async (cursor = null) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 15000);
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listFiles({ token: session.token, folderId, trash, cursor, signal: controller.signal });
      // Procesos también necesita detectar incidencias en páginas antiguas de la biblioteca.
      while (scanAll && data.nextCursor && !controller.signal.aborted) {
        const page = await listFiles({ token: session.token, folderId, trash, cursor: data.nextCursor, signal: controller.signal });
        data.items.push(...page.items);
        data.unavailableItems = [...(data.unavailableItems ?? []), ...(page.unavailableItems ?? [])];
        data.nextCursor = page.nextCursor;
      }
      if (controller.signal.aborted) return;
      setState((current) => ({ ...data, items: cursor ? [...new Map([...current.items, ...data.items].map((item) => [item.id, item])).values()] : data.items,
        unavailableItems: cursor ? [...new Map([...current.unavailableItems, ...(data.unavailableItems ?? [])].map((item) => [item.id, item])).values()] : data.unavailableItems ?? [], loading: false, loaded: true, error: null }));
    } catch (error) {
      if (request.current === controller && (!controller.signal.aborted || controller.signal.reason === 'timeout')) setState((current) => ({ ...current, loading: false, loaded: true, error: controller.signal.aborted ? 'La consulta tardó demasiado. Vuelve a intentarlo.' : storageErrorMessage(error) }));
    } finally { clearTimeout(timeout); }
  }, [session.token, folderId, trash, scanAll]);
  useEffect(() => { setState({ items: [], unavailableItems: [], nextCursor: null, loading: true, loaded: false, error: null }); load(); return () => request.current?.abort(); }, [load]);
  return { ...state, refresh: () => load(), loadMore: () => load(state.nextCursor) };
}
