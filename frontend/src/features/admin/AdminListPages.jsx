import { useState } from 'react';
import { Search } from 'lucide-react';
import { TableSkeleton } from '../../components/Skeletons.jsx';
import { formatBytes, formatFullDate } from '../storage/format.js';
import { AdminGate, AdminHead, OffsetPager, QueryError, StatusPill, UsageBar } from './AdminShared.jsx';
import { AUDIT_REASONS, AUDIT_TYPES, JOB_STATES, listAdmin, useAdminQuery } from './admin.api.js';

const LIMIT = 20;
const PLAN_OPTIONS = [['', 'Todos los planes'], ['free', 'Free'], ['standard', 'Estándar'], ['pro', 'Pro'], ['enterprise', 'Enterprise']];

/** Filtros + offset. Cambiar un filtro vuelve a la primera página. */
function useOffsetList(path, initial) {
  const [filters, setFilters] = useState(initial);
  const [offset, setOffset] = useState(0);
  const query = useAdminQuery((options) => listAdmin(path, { ...filters, limit: LIMIT, offset }, options), [path, filters, offset]);
  const set = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setOffset(0); };
  return { query, filters, set, offset, setOffset };
}

function SearchBox({ value, onSearch, label = 'Buscar por nombre o correo' }) {
  const [draft, setDraft] = useState(value);
  return (
    <form className="search-inline" role="search" onSubmit={(event) => { event.preventDefault(); onSearch(draft.trim()); }}>
      <label className="search-field"><Search strokeWidth={2} aria-hidden="true" /><span className="sr-only">{label}</span>
        <input type="search" placeholder="Nombre o correo…" maxLength={100} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button type="submit" className="btn btn-secondary">Buscar</button>
    </form>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="select-field"><span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

/** Tabla con estados de carga, vacío y error; nunca muestra filas en cero si la API falla. */
function ListBody({ list, columns, empty, renderRow }) {
  const { query, offset, setOffset } = list;
  const data = query.data;
  return (
    <>
      <QueryError query={query} />
      {!data && query.loading && <TableSkeleton columns={columns} />}
      {data && data.items.length === 0 && <div className="panel panel-empty"><p>{empty}</p></div>}
      {data && data.items.length > 0 && (
        <section className="panel" aria-busy={query.loading}>
          <div className="compare-scroll">
            <table className={`data-table${query.loading ? ' is-refreshing' : ''}`}>
              <thead><tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
              <tbody>{data.items.map(renderRow)}</tbody>
            </table>
          </div>
          <OffsetPager total={data.total} limit={data.limit} offset={offset} onChange={setOffset} loading={query.loading} />
        </section>
      )}
    </>
  );
}

const UserCell = ({ user }) => (
  <td data-label="Usuario"><strong>{user.name}</strong><small className="muted block">{user.email}{!user.active && ' · desactivada'}</small></td>
);

export function AdminSubscriptionsPage() {
  return <AdminGate><Subscriptions /></AdminGate>;
}
function Subscriptions() {
  const list = useOffsetList('subscriptions', { status: '', plan: '', search: '' });
  return (
    <div className="page">
      <AdminHead title="Suscripciones" description="Historial de suscripciones por cuenta; «vigente» indica la que aplica hoy." loading={list.query.loading} onRefresh={list.query.reload} />
      <div className="panel admin-filters">
        <SearchBox value={list.filters.search} onSearch={(value) => list.set('search', value)} />
        <Select label="Estado" value={list.filters.status} onChange={(value) => list.set('status', value)}
          options={[['', 'Todos los estados'], ['active', 'Activa'], ['expired', 'Vencida'], ['cancelled', 'Cancelada']]} />
        <Select label="Plan" value={list.filters.plan} onChange={(value) => list.set('plan', value)} options={PLAN_OPTIONS} />
      </div>
      <ListBody list={list} empty="No hay suscripciones con esos filtros." columns={['Usuario', 'Plan', 'Estado', 'Inicio', 'Vence']}
        renderRow={(item) => (
          <tr key={item.id}>
            <UserCell user={item.user} />
            <td data-label="Plan">{item.plan.name}</td>
            <td data-label="Estado">
              <StatusPill tone={item.status === 'active' ? 'success' : 'muted'}>{({ active: 'Activa', expired: 'Vencida', cancelled: 'Cancelada' })[item.status] ?? item.status}</StatusPill>
              {item.current && <StatusPill tone="accent">Vigente</StatusPill>}
            </td>
            <td data-label="Inicio">{formatFullDate(item.startedAt)}</td>
            <td data-label="Vence">{item.expiresAt ? formatFullDate(item.expiresAt) : 'Sin vencimiento'}</td>
          </tr>
        )} />
    </div>
  );
}

export function AdminUsagePage() {
  return <AdminGate><Usage /></AdminGate>;
}
function Usage() {
  const list = useOffsetList('usage', { plan: '', search: '' });
  return (
    <div className="page">
      <AdminHead title="Consumo por cuenta" description="Ordenado por espacio comprometido (usado + reservado)." loading={list.query.loading} onRefresh={list.query.reload} />
      <div className="panel admin-filters">
        <SearchBox value={list.filters.search} onSearch={(value) => list.set('search', value)} />
        <Select label="Plan" value={list.filters.plan} onChange={(value) => list.set('plan', value)} options={PLAN_OPTIONS} />
      </div>
      <ListBody list={list} empty="No hay cuentas con esos filtros." columns={['Usuario', 'Plan', 'Usado', 'Reservado', 'Disponible', 'Uso', 'Imágenes']}
        renderRow={(item) => (
          <tr key={item.user.id}>
            <UserCell user={item.user} />
            <td data-label="Plan">{item.plan ? item.plan.name : <span className="muted">Sin plan</span>}</td>
            <td data-label="Usado" className="num">{formatBytes(item.usedBytes)}</td>
            <td data-label="Reservado" className="num">{formatBytes(item.reservedBytes)}</td>
            <td data-label="Disponible" className="num">{item.availableBytes === null ? <span className="muted">—</span> : formatBytes(item.availableBytes)}</td>
            <td data-label="Uso"><UsageBar percent={item.usedPercent} /></td>
            <td data-label="Imágenes" className="num">{item.imageCount}{Number(item.trashCount) > 0 && <small className="muted"> (+{item.trashCount} en papelera)</small>}</td>
          </tr>
        )} />
    </div>
  );
}

export function AdminJobsPage() {
  return <AdminGate><Jobs /></AdminGate>;
}
function Jobs() {
  const list = useOffsetList('jobs', { status: '' });
  return (
    <div className="page">
      <AdminHead title="Cola de procesamiento" description="Trabajos de conversión de todas las cuentas." loading={list.query.loading} onRefresh={list.query.reload} />
      <div className="panel admin-filters">
        <Select label="Estado" value={list.filters.status} onChange={(value) => list.set('status', value)}
          options={[['', 'Todos los estados'], ...Object.entries(JOB_STATES).map(([key, { label }]) => [key, label])]} />
      </div>
      <ListBody list={list} empty="No hay trabajos con ese estado." columns={['Archivo', 'Usuario', 'Estado', 'Intentos', 'Tamaño', 'Creado']}
        renderRow={(item) => {
          const state = JOB_STATES[item.status] ?? { label: item.status, tone: 'muted' };
          return (
            <tr key={item.id}>
              <td data-label="Archivo"><strong className="ellipsis" title={item.originalName}>{item.originalName}</strong>{item.sharedObject && <small className="muted block">Contenido ya existente (deduplicado)</small>}</td>
              <UserCell user={item.user} />
              <td data-label="Estado"><StatusPill tone={state.tone}>{state.label}</StatusPill>{item.retrying && <StatusPill tone="warn">Reintentando</StatusPill>}{item.errorCode && <small className="muted block">{item.errorCode}</small>}</td>
              <td data-label="Intentos" className="num">{item.attempts}</td>
              <td data-label="Tamaño" className="num">{formatBytes(item.originalSizeBytes)}</td>
              <td data-label="Creado">{formatFullDate(item.createdAt)}</td>
            </tr>
          );
        }} />
    </div>
  );
}

export function AdminAuditPage() {
  return <AdminGate><Audit /></AdminGate>;
}
function Audit() {
  const list = useOffsetList('audit-events', { type: '', search: '' });
  return (
    <div className="page">
      <AdminHead title="Bitácora" description="Inicios y cierres de sesión, fallos y cambios de contraseña o de estado de cuenta." loading={list.query.loading} onRefresh={list.query.reload} />
      <div className="panel admin-filters">
        <SearchBox value={list.filters.search} onSearch={(value) => list.set('search', value)} label="Buscar por correo" />
        <Select label="Tipo de evento" value={list.filters.type} onChange={(value) => list.set('type', value)} options={[['', 'Todos los eventos'], ...Object.entries(AUDIT_TYPES)]} />
      </div>
      <ListBody list={list} empty="No hay eventos con esos filtros." columns={['Fecha', 'Evento', 'Correo', 'Detalle', 'Origen']}
        renderRow={(item) => (
          <tr key={item.id}>
            <td data-label="Fecha">{formatFullDate(item.createdAt)}</td>
            <td data-label="Evento"><StatusPill tone={item.type === 'login_failed' ? 'danger' : item.type === 'account_status_changed' ? 'warn' : 'muted'}>{AUDIT_TYPES[item.type] ?? item.type}</StatusPill></td>
            <td data-label="Correo">{item.email ?? <span className="muted">—</span>}</td>
            <td data-label="Detalle">{item.detail?.reason ? AUDIT_REASONS[item.detail.reason] ?? item.detail.reason
              : item.type === 'account_status_changed' ? (item.detail?.active ? 'Cuenta activada' : 'Cuenta desactivada') : <span className="muted">—</span>}</td>
            <td data-label="Origen"><small className="muted ellipsis" title={item.userAgent ?? ''}>{item.ipAddress ?? '—'}</small></td>
          </tr>
        )} />
    </div>
  );
}
