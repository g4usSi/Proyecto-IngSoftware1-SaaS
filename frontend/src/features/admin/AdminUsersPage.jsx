import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { DetailSkeleton, TableSkeleton } from '../../components/Skeletons.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { formatFullDate } from '../storage/format.js';
import { AdminGate, AdminHead, QueryError, StatusPill } from './AdminShared.jsx';
import { getUser, listUsers, setUserStatus, useAdminQuery } from './admin.api.js';

const PAGE_SIZE = 20;

export function AdminUsersPage() {
  return <AdminGate><Users /></AdminGate>;
}

function Users() {
  const [draft, setDraft] = useState('');
  const [filters, setFilters] = useState({ q: '', status: 'all', page: 1 });
  const [selected, setSelected] = useState(null);
  const users = useAdminQuery((options) => listUsers({ ...filters, pageSize: PAGE_SIZE }, options), [filters]);
  const data = users.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="page">
      <AdminHead title="Usuarios" description="Busca cuentas, revisa su detalle y actívalas o desactívalas." loading={users.loading} onRefresh={users.reload} />

      <form className="panel admin-filters" role="search" onSubmit={(event) => { event.preventDefault(); setFilters({ ...filters, q: draft.trim(), page: 1 }); }}>
        <label className="search-field"><Search strokeWidth={2} aria-hidden="true" /><span className="sr-only">Buscar por nombre o correo</span>
          <input type="search" placeholder="Nombre o correo…" maxLength={254} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label className="select-field"><span className="sr-only">Estado</span>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}>
            <option value="all">Todas</option><option value="active">Activas</option><option value="inactive">Desactivadas</option>
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">Buscar</button>
      </form>

      <QueryError query={users} />
      {!data && users.loading && <TableSkeleton columns={['Nombre', 'Correo', 'Rol', 'Estado', 'Creada', 'Acciones']} label="Cargando cuentas…" />}
      {data && data.items.length === 0 && <div className="panel panel-empty"><p>No hay cuentas que coincidan con la búsqueda.</p></div>}

      {data && data.items.length > 0 && (
        <section className="panel" aria-label="Cuentas" aria-busy={users.loading}>
          <div className="compare-scroll">
            <table className={`data-table${users.loading ? ' is-refreshing' : ''}`}>
              <thead><tr><th scope="col">Nombre</th><th scope="col">Correo</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Creada</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id}>
                    <td data-label="Nombre"><strong>{user.name}</strong></td>
                    <td data-label="Correo">{user.email}{!user.emailVerified && <small className="muted"> · sin verificar</small>}</td>
                    <td data-label="Rol">{user.role === 'admin' ? <StatusPill tone="accent">Admin</StatusPill> : 'Cliente'}</td>
                    <td data-label="Estado"><StatusPill tone={user.active ? 'success' : 'danger'}>{user.active ? 'Activa' : 'Desactivada'}</StatusPill></td>
                    <td data-label="Creada">{formatFullDate(user.createdAt)}</td>
                    <td className="cell-action"><button type="button" className="btn btn-secondary btn-small" onClick={() => setSelected(user.id)}>Ver detalle</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="pager" aria-label="Páginas de usuarios">
              <button type="button" className="icon-button" onClick={() => setFilters({ ...filters, page: filters.page - 1 })} disabled={filters.page <= 1 || users.loading} aria-label="Página anterior"><ChevronLeft strokeWidth={2} /></button>
              <span>Página {filters.page} de {pages} · {data.total} cuentas</span>
              <button type="button" className="icon-button" onClick={() => setFilters({ ...filters, page: filters.page + 1 })} disabled={filters.page >= pages || users.loading} aria-label="Página siguiente"><ChevronRight strokeWidth={2} /></button>
            </nav>
          )}
        </section>
      )}

      {selected && <UserDetail id={selected} onClose={() => setSelected(null)} onChanged={users.reload} />}
    </div>
  );
}

function UserDetail({ id, onClose, onChanged }) {
  const { session } = useSession();
  const { toast } = useToast();
  const detail = useAdminQuery((options) => getUser(id, options), [id]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const user = detail.data;
  const self = user?.id === session.user.id;

  async function toggle() {
    setBusy(true); setError(null);
    try {
      await setUserStatus(user.id, !user.active, { token: session.token });
      toast({ type: 'success', title: user.active ? 'Cuenta desactivada' : 'Cuenta activada', message: user.email });
      setConfirming(false);
      detail.reload();
      onChanged();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <ActionDialog title="Detalle de la cuenta" confirmLabel="Cerrar" onConfirm={onClose} onClose={onClose} hideCancel error={detail.error}>
        {detail.loading && <DetailSkeleton rows={5} label="Cargando el detalle de la cuenta…" />}
      </ActionDialog>
    );
  }

  return (
    <ActionDialog title={confirming ? (user.active ? 'Desactivar cuenta' : 'Activar cuenta') : user.name}
      confirmLabel={confirming ? (user.active ? 'Desactivar' : 'Activar') : user.active ? 'Desactivar cuenta' : 'Activar cuenta'}
      busyLabel="Guardando…" busy={busy} error={error} disabled={self}
      cancelLabel={confirming ? 'Volver' : 'Cerrar'} onClose={confirming ? () => setConfirming(false) : onClose}
      onConfirm={confirming ? toggle : () => setConfirming(true)}>
      {confirming ? (
        <p>{user.active
          ? `${user.email} perderá el acceso de inmediato: su sesión abierta dejará de funcionar y no podrá iniciar sesión.`
          : `${user.email} podrá volver a iniciar sesión.`}</p>
      ) : (
        <dl className="kv-list">
          <div><dt>Correo</dt><dd>{user.email}</dd></div>
          <div><dt>Rol</dt><dd>{user.role === 'admin' ? 'Administrador' : 'Cliente'}</dd></div>
          <div><dt>Estado</dt><dd><StatusPill tone={user.active ? 'success' : 'danger'}>{user.active ? 'Activa' : 'Desactivada'}</StatusPill></dd></div>
          <div><dt>Correo verificado</dt><dd>{user.emailVerified ? 'Sí' : 'No'}</dd></div>
          <div><dt>Creada</dt><dd>{formatFullDate(user.createdAt)}</dd></div>
        </dl>
      )}
      {self && <p className="muted">No puedes desactivar tu propia cuenta.</p>}
    </ActionDialog>
  );
}
