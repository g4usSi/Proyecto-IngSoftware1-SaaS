import { Link } from 'react-router-dom';
import { CalendarClock, CloudUpload, Gauge, HardDrive, RefreshCw, Rocket, TriangleAlert } from 'lucide-react';
import { useLibrary } from './library.jsx';
import { describeQuota, formatQuotaDay } from './quota.model.js';
import './quota.css';

const icons = { storage: HardDrive, uploads: CloudUpload, bytes: Gauge };
const levelText = { warn: 'Casi lleno', full: 'Lleno' };

function QuotaMeter({ item, index }) {
  const MeterIcon = icons[item.key];
  const percent = Math.round(item.ratio * 100);
  return (
    <li className={`quota-item is-${item.level}`} style={{ '--i': index }}>
      <div className="quota-item-head">
        <span className="quota-item-icon" aria-hidden="true"><MeterIcon strokeWidth={1.9} /></span>
        <span className="quota-item-label">{item.label}</span>
        {item.level !== 'ok' && <span className="quota-chip">{levelText[item.level]}</span>}
      </div>
      <p className="quota-item-value">
        <strong>{item.format(item.used)}</strong>
        <span>{item.unlimited ? ' · sin límite' : ` de ${item.format(item.limit)}`}</span>
      </p>
      {!item.unlimited && (
        <div className="quota-bar" role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} % ocupado`}>
          <i className="quota-bar-used" style={{ '--share': item.usedShare }} />
          <i className="quota-bar-reserved" style={{ '--share': item.reservedShare, '--offset': item.usedShare }} />
        </div>
      )}
      <p className="quota-item-foot">
        {item.reserved > 0 && <span className="quota-reserved-note"><i aria-hidden="true" />{item.format(item.reserved)} en proceso</span>}
        <span>{item.unlimited ? 'Tu plan no limita este valor' : `${item.format(item.free)} libres`}</span>
      </p>
    </li>
  );
}

/**
 * Plan y cuota del usuario según GET /api/quotas/me (S3-08).
 * Las cifras vienen del servidor; no se calculan con la página de la galería.
 */
export function QuotaSummary({ upgrade = true }) {
  const { quota, refreshQuota } = useLibrary();
  const view = describeQuota(quota.data);
  const day = view ? formatQuotaDay(view.day) : '';

  return (
    <section className={`panel quota-summary${view ? ` is-${view.level}` : ''}`} aria-labelledby="quota-title" aria-busy={quota.loading}>
      <div className="panel-head">
        <h2 id="quota-title">Tu plan{view && <span className="quota-plan">{view.plan.name}</span>}</h2>
        <div className="quota-actions">
          {upgrade && view && <Link className="panel-link" to="/app/plans"><Rocket strokeWidth={2} aria-hidden="true" />Mejorar plan</Link>}
          <button type="button" className="icon-button is-small" onClick={refreshQuota} disabled={quota.loading} aria-label="Actualizar cuota" title="Actualizar cuota">
            <RefreshCw className={quota.loading ? 'spin' : undefined} strokeWidth={2} />
          </button>
        </div>
      </div>

      {quota.error && <p className="quota-error" role="alert"><TriangleAlert strokeWidth={2} aria-hidden="true" />{quota.error}{view ? ' Los valores mostrados corresponden a la última consulta.' : ''}</p>}

      {!view && !quota.error && (
        <ul className="quota-grid is-loading" aria-label="Consultando el espacio y los límites de tu cuenta">
          {[0, 1, 2].map((index) => <li className="quota-item" key={index}><span className="sk-line" /><span className="sk-line short" /></li>)}
        </ul>
      )}

      {view && <>
        <ul className="quota-grid">
          {view.meters.map((item, index) => <QuotaMeter key={item.key} item={item} index={index} />)}
        </ul>

        {view.level === 'full' && (
          <div className="quota-callout" role="status">
            <TriangleAlert strokeWidth={2} aria-hidden="true" />
            <p>
              <strong>{view.blocking[0].key === 'storage' ? 'Tu espacio está lleno.' : 'Llegaste al límite diario de tu plan.'}</strong>
              {view.blocking[0].key === 'storage'
                ? ' Elimina imágenes desde la Papelera para liberar espacio o mejora tu plan.'
                : ' Podrás volver a subir después de medianoche (hora de Guatemala).'}
              {view.pending && ' Los procesos en curso también reservan cuota.'}
            </p>
          </div>
        )}

        <p className="quota-note">
          <CalendarClock strokeWidth={1.9} aria-hidden="true" />
          {day ? `Consumo del ${day}. ` : ''}Los límites diarios se reinician a medianoche, hora de Guatemala. Borrar una imagen libera espacio, pero no devuelve las subidas del día.
        </p>
      </>}
    </section>
  );
}
