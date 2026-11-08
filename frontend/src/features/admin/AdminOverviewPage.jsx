import { Link } from 'react-router-dom';
import { Copy, HardDrive, PiggyBank, Users } from 'lucide-react';
import { formatBytes } from '../storage/format.js';
import { StatCard } from '../storage/StatCard.jsx';
import { DetailSkeleton, RowsSkeleton } from '../../components/Skeletons.jsx';
import { AdminGate, AdminHead, isFirstLoad, QueryError, StatusPill } from './AdminShared.jsx';
import { getAdminSummary, getStorageStats, JOB_STATES, useAdminQuery } from './admin.api.js';

const n = (value) => Number(value);

/** Resumen global: cuentas, suscripciones vigentes, almacenamiento y ahorro (dos consultas independientes). */
export function AdminOverviewPage() {
  return <AdminGate><Overview /></AdminGate>;
}

function Overview() {
  const summary = useAdminQuery((options) => getAdminSummary(options), []);
  const stats = useAdminQuery((options) => getStorageStats(options), []);
  const s = summary.data;
  const st = stats.data;
  const loading = summary.loading || stats.loading;

  return (
    <div className="page">
      <AdminHead title="Panel de administración" description="Estado global de cuentas, planes, almacenamiento y procesamiento."
        loading={loading} onRefresh={() => { summary.reload(); stats.reload(); }} />

      <QueryError query={summary} />
      {isFirstLoad(summary) && (
        <div className="stats-grid">
          {[['Cuentas', Users], ['Almacenamiento lógico', HardDrive], ['Deduplicado', Copy], ['Ahorro total', PiggyBank]].map(([label, icon], index) => <StatCard key={label} icon={icon} label={label} value={null} format={String} ready={false} index={index} />)}
        </div>
      )}
      {s && (
        <div className="stats-grid">
          <StatCard icon={Users} label="Cuentas" value={n(s.users.total)} format={(v) => String(Math.round(v))} hint={`${s.users.active} activas · ${s.users.admins} admin`} ready index={0} />
          <StatCard icon={HardDrive} label="Almacenamiento lógico" value={n(s.storage.logicalBytes)} format={formatBytes} hint={`${formatBytes(s.storage.reservedBytes)} reservados`} ready index={1} />
          <StatCard icon={Copy} label="Deduplicado" value={n(s.storage.deduplicatedBytes)} format={formatBytes} hint={`${s.storage.deduplicatedPercent} % del lógico`} ready index={2} />
          <StatCard icon={PiggyBank} label="Ahorro total" value={st && st.savedPercent !== null ? n(st.savedPercent) : null} format={(v) => `${v.toFixed(1)} %`}
            hint={st ? `${formatBytes(st.savedBytes)} ahorrados` : stats.error ? 'no disponible' : undefined} ready={Boolean(st) || Boolean(stats.error)} accent index={3} />
        </div>
      )}

      <div className="overview-grid">
        <section className="panel" aria-labelledby="admin-storage-title">
          <div className="panel-head"><h2 id="admin-storage-title">Ahorro de almacenamiento</h2></div>
          <QueryError query={stats} />
          {isFirstLoad(stats) && <DetailSkeleton rows={5} label="Calculando el ahorro global…" />}
          {st && (
            <dl className="kv-list">
              <div><dt>Tamaño original (todas las referencias)</dt><dd>{formatBytes(st.originalSizeBytes)}</dd></div>
              <div><dt>Original único (sin duplicados)</dt><dd>{formatBytes(st.uniqueOriginalSizeBytes)}</dd></div>
              <div><dt>WebP en disco</dt><dd>{formatBytes(st.optimizedSizeBytes)}</dd></div>
              <div><dt>Ahorro</dt><dd>{formatBytes(st.savedBytes)} · {st.savedPercent} %</dd></div>
              <div><dt>Imágenes / objetos físicos</dt><dd>{st.imageCount} / {st.objectCount}</dd></div>
            </dl>
          )}
        </section>

        {isFirstLoad(summary) && <section className="panel" aria-label="Suscripciones vigentes"><RowsSkeleton rows={4} panel={false} label="Cargando suscripciones vigentes…" /></section>}
        {s && (
          <section className="panel" aria-labelledby="admin-plans-title">
            <div className="panel-head"><h2 id="admin-plans-title">Suscripciones vigentes</h2><Link className="panel-link" to="/app/admin/subscriptions">Ver todas</Link></div>
            <ul className="plan-bars">
              {s.plans.map((plan) => {
                const total = s.plans.reduce((sum, item) => sum + n(item.currentSubscriptions), 0) || 1;
                return (
                  <li key={plan.code}>
                    <span>{plan.name}</span>
                    <span className="usage-meter-track" aria-hidden="true"><i style={{ width: `${(n(plan.currentSubscriptions) / total) * 100}%` }} /></span>
                    <strong>{plan.currentSubscriptions}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {st?.duplicates && <DuplicatesPanel duplicates={st.duplicates} />}

      {s && (
        <section className="panel" aria-labelledby="admin-jobs-title">
          <div className="panel-head"><h2 id="admin-jobs-title">Cola de procesamiento</h2><Link className="panel-link" to="/app/admin/jobs">Ver cola</Link></div>
          <div className="job-counts">
            {Object.entries(JOB_STATES).map(([key, { label, tone }]) => (
              <div key={key}><StatusPill tone={tone}>{label}</StatusPill><strong>{s.jobs[key] ?? '0'}</strong></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Contenido repetido: cuántas veces se repite cada contenido y cuánto disco evita, sin mostrar imágenes, nombres ni cuentas. */
function DuplicatesPanel({ duplicates: d }) {
  const times = (value) => `${value} ${value === '1' ? 'vez' : 'veces'}`;
  return (
    <section className="panel duplicates-panel" aria-labelledby="admin-duplicates-title">
      <div className="panel-head"><h2 id="admin-duplicates-title">Contenido repetido</h2></div>
      <p className="muted">Imágenes idénticas se guardan una sola vez. Por privacidad no se muestran las imágenes, sus nombres ni las cuentas.</p>
      <dl className="kv-list">
        <div><dt>Contenidos repetidos</dt><dd>{d.objectCount}</dd></div>
        <div><dt>Copias que no ocuparon disco</dt><dd>{d.extraReferenceCount}</dd></div>
        <div><dt>Espacio evitado por deduplicación</dt><dd>{formatBytes(d.avoidedBytes)}</dd></div>
      </dl>
      {d.items.length === 0 ? <p className="muted">Todavía no hay imágenes repetidas.</p> : (
        <div className="compare-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Contenido</th><th scope="col">Se repite</th><th scope="col">Cuentas</th><th scope="col">Original</th><th scope="col">WebP guardado</th><th scope="col">Espacio evitado</th></tr></thead>
            <tbody>
              {d.items.map((item, index) => (
                // Sin identificador del contenido: la posición en la lista basta como clave.
                <tr key={index}>
                  <td data-label="Contenido">#{index + 1}</td>
                  <td data-label="Se repite"><strong>{times(item.references)}</strong></td>
                  <td data-label="Cuentas">{item.accounts}</td>
                  <td data-label="Original">{formatBytes(item.originalSizeBytes)}</td>
                  <td data-label="WebP guardado">{formatBytes(item.optimizedSizeBytes)} · 1 copia</td>
                  <td data-label="Espacio evitado"><strong>{formatBytes(item.avoidedBytes)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Number(d.objectCount) > d.items.length && <p className="muted">Se muestran los {d.items.length} que más espacio evitan.</p>}
    </section>
  );
}
