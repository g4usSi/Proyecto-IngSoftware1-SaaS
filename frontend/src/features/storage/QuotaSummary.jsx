import { RefreshCw } from 'lucide-react';
import { formatBytes } from './format.js';
import { useLibrary } from './library.jsx';
import './quota.css';

/** Cuota global confirmada por el servidor, independiente de los archivos de la página actual. */
export function QuotaSummary() {
  const { quota, refreshQuota } = useLibrary();
  const data = quota.data;
  const daily = data?.daily;
  const occupied = data ? Number(data.usedBytes) + Number(data.reservedBytes) : 0;
  const percent = data ? Math.min(100, occupied / Math.max(1, Number(data.capacityBytes)) * 100) : 0;
  const count = daily ? BigInt(daily.uploadsUsed) + BigInt(daily.uploadsReserved) : 0n;
  const bytes = daily ? BigInt(daily.bytesUsed) + BigInt(daily.bytesReserved) : 0n;
  const exhausted = data && (BigInt(data.availableBytes) === 0n ||
    (daily.uploadLimit !== null && count >= BigInt(daily.uploadLimit)) ||
    (daily.bytesLimit !== null && bytes >= BigInt(daily.bytesLimit)));

  return (
    <section className="panel quota-summary" aria-labelledby="quota-title" aria-busy={quota.loading}>
      <div className="panel-head">
        <h2 id="quota-title">Tu cuota{data ? ` · ${data.plan.name}` : ''}</h2>
        <button type="button" className="icon-button is-small" onClick={refreshQuota} disabled={quota.loading} aria-label="Actualizar cuota">
          <RefreshCw className={quota.loading ? 'spin' : undefined} strokeWidth={2} />
        </button>
      </div>
      {quota.error && <p className="quota-error" role="alert">{quota.error}{data ? ' Los valores mostrados corresponden a la última consulta.' : ''}</p>}
      {!data && !quota.error && <p className="panel-muted">Consultando el espacio y los límites de tu cuenta…</p>}
      {data && <>
        <div className="quota-meter" role="progressbar" aria-label="Capacidad usada y reservada" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="quota-values">
          <p><strong>{formatBytes(data.usedBytes)}</strong> usados de {formatBytes(data.capacityBytes)}<small>{formatBytes(data.reservedBytes)} reservados · {formatBytes(data.availableBytes)} disponibles</small></p>
          <p><strong>{count.toString()}{daily.uploadLimit === null ? '' : ` / ${daily.uploadLimit}`}</strong> subidas hoy<small>{daily.uploadsReserved} pendientes · {daily.uploadLimit === null ? 'Sin límite diario de subidas' : `Día ${daily.date}`}</small></p>
          <p><strong>{formatBytes(bytes)}</strong>{daily.bytesLimit === null ? ' enviados hoy' : ` / ${formatBytes(daily.bytesLimit)} hoy`}<small>{formatBytes(daily.bytesReserved)} pendientes · día de Guatemala</small></p>
        </div>
        {exhausted && <p className="quota-error" role="status">Alcanzaste un límite de tu plan. Los procesos pendientes también reservan cuota; el servidor confirmará cada nueva subida.</p>}
      </>}
    </section>
  );
}
