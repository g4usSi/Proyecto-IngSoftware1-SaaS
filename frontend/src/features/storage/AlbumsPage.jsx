import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, FolderPlus, Images, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { createAlbum, deleteAlbum, listAlbums, moveFile, renameAlbum, storageErrorMessage } from './storage.api.js';
import { ContextMenu, IMAGE_DRAG_TYPE } from './ContextMenu.jsx';
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
  const [loaded, setLoaded] = useState(false);
  const [action, setAction] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [target, setTarget] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const controller = useRef(null);
  const mutation = useRef(null);
  const files = useFileList({ folderId: selected });
  const current = albums.find((album) => album.id === selected);
  const loadAlbums = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const timeout = setTimeout(() => request.abort('timeout'), 15000);
    setLoading(true); setError(null);
    try {
      const data = await listAlbums({ token: session.token, signal: request.signal });
      if (!request.signal.aborted && controller.current === request) {
        setAlbums(data.items);
        setLoaded(true);
        setSelected((value) => value === 'none' || data.items.some((album) => album.id === value) ? value : 'none');
      }
    } catch (reason) {
      if (controller.current === request && (!request.signal.aborted || request.signal.reason === 'timeout')) {
        setError(request.signal.aborted ? 'La consulta de álbumes tardó demasiado. Vuelve a intentarlo.' : storageErrorMessage(reason));
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === request && (!request.signal.aborted || request.signal.reason === 'timeout')) setLoading(false);
    }
  }, [session.token]);
  useEffect(() => {
    loadAlbums();
    const recover = () => { if (document.visibilityState === 'visible') loadAlbums(); };
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', recover);
      controller.current?.abort(); mutation.current?.abort();
    };
  }, [loadAlbums]);
  function open(value, album = current) { if (movingRef.current) return; setTarget(album); setAction(value); setName(value === 'rename' ? album.name : ''); setActionError(null); }
  function context(event, album = null) {
    event.preventDefault(); event.stopPropagation();
    if (movingRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ album, position: { x: event.clientX || rect.left, y: event.clientY || rect.bottom } });
  }
  async function drop(event, destination) {
    if (!event.dataTransfer.types.includes(IMAGE_DRAG_TYPE)) return;
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    if (movingRef.current) return;
    let file;
    try { file = JSON.parse(event.dataTransfer.getData(IMAGE_DRAG_TYPE)); } catch { return; }
    if (!file?.id || (file.folderId ?? 'none') === destination) return;
    const request = new AbortController(); mutation.current = request;
    movingRef.current = true; setMoving(true);
    try {
      await moveFile(file.id, destination === 'none' ? null : destination, { token: session.token, signal: request.signal });
      if (request.signal.aborted) return;
      files.refresh(); loadAlbums(); refresh();
      toast({ type: 'success', title: 'Imagen movida', message: destination === 'none' ? 'La imagen quedó sin álbum.' : `Movida a ${albums.find((album) => album.id === destination)?.name}.` });
    } catch (reason) { if (!request.signal.aborted) toast({ type: 'error', title: 'No se pudo mover la imagen', message: storageErrorMessage(reason) }); }
    finally { movingRef.current = false; if (!request.signal.aborted) setMoving(false); }
  }
  async function save() {
    const request = new AbortController(); mutation.current = request;
    const options = { token: session.token, signal: request.signal };
    setBusy(true); setActionError(null);
    try {
      if (action === 'create') {
        const result = await createAlbum(name.trim(), options);
        if (!request.signal.aborted) setSelected(result.album.id);
      } else if (action === 'rename') await renameAlbum(target.id, name.trim(), options);
      else { await deleteAlbum(target.id, options); if (!request.signal.aborted && selected === target.id) setSelected('none'); }
      if (request.signal.aborted) return;
      setAction(null); loadAlbums(); refresh(); files.refresh();
      toast({ type: 'success', title: action === 'delete' ? 'Álbum eliminado; imágenes conservadas' : 'Álbum guardado' });
    } catch (reason) { if (!request.signal.aborted) setActionError(storageErrorMessage(reason)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="page" onContextMenu={(event) => {
    if (event.target.closest('input, button, select, a')) return;
    context(event);
  }}>
    <header className="page-head"><div><span className="kicker">Biblioteca</span><h1>Álbumes</h1><p>Un lugar para cada imagen. Organiza por proyectos, viajes o ideas.</p></div><div className="organization-buttons"><button className="btn btn-secondary" type="button" onClick={loadAlbums} disabled={loading || busy || moving}><RefreshCw aria-hidden="true" />Actualizar álbumes</button><button className="btn btn-primary" type="button" onClick={() => open('create')}><FolderPlus aria-hidden="true" />Crear álbum</button></div></header>
    <section className="album-browser" aria-label="Elegir álbum" aria-busy={loading}>
      <div className="album-section-head"><h2>Tus álbumes</h2><span>Abre un álbum o arrastra una imagen sobre él.</span></div>
      <p className="album-help">Cuenta: {session.user.email}</p>
      {loaded && <div className="album-grid">
        {[{ id: 'none', name: 'Sin álbum' }, ...albums].map((album) => <article key={album.id} className={`album-folder${selected === album.id ? ' is-selected' : ''}${dropTarget === album.id ? ' is-drop-target' : ''}`} onContextMenu={(event) => context(event, album.id === 'none' ? null : album)}
          onDragOver={(event) => { if (!moving && event.dataTransfer.types.includes(IMAGE_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(album.id); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={(event) => drop(event, album.id)}>
          <button type="button" className="album-folder-open" aria-label={`Abrir ${album.name}`} aria-pressed={selected === album.id} disabled={moving} onClick={() => setSelected(album.id)}>
            <span className="album-folder-icon">{album.id === 'none' ? <Images aria-hidden="true" /> : selected === album.id ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}</span>
            <span className="album-folder-info"><strong title={album.name}>{album.name}</strong><small>{album.id === 'none' ? 'Imágenes por organizar' : `${album.imageCount} ${String(album.imageCount) === '1' ? 'imagen' : 'imágenes'}`}</small></span>
          </button>
          {album.id !== 'none' && <button type="button" className="icon-button album-folder-menu" aria-label={`Acciones de ${album.name}`} aria-haspopup="menu" disabled={moving} onClick={(event) => context(event, album)}><MoreHorizontal aria-hidden="true" /></button>}
        </article>)}
      </div>}
      <p className="album-help">Funcionan como carpetas de un solo nivel: cada imagen puede estar en un solo álbum. Moverla no crea una copia. Usa clic derecho o los botones de acciones.</p>
      {moving && <p role="status">Moviendo imagen…</p>}
      {loading && <p role="status">Cargando álbumes…</p>}
      {error && <div role="alert"><p>No se pudo actualizar la lista de álbumes. {error}{loaded ? ' Se conserva la última lista consultada.' : ''}</p><button type="button" className="link-button" onClick={loadAlbums}>Reintentar</button></div>}
      {loaded && !loading && !error && !albums.length && <p className="album-help">Todavía no tienes álbumes en esta cuenta.</p>}
    </section>
    {loaded && <><div className="album-current"><div><span>Álbumes</span><ChevronRight aria-hidden="true" /><strong>{current?.name ?? 'Sin álbum'}</strong></div>
      {current && <div className="organization-buttons"><button className="btn btn-secondary" type="button" onClick={() => open('rename')}><Pencil aria-hidden="true" />Renombrar</button><button className="btn btn-secondary" type="button" onClick={() => open('delete')}><Trash2 aria-hidden="true" />Eliminar álbum</button></div>}
    </div>
    <Gallery source={files} title={current?.name ?? 'Sin álbum'} onChanged={loadAlbums} /></>}
    {menu && <ContextMenu position={menu.position} onClose={closeMenu} items={menu.album ? [
      { label: 'Abrir álbum', icon: FolderOpen, run: () => setSelected(menu.album.id) },
      { label: 'Renombrar', icon: Pencil, run: () => open('rename', menu.album) },
      { label: 'Eliminar álbum', icon: Trash2, danger: true, run: () => open('delete', menu.album) },
    ] : [{ label: 'Crear álbum', icon: FolderPlus, run: () => open('create') }]} />}
    {action && <ActionDialog title={action === 'create' ? 'Crear álbum' : action === 'rename' ? 'Renombrar álbum' : 'Eliminar álbum'} confirmLabel={action === 'delete' ? 'Eliminar álbum' : 'Guardar álbum'} onConfirm={save} onClose={() => setAction(null)} busy={busy} error={actionError} disabled={action !== 'delete' && !name.trim()}>
      {action === 'delete' ? <p>Se eliminará «{target?.name}». Sus imágenes, incluidas las de la papelera y las que se están procesando, quedarán sin álbum.</p> : <label className="organization-field">Nombre del álbum<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoFocus disabled={busy} /></label>}
    </ActionDialog>}
  </div>;
}
