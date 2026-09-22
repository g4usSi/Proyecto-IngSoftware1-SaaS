import { useEffect, useState } from 'react';
import { PendingState } from '../../components/PendingState.jsx';
import { Icon } from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';

const numberFormat = new Intl.NumberFormat('es-GT', { maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ', maximumFractionDigits: 2 });

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Por definir';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = bytes > 0 ? Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1)) : 0;
  return `${numberFormat.format(bytes / 1000 ** unitIndex)} ${units[unitIndex]}`;
}

export function PlansPage() {
  const [catalog, setCatalog] = useState({ status: 'loading', plans: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    setCatalog({ status: 'loading', plans: [] });

    apiRequest('/plans', { signal: controller.signal })
      .then((plans) => {
        if (!Array.isArray(plans)) throw new Error('Invalid plans response');
        if (active) setCatalog({ status: 'ready', plans });
      })
      .catch(() => { if (active) setCatalog({ status: 'unavailable', plans: [] }); })
      .finally(() => clearTimeout(timeout));

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">CAPACIDAD PARA CREAR</span><h1>Un espacio a tu medida.</h1><p>Elige cuánto espacio necesitas, cuando lo necesites.</p></div></div>
      <section className="library-panel" aria-label="Catálogo de planes" aria-busy={catalog.status === 'loading'}>
        <div className="panel-heading"><span><Icon name="plan" /> Planes de almacenamiento</span><span className="small-badge">Catálogo</span></div>
        {catalog.status === 'loading' && <div role="status"><PendingState icon="plan" title="Consultando los planes…" eyebrow="Conectando">Estamos cargando el catálogo disponible.</PendingState></div>}
        {catalog.status === 'unavailable' && <div role="status"><PendingState icon="plan" title="El catálogo no está disponible." eyebrow="Inténtalo de nuevo">No pudimos consultar los planes en este momento. Puedes volver a intentarlo en unos instantes.</PendingState><div className="catalog-retry"><button className="button button-dark" type="button" onClick={() => setAttempt((value) => value + 1)}>Volver a intentar</button></div></div>}
        {catalog.status === 'ready' && catalog.plans.length === 0 && <PendingState icon="plan" title="Estamos preparando los planes.">Todavía no hay planes publicados en el catálogo.</PendingState>}
        {catalog.status === 'ready' && catalog.plans.length > 0 && <div className="plans-grid">{catalog.plans.map((plan) => <article className="plan-card" key={plan.id}>
          <span className="eyebrow">{plan.code}</span><h2>{plan.name}</h2>
          <div className="plan-price">{plan.monthlyPriceGtq === null ? 'Precio por definir' : moneyFormat.format(Number(plan.monthlyPriceGtq))}{plan.monthlyPriceGtq !== null && <small> / mes</small>}</div>
          <ul><li><strong>{formatBytes(plan.capacityBytes)}</strong> de capacidad</li><li>{plan.dailyUploadLimit === null ? 'Sin límite de subidas diario' : `${numberFormat.format(plan.dailyUploadLimit)} subidas al día`}</li><li>{plan.dailyBytesLimit === null ? 'Sin límite de tamaño diario' : `${formatBytes(plan.dailyBytesLimit)} de subida al día`}</li></ul>
          <button type="button" disabled className="button button-dark" aria-describedby="subscription-pending">Disponible próximamente</button>
        </article>)}</div>}
        <div className="library-note" id="subscription-pending"><Icon name="lock" /><span>La contratación de planes estará disponible al integrar las cuentas.</span></div>
      </section>
      <div className="feature-explainer"><span className="explainer-icon"><Icon name="spark" /></span><div><h2>Empieza por lo sencillo.</h2><p>El plan Free será el punto de partida al crear una cuenta. Todavía no hay una suscripción activa en esta vista.</p></div></div>
    </>
  );
}
