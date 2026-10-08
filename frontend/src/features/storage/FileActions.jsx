import { useEffect, useRef, useState } from 'react';
import { FolderInput, Trash2 } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { useLibrary } from './library.jsx';
import { listAlbums, moveFile, storageErrorMessage, trashFile } from './storage.api.js';

export function FileActions({ file, onChanged, initialAction = null, onDismiss }) {
  const { session } = useSession();
  const { refresh, invalidateFile } = useLibrary();
  const { toast } = useToast();
  const [action, setAction] = useState(initialAction);
  const [albums, setAlbums] = useState([]);
  const [folder, setFolder] = useState(file.folderId ?? '');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (action !== 'move') return undefined;
    const controller = new AbortController();
    setLoading(true);
    listAlbums({ token: session.token, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setAlbums(data.items);
    }).catch((reason) => { if (!controller.signal.aborted) setError(storageErrorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [action, session.token]);
  const open = (value) => { setError(null); setFolder(file.folderId ?? ''); setAction(value); };
  async function submit() {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null);
    try {
      const options = { token: session.token, signal: controller.signal };
      if (action === 'move') await moveFile(file.id, folder || null, options);
      else await trashFile(file.id, options);
      if (controller.signal.aborted) return;
      setAction(null);
      toast({ type: 'success', title: action === 'move' ? 'Imagen movida' : 'Imagen en la papelera' });
      if (action === 'trash') invalidateFile(file.id);
      refresh();
      onChanged?.();
      onDismiss?.();
    } catch (reason) { if (!controller.signal.aborted) setError(storageErrorMessage(reason)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <>
    {!initialAction && <>
    <button type="button" className="icon-button" onClick={() => open('move')} aria-label={`Mover ${file.originalName} a un álbum`} title="Mover a un álbum"><FolderInput strokeWidth={2} /></button>
    <button type="button" className="icon-button" onClick={() => open('trash')} aria-label={`Enviar ${file.originalName} a la papelera`} title="Enviar a la papelera"><Trash2 strokeWidth={2} /></button>
    </>}
    {action && <ActionDialog title={action === 'move' ? 'Mover imagen' : 'Enviar a la papelera'} confirmLabel={action === 'move' ? 'Mover' : 'Enviar a la papelera'} onConfirm={submit} onClose={() => { setAction(null); onDismiss?.(); }} busy={busy} error={error} disabled={action === 'move' && (loading || (error && !albums.length))}>
      <p className="action-filename">{file.originalName}</p>
      {action === 'move' ? <label className="organization-field">Álbum de destino<select value={folder} onChange={(event) => setFolder(event.target.value)} disabled={loading || busy}>
        <option value="">Sin álbum</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}
      </select>{loading && <span>Cargando álbumes…</span>}</label> : <p>Podrás restaurarla desde la papelera. Seguirá ocupando espacio hasta que la elimines definitivamente.</p>}
    </ActionDialog>}
  </>;
}
