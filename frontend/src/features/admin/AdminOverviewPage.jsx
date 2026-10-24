import { Link } from 'react-router-dom';
import { Copy, HardDrive, PiggyBank, Users } from 'lucide-react';
import { formatBytes } from '../storage/format.js';
import { StatCard } from '../storage/StatCard.jsx';
import { AdminGate, AdminHead, QueryError, StatusPill } from './AdminShared.jsx';
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
      {s && (
        <div className="stats-grid">
          <StatCard icon={Users} label="Cuentas" value={n(s.users.total)} format={(v) => String(Math.round(v))} hint={`${s.users.active} activas · ${s.users.admins} admin`} ready index={0} />
          <StatCard icon={HardDrive} label="Almacenamiento lógico" value={n(s.storage.logicalBytes)} format={formatBytes} hint={`${formatBytes(s.storage.reservedBytes)} reservados`} ready index={1} />
          <StatCard icon={Copy} label="Deduplicado" value={n(s.storage.deduplicatedBytes)} format={formatBytes} hint={`${s.storage.deduplicatedPercent} % del lógico`} ready index={2} />
          <StatCard icon={PiggyBank} label="Ahorro total" value={st ? n(st.savedPercent) : null} format={(v) => `${v.toFixed(1)} %`}
            hint={st ? `${formatBytes(st.savedBytes)} ahorrados` : stats.error ? 'no disponible' : undefined} ready={Boolean(st) || Boolean(stats.error)} accent index={3} />
        </div>
      )}

      <div className="overview-grid">
        <section className="panel" aria-labelledby="admin-storage-title">
          <div className="panel-head"><h2 id="admin-storage-title">Ahorro de almacenamiento</h2></div>
          <QueryError query={stats} />
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
