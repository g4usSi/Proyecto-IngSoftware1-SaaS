import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Check, RefreshCw, Receipt, RotateCw } from 'lucide-react';
import { useSession } from '../auth/session.jsx';
import { useLibrary } from '../storage/library.jsx';
import { QuotaSummary } from '../storage/QuotaSummary.jsx';
import { formatBytes, formatDate } from '../storage/format.js';
import { storageErrorMessage } from '../storage/storage.api.js';
import { PaymentDialog } from './PaymentDialog.jsx';
import { getMySubscription, isFreePlan, PLAN_LEVELS, planFeatures, planPrice, usePlans } from './subscriptions.api.js';

export function useSubscription() {
  const { session } = useSession();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getMySubscription({ token: session.token, signal });
      if (!signal?.aborted) setState({ data, loading: false, error: null });
    } catch (error) {
      if (!signal?.aborted) setState((current) => ({ ...current, loading: false, error: storageErrorMessage(error) }));
    }
  }, [session.token]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  return { ...state, reload: () => load() };
}

function actionFor(plan, current) {
  if (!current || plan.code === current.code) return null;
  if (isFreePlan(current)) return isFreePlan(plan) ? null : { mode: 'checkout', label: 'Contratar' };
  return PLAN_LEVELS[plan.code] > PLAN_LEVELS[current.code] ? { mode: 'upgrade', label: 'Mejorar plan' } : { mode: 'downgrade', label: `Cambiar a ${plan.name}` };
}

export function PlansPage() {
  const { refreshQuota } = useLibrary();
  const catalog = usePlans();
  const subscription = useSubscription();
  const [dialog, setDialog] = useState(null);
  const current = subscription.data?.plan ?? null;

  function done() {
    subscription.reload();
    refreshQuota();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Tu plan</span>
          <h1>Planes y suscripción</h1>
          <p>Contrata, renueva o cambia de plan. Los pagos son simulados con tarjetas de prueba.</p>
        </div>
        <Link className="btn btn-secondary" to="/app/payments"><Receipt aria-hidden="true" />Historial de pagos</Link>
      </header>

      <section className="panel subscription-card" aria-labelledby="subscription-title" aria-busy={subscription.loading}>
        <div className="panel-head">
          <h2 id="subscription-title">Suscripción actual</h2>
          <button type="button" className="icon-button is-small" onClick={subscription.reload} disabled={subscription.loading} aria-label="Actualizar suscripción" title="Actualizar">
            <RefreshCw className={subscription.loading ? 'spin' : undefined} strokeWidth={2} />
          </button>
        </div>
        {subscription.error && <div className="gallery-error" role="alert"><p>{subscription.error}</p><button type="button" className="btn btn-secondary" onClick={subscription.reload}>Volver a intentar</button></div>}
        {!subscription.data && !subscription.error && <div className="sub-grid is-loading" aria-hidden="true"><span className="sk-line" /><span className="sk-line short" /></div>}
        {subscription.data && (
          <div className="sub-grid">
            <div><span>Plan</span><strong>{current.name}</strong></div>
            <div><span>Precio</span><strong>{planPrice(current)}{Number(current.monthlyPrice) > 0 && <small> / mes</small>}</strong></div>
            <div><span>Desde</span><strong>{formatDate(subscription.data.startedAt)}</strong></div>
            <div><span>Vence</span><strong>{subscription.data.expiresAt ? formatDate(subscription.data.expiresAt) : 'Sin vencimiento'}</strong></div>
            {!isFreePlan(current) && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ mode: 'renew', plan: current })}>
                <RotateCw aria-hidden="true" />Renovar un mes
              </button>
            )}
          </div>
        )}
      </section>

      <QuotaSummary upgrade={false} />

      {catalog.error && <div className="gallery-error" role="alert"><p>{catalog.error}</p><button type="button" className="btn btn-secondary" onClick={catalog.retry}>Volver a intentar</button></div>}
      {catalog.loading && <div className="app-plans" aria-hidden="true">{[0, 1, 2, 3].map((key) => <article className="app-plan" key={key}><span className="sk-line" /><span className="sk-line short" /></article>)}</div>}

      {!catalog.loading && !catalog.error && (
        <div className="app-plans">
          {catalog.plans.map((plan, index) => {
            const isCurrent = plan.code === current?.code;
            const action = actionFor(plan, current);
            return (
              <article className={`app-plan${plan.code === 'pro' ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`} key={plan.code} style={{ '--i': index }}>
                <div className="app-plan-head">
                  <h2>{plan.name}</h2>
                  {isCurrent && <span className="plan-tag is-current"><BadgeCheck strokeWidth={2} aria-hidden="true" />Tu plan</span>}
                  {plan.code === 'pro' && !isCurrent && <span className="plan-tag is-hot">Recomendado</span>}
                </div>
                <p className="app-plan-price"><strong>{planPrice(plan)}</strong>{Number(plan.monthlyPrice) > 0 && <span>/ mes</span>}</p>
                <ul>{planFeatures(plan).map((item) => <li key={item}><Check strokeWidth={2.4} aria-hidden="true" />{item}</li>)}</ul>
                {isCurrent ? <span className="btn btn-secondary is-static">Plan actual</span>
                  : action ? <button type="button" className={`btn ${action.mode === 'downgrade' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setDialog({ mode: action.mode, plan })} disabled={!subscription.data}>{action.label}</button>
                    : <span className="btn btn-ghost is-static">No disponible</span>}
              </article>
            );
          })}
        </div>
      )}

      {!catalog.loading && !catalog.error && catalog.plans.length > 0 && (
        <section className="compare-card" aria-labelledby="compare-title">
          <h2 id="compare-title">Compara los planes</h2>
          <div className="compare-scroll">
            <table className="compare-table">
              <thead><tr><th scope="col"><span className="sr-only">Característica</span></th>{catalog.plans.map((plan) => (
                <th scope="col" key={plan.code} className={plan.code === 'pro' ? 'is-featured' : undefined}>{plan.name}{plan.code === current?.code && <span className="cmp-current">Tu plan</span>}<small>{planPrice(plan)}</small></th>))}</tr></thead>
              <tbody>
                <tr><th scope="row">Almacenamiento</th>{catalog.plans.map((plan) => <td key={plan.code}>{formatBytes(plan.capacityBytes)}</td>)}</tr>
                <tr><th scope="row">Subidas por día</th>{catalog.plans.map((plan) => <td key={plan.code}>{plan.dailyUploadLimit === null ? 'Sin límite' : plan.dailyUploadLimit}</td>)}</tr>
                <tr><th scope="row">Envío por día</th>{catalog.plans.map((plan) => <td key={plan.code}>{plan.dailyBytesLimit === null ? 'Sin límite' : formatBytes(plan.dailyBytesLimit)}</td>)}</tr>
                <tr><th scope="row">Vigencia</th>{catalog.plans.map((plan) => <td key={plan.code}>{plan.billingPeriod === 'calendar_month' ? 'Mes calendario' : 'Sin vencimiento'}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="compare-note">Precios en dólares (USD). El almacenamiento cuenta el tamaño original de cada imagen, incluida la papelera. Si un plan de pago vence, vuelves a Free sin perder imágenes.</p>
        </section>
      )}

      {dialog && <PaymentDialog {...dialog} subscription={subscription.data} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
