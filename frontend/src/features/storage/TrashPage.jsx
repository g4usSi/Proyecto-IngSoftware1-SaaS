import { useEffect, useRef, useState } from 'react';
import { FileImage, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { deleteFile, restoreFile, storageErrorMessage } from './storage.api.js';
import { formatBytes, formatFullDate } from './format.js';
import { useLibrary } from './library.jsx';
import { useFileList } from './useFileList.js';
import './organization.css';

export function TrashPage() {
  const { session } = useSession();
  const { refresh, invalidateFile } = useLibrary();
  const { toast } = useToast();
  const files = useFileList({ trash: true });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const entries = [...files.items, ...files.unavailableItems];
  async function act(file, permanent = false) {
    if (busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(null);
    try {
      const options = { token: session.token, signal: request.signal };
      if (permanent) await deleteFile(file.id, options);
      else await restoreFile(file.id, options);
      if (request.signal.aborted) return;
      invalidateFile(file.id); setSelected(null); files.refresh(); refresh();
      toast({ type: 'success', title: permanent ? 'Imagen eliminada definitivamente' : 'Imagen restaurada' });
    } catch (reason) { if (!request.signal.aborted) setError(storageErrorMessage(reason)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="page">
    <header className="page-head"><div><span className="kicker">Biblioteca</span><h1>Papelera</h1><p>Restaura imágenes o elimínalas definitivamente para liberar espacio.</p></div><button type="button" className="btn btn-secondary" onClick={files.refresh} disabled={files.loading || busy}><RefreshCw aria-hidden="true" />Actualizar</button></header>
    <p className="gallery-unavailable">Las imágenes permanecen aquí hasta que las elimines definitivamente y siguen ocupando espacio. El borrado no devuelve el límite diario de subidas.</p>
    {(files.error || (!selected && error)) && <p role="alert" className="gallery-error">{files.error || error}</p>}
    {files.loading && <p role="status">Cargando papelera…</p>}
    {files.loaded && !files.error && !entries.length && <div className="panel panel-empty"><Trash2 aria-hidden="true" className="panel-empty-icon" /><h2>La papelera está vacía</h2><p>Las imágenes que retires de tu biblioteca aparecerán aquí.</p></div>}
    <ul className="trash-list">{entries.map((file) => <li className="panel trash-item" key={file.id}>
      <FileImage className="trash-file-icon" aria-hidden="true" /><div className="trash-file-info"><strong>{file.originalName}</strong><p>{formatBytes(file.originalSizeBytes)} · En papelera desde {formatFullDate(file.deletedAt)}</p></div>
      <div className="organization-buttons"><button type="button" className="btn btn-secondary" onClick={() => act(file)} disabled={busy} aria-label={`Restaurar ${file.originalName}`}><RotateCcw aria-hidden="true" />Restaurar</button><button type="button" className="btn btn-secondary" onClick={() => { setSelected(file); setError(null); }} disabled={busy} aria-label={`Eliminar definitivamente ${file.originalName}`}><Trash2 aria-hidden="true" />Eliminar definitivamente</button></div>
    </li>)}</ul>
    {files.nextCursor && <div className="gallery-more"><button type="button" className="btn btn-secondary" onClick={files.loadMore} disabled={files.loading}>Cargar más imágenes</button></div>}
    {selected && <ActionDialog title="Eliminar definitivamente" confirmLabel="Eliminar definitivamente" onConfirm={() => act(selected, true)} onClose={() => setSelected(null)} busy={busy} error={error}><p className="action-filename">{selected.originalName}</p><p>Esta acción no se puede deshacer. Se liberará el espacio de esta imagen en tu cuenta.</p></ActionDialog>}
  </div>;
}
