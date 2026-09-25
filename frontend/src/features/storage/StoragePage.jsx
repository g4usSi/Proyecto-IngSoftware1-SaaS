import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { PendingState } from '../../components/PendingState.jsx';
import { FileGallery } from './FileGallery.jsx';
import { UploadForm } from './UploadForm.jsx';
import { downloadFile, getDemoConfiguration, listFiles, storageErrorMessage, uploadFile, webpFilename } from './storage.api.js';

/** Andy may inject { user, accessToken } when real authentication is integrated. */
export function StoragePage({ session = null }) {
  const hasSession = Boolean(session?.user?.id && session?.accessToken);
  const [demo, setDemo] = useState({ status: 'loading', accounts: [], error: null });
  const [selectedId, setSelectedId] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (hasSession) {
      setSelectedId('');
      setDemo({ status: 'loading', accounts: [], error: null });
      return undefined;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 10_000);
    let active = true;
    setDemo({ status: 'loading', accounts: [], error: null });
    setSelectedId('');

    getDemoConfiguration({ signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setDemo({ status: data.enabled ? 'enabled' : 'disabled', accounts: data.accounts ?? [], error: null });
      })
      .catch((error) => {
        if (!active) return;
        setDemo({ status: 'error', accounts: [], error: controller.signal.aborted ? 'El servicio tardó demasiado en responder. Vuelve a intentarlo.' : storageErrorMessage(error) });
      })
      .finally(() => clearTimeout(timeout));

    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [hasSession, attempt]);

  const selectedAccount = demo.status === 'enabled' ? demo.accounts.find((account) => account.id === selectedId) : null;
  const authorization = useMemo(() => hasSession
    ? { token: session.accessToken }
    : { headers: { 'X-Storage-Demo-User': selectedAccount?.id ?? '' } }, [hasSession, session?.accessToken, selectedAccount?.id]);
  const identity = hasSession ? `session:${session.user.id}` : selectedAccount ? `demo:${selectedAccount.id}` : null;

  return (
    <>
      <div className="page-heading storage-heading"><div><span className="eyebrow">BIBLIOTECA</span><h1>Mis imágenes</h1><p>Sube una imagen y descarga su versión WebP.</p></div></div>
      {!hasSession && demo.status === 'enabled' && <section className="storage-demo" aria-labelledby="storage-demo-title">
        <h2 id="storage-demo-title">Demo local de Storage</h2>
        <p>Usa una de las dos cuentas de prueba. Esta demo no es un inicio de sesión; la autenticación real sigue pendiente.</p>
        <label htmlFor="storage-demo-account">Cuenta de prueba</label>
        <select id="storage-demo-account" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Selecciona una cuenta</option>
          {demo.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}
        </select>
      </section>}
      {identity ? <StorageWorkspace key={identity} authorization={authorization} /> : <section className="library-panel">
        {!hasSession && demo.status === 'loading' && <div role="status"><PendingState icon="lock" eyebrow="Conectando" title="Comprobando acceso…">Estamos consultando la disponibilidad de Storage.</PendingState></div>}
        {!hasSession && demo.status === 'error' && <><div role="alert"><PendingState icon="lock" eyebrow="Servicio no disponible" title="No pudimos comprobar el acceso.">{demo.error}</PendingState></div><div className="storage-retry"><button type="button" className="button button-dark" onClick={() => setAttempt((value) => value + 1)}>Volver a intentar</button></div></>}
        {!hasSession && demo.status === 'disabled' && <PendingState icon="lock" title="Tu cuenta será el punto de partida.">El inicio de sesión todavía está en preparación y la demo local está desactivada. La subida y la biblioteca requieren una cuenta.</PendingState>}
        {!hasSession && demo.status === 'enabled' && <PendingState icon="image" eyebrow="Demo local" title="Selecciona una cuenta de prueba.">Cada cuenta tiene su propia biblioteca. Elige una para subir, consultar y descargar sus imágenes.</PendingState>}
      </section>}
      <div className="feature-explainer"><span className="explainer-icon"><Icon name="layers" /></span><div><h2>Menos copias, el mismo espacio personal.</h2><p>El contenido idéntico comparte una sola versión WebP. El acceso a cada imagen sigue ligado a su cuenta.</p></div></div>
    </>
  );
}

function StorageWorkspace({ authorization }) {
  const [gallery, setGallery] = useState({ items: [], nextCursor: null, loading: true, error: null });
  const [upload, setUpload] = useState({ busy: false, error: null, notice: null });
  const [download, setDownload] = useState({ id: null, error: null });
  const listRequest = useRef(null);
  const uploadRequest = useRef(null);
  const downloadRequest = useRef(null);
  const failedCursor = useRef(null);
  const downloadUrls = useRef(new Map());

  const loadGallery = useCallback(async (cursor = null) => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 15_000);
    failedCursor.current = cursor;
    setGallery((current) => ({ ...current, loading: true, error: null }));

    try {
      const data = await listFiles({ ...authorization, cursor, signal: controller.signal });
      if (controller.signal.aborted || listRequest.current !== controller) return;
      setGallery((current) => ({
        items: cursor ? [...new Map([...current.items, ...data.items].map((file) => [file.id, file])).values()] : data.items,
        nextCursor: data.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (listRequest.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      setGallery((current) => ({ ...current, loading: false, error: controller.signal.aborted ? 'El listado tardó demasiado. Vuelve a intentarlo.' : storageErrorMessage(error) }));
    } finally {
      clearTimeout(timeout);
    }
  }, [authorization]);

  useEffect(() => {
    setUpload({ busy: false, error: null, notice: null });
    setDownload({ id: null, error: null });
    loadGallery();
    return () => {
      listRequest.current?.abort();
      uploadRequest.current?.abort();
      downloadRequest.current?.abort();
      for (const [url, timer] of downloadUrls.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
      downloadUrls.current.clear();
    };
  }, [loadGallery]);

  async function handleUpload(file) {
    if (uploadRequest.current && !uploadRequest.current.signal.aborted) return false;
    const controller = new AbortController();
    uploadRequest.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 120_000);
    setUpload({ busy: true, error: null, notice: null });

    try {
      const image = await uploadFile(file, { ...authorization, signal: controller.signal });
      if (controller.signal.aborted) return false;
      setUpload({ busy: false, error: null, notice: `${image.originalName || file.name} se guardó correctamente en WebP.` });
      loadGallery();
      return true;
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return false;
      setUpload({ busy: false, notice: null, error: controller.signal.aborted
        ? 'La subida tardó demasiado. Actualiza la galería antes de volver a intentarlo: la imagen podría haberse guardado.'
        : storageErrorMessage(error, 'No se pudo confirmar la subida. Actualiza la galería antes de volver a intentarlo.') });
      return false;
    } finally {
      clearTimeout(timeout);
      if (uploadRequest.current === controller) uploadRequest.current = null;
    }
  }

  async function handleDownload(file) {
    downloadRequest.current?.abort();
    const controller = new AbortController();
    downloadRequest.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 60_000);
    setDownload({ id: file.id, error: null });

    try {
      const blob = await downloadFile(file.id, { ...authorization, signal: controller.signal });
      if (controller.signal.aborted || downloadRequest.current !== controller) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = webpFilename(file.originalName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      const revokeTimer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 30_000);
      downloadUrls.current.set(url, revokeTimer);
      setDownload({ id: null, error: null });
    } catch (error) {
      if (downloadRequest.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      setDownload({ id: null, error: controller.signal.aborted ? 'La descarga tardó demasiado. Vuelve a intentarlo.' : storageErrorMessage(error) });
    } finally {
      clearTimeout(timeout);
    }
  }

  return (
    <>
      <UploadForm onUpload={handleUpload} busy={upload.busy} error={upload.error} notice={upload.notice} />
      <FileGallery files={gallery.items} loading={gallery.loading} error={gallery.error} nextCursor={gallery.nextCursor}
        onRefresh={() => loadGallery()} onLoadMore={() => loadGallery(gallery.nextCursor)} onRetry={() => loadGallery(failedCursor.current)}
        onDownload={handleDownload} downloadingId={download.id} downloadError={download.error} />
    </>
  );
}
