import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, KeyRound, Plus, Sparkles } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { TableSkeleton } from '../../components/Skeletons.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { formatDateTime, formatFullDate } from '../storage/format.js';
import { storageErrorMessage } from '../storage/storage.api.js';
import { createApiKey, listApiKeys, revokeApiKey, sdkSnippet } from './apikeys.api.js';

const COLUMNS = ['Nombre', 'Clave', 'Creada', 'Último uso', 'Estado'];

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* el texto sigue visible para copiarlo a mano */ }
  }
  return (
    <button type="button" className="btn btn-secondary btn-small" onClick={copy} aria-live="polite">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copiada' : label}
    </button>
  );
}

/** Claves de API para el SDK (CU-14, RNF-STO-03). */
export function ApiKeysPage() {
  const { session } = useSession();
  const { toast } = useToast();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);

  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listApiKeys({ token: session.token, signal });
      if (!signal?.aborted) setState({ data, loading: false, error: null });
    } catch (error) {
      if (!signal?.aborted) setState((current) => ({ ...current, loading: false, error: storageErrorMessage(error) }));
    }
  }, [session.token]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  function open(next) { setDialogError(null); setName(''); setDialog(next); }

  async function create() {
    setBusy(true); setDialogError(null);
    try {
      const created = await createApiKey(name.trim() || 'Clave de API', { token: session.token });
      setDialog({ type: 'reveal', ...created });
      load();
    } catch (error) { setDialogError(storageErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function revoke(key) {
    setBusy(true); setDialogError(null);
    try {
      await revokeApiKey(key.id, { token: session.token });
      setDialog(null);
      toast({ type: 'success', title: 'Clave revocada', message: `«${key.name}» dejó de funcionar.` });
      load();
    } catch (error) { setDialogError(storageErrorMessage(error)); }
    finally { setBusy(false); }
  }

  const { data, loading, error } = state;
  const items = data?.items ?? [];
  const active = items.filter((key) => !key.revokedAt).length;
  const atLimit = data && active >= data.maxActive;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Desarrolladores</span>
          <h1>Claves de API</h1>
          <p>Conecta tus programas a tu biblioteca con el SDK. Una clave puede subir, listar, descargar y organizar tus imágenes y consultar tu cuota; nunca accede a pagos ni a tu cuenta.</p>
        </div>
        {data?.eligible && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={() => open({ type: 'create' })} disabled={atLimit}
              title={atLimit ? `Puedes tener hasta ${data.maxActive} claves activas` : undefined}>
              <Plus aria-hidden="true" />Crear clave
            </button>
          </div>
        )}
      </header>

      {error && <div className="gallery-error" role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => load()}>Volver a intentar</button></div>}
      {!error && loading && !data && <TableSkeleton columns={COLUMNS} rows={3} label="Cargando tus claves…" />}

      {!error && data && !data.eligible && items.length === 0 && (
        <div className="panel panel-empty">
          <KeyRound aria-hidden="true" className="panel-empty-icon" />
          <h2>El SDK está disponible desde el plan Estándar</h2>
          <p>Contrata Estándar, Pro o Enterprise para crear claves y usar tu biblioteca desde código.</p>
          <Link className="btn btn-primary" to="/app/plans"><Sparkles aria-hidden="true" />Ver planes</Link>
        </div>
      )}

      {!error && data?.eligible && items.length === 0 && (
        <div className="panel panel-empty">
          <KeyRound aria-hidden="true" className="panel-empty-icon" />
          <h2>Todavía no tienes claves</h2>
          <p>Crea una para tu script o aplicación. La verás completa una sola vez.</p>
          <button type="button" className="btn btn-primary" onClick={() => open({ type: 'create' })}><Plus aria-hidden="true" />Crear clave</button>
        </div>
      )}

      {!error && items.length > 0 && (
        <section className="panel" aria-labelledby="keys-title" aria-busy={loading}>
          <h2 id="keys-title" className="sr-only">Tus claves</h2>
          {!data.eligible && <p className="keys-suspended" role="status">Tu plan actual no incluye el SDK: tus claves están suspendidas hasta que contrates Estándar o superior.</p>}
          <div className="compare-scroll">
            <table className={`data-table${loading ? ' is-refreshing' : ''}`}>
              <thead><tr>{COLUMNS.map((column) => <th key={column} scope="col">{column}</th>)}<th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {items.map((key) => (
                  <tr key={key.id} className={key.revokedAt ? 'is-revoked' : undefined}>
                    <td data-label="Nombre">{key.name}</td>
                    <td data-label="Clave"><code className="key-prefix">{key.prefix}…</code></td>
                    <td data-label="Creada" title={formatFullDate(key.createdAt)}>{formatDateTime(key.createdAt)}</td>
                    <td data-label="Último uso">{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Sin uso'}</td>
                    <td data-label="Estado"><span className={`status-pill ${key.revokedAt ? '' : 'is-success'}`}>{key.revokedAt ? 'Revocada' : 'Activa'}</span></td>
                    <td className="cell-action">
                      {!key.revokedAt && <button type="button" className="btn btn-secondary btn-small" onClick={() => open({ type: 'revoke', key })}>Revocar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="compare-note">{active} de {data.maxActive} claves activas. Revocar una clave la desactiva de inmediato y no se puede deshacer.</p>
        </section>
      )}

      {!error && data?.eligible && (
        <section className="panel sdk-usage" aria-labelledby="sdk-usage-title">
          <h2 id="sdk-usage-title">Usar el SDK</h2>
          <p>El SDK de Python está en <code>sdk-python/</code> (Python 3.9 o superior, sin dependencias), junto con una tienda de demostración. También hay uno de Node.js en <code>sdk/</code>.</p>
          <pre className="sdk-snippet"><code>{sdkSnippet()}</code></pre>
        </section>
      )}

      {dialog?.type === 'create' && (
        <ActionDialog title="Crear clave de API" confirmLabel="Crear clave" busyLabel="Creando…" busy={busy} error={dialogError}
          onClose={() => setDialog(null)} onConfirm={create} stepKey="create">
          <label className="organization-field">Nombre
            <input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Por ejemplo: respaldo nocturno" autoFocus disabled={busy} />
          </label>
          <p className="muted">El nombre te ayuda a reconocer dónde la usas.</p>
        </ActionDialog>
      )}

      {dialog?.type === 'reveal' && (
        <ActionDialog title="Tu clave está lista" confirmLabel="Ya la guardé" hideCancel onClose={() => setDialog(null)} onConfirm={() => setDialog(null)} stepKey="reveal">
          <div className="key-reveal">
            <code className="key-secret" aria-label="Clave de API completa">{dialog.secret}</code>
            <CopyButton text={dialog.secret} label="Copiar clave" />
          </div>
          <p className="key-warning">Guárdala ahora: no la volveremos a mostrar. Si la pierdes, revócala y crea otra.</p>
          <div className="key-snippet-head"><span>Ejemplo con esta clave</span><CopyButton text={sdkSnippet(dialog.secret)} label="Copiar ejemplo" /></div>
          <pre className="sdk-snippet"><code>{sdkSnippet(dialog.secret)}</code></pre>
        </ActionDialog>
      )}

      {dialog?.type === 'revoke' && (
        <ActionDialog title="Revocar clave" confirmLabel="Revocar clave" busyLabel="Revocando…" busy={busy} error={dialogError}
          onClose={() => setDialog(null)} onConfirm={() => revoke(dialog.key)} stepKey="revoke">
          <p>«{dialog.key.name}» (<code>{dialog.key.prefix}…</code>) dejará de funcionar de inmediato. Los programas que la usen recibirán un error.</p>
        </ActionDialog>
      )}
    </div>
  );
}
