import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { createAlbum, deleteAlbum, listAlbums, renameAlbum, storageErrorMessage } from './storage.api.js';
import { Gallery } from './Gallery.jsx';
import { useFileList } from './useFileList.js';
import { useLibrary } from './library.jsx';
import './organization.css';

export function AlbumsPage() {
  const { session } = useSession();
  const { refresh } = useLibrary();
  const { toast } = useToast();
  const [albums, setAlbums] = useState([]);
  const [selected, setSelected] = useState('none');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const controller = useRef(null);
  const mutation = useRef(null);
  const files = useFileList({ folderId: selected });
  const current = albums.find((album) => album.id === selected);
  const loadAlbums = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError(null);
    try {
      const data = await listAlbums({ token: session.token, signal: request.signal });
      if (!request.signal.aborted) {
        setAlbums(data.items);
        setSelected((value) => value === 'none' || data.items.some((album) => album.id === value) ? value : 'none');
      }
    } catch (reason) { if (!request.signal.aborted) setError(storageErrorMessage(reason)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }, [session.token]);
  useEffect(() => { loadAlbums(); return () => { controller.current?.abort(); mutation.current?.abort(); }; }, [loadAlbums]);
  function open(value) { setAction(value); setName(value === 'rename' ? current.name : ''); setActionError(null); }
  async function save() {
    const request = new AbortController(); mutation.current = request;
    const options = { token: session.token, signal: request.signal };
    setBusy(true); setActionError(null);
    try {
      if (action === 'create') {
        const result = await createAlbum(name.trim(), options);
        if (!request.signal.aborted) setSelected(result.album.id);
      } else if (action === 'rename') await renameAlbum(selected, name.trim(), options);
      else { await deleteAlbum(selected, options); if (!request.signal.aborted) setSelected('none'); }
      if (request.signal.aborted) return;
      setAction(null); loadAlbums(); refresh(); files.refresh();
      toast({ type: 'success', title: action === 'delete' ? 'Álbum eliminado; imágenes conservadas' : 'Álbum guardado' });
    } catch (reason) { if (!request.signal.aborted) setActionError(storageErrorMessage(reason)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="page">
    <header className="page-head"><div><span className="kicker">Biblioteca</span><h1>Álbumes</h1><p>Organiza tus imágenes sin crear copias adicionales.</p></div><button className="btn btn-primary" type="button" onClick={() => open('create')}><FolderPlus aria-hidden="true" />Crear álbum</button></header>
    <section className="panel organization-toolbar" aria-label="Elegir álbum">
      <label className="organization-field">Álbum<select aria-label="Álbum" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={loading}>
        <option value="none">Sin álbum</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.name} ({album.imageCount})</option>)}
      </select></label>
      {current && <div className="organization-buttons"><button className="btn btn-secondary" type="button" onClick={() => open('rename')}><Pencil aria-hidden="true" />Renombrar</button><button className="btn btn-secondary" type="button" onClick={() => open('delete')}><Trash2 aria-hidden="true" />Eliminar álbum</button></div>}
      {loading && <p role="status">Cargando álbumes…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" className="link-button" onClick={loadAlbums}>Reintentar</button></div>}
    </section>
    <Gallery source={files} title={current?.name ?? 'Sin álbum'} onChanged={loadAlbums} />
    {action && <ActionDialog title={action === 'create' ? 'Crear álbum' : action === 'rename' ? 'Renombrar álbum' : 'Eliminar álbum'} confirmLabel={action === 'delete' ? 'Eliminar álbum' : 'Guardar álbum'} onConfirm={save} onClose={() => setAction(null)} busy={busy} error={actionError} disabled={action !== 'delete' && !name.trim()}>
      {action === 'delete' ? <p>Se eliminará «{current?.name}». Sus imágenes, incluidas las de la papelera y las que se están procesando, quedarán sin álbum.</p> : <label className="organization-field">Nombre del álbum<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoFocus disabled={busy} /></label>}
    </ActionDialog>}
  </div>;
}
