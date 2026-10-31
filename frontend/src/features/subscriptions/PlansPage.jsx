import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Check, RefreshCw, Receipt, RotateCw, TriangleAlert } from 'lucide-react';
import { RowsSkeleton, LoadingStatus } from '../../components/Skeletons.jsx';
import { useSession } from '../auth/session.jsx';
import { useLibrary } from '../storage/library.jsx';
import { QuotaSummary } from '../storage/QuotaSummary.jsx';
import { formatBytes, formatBytesCeil, formatDate, formatDateTime, formatMoney } from '../storage/format.js';
import { storageErrorMessage } from '../storage/storage.api.js';
import { PaymentDialog } from './PaymentDialog.jsx';
import { capacityShortfall, getMySubscription, isFreePlan, listPayments, PAYMENT_STATUS, PLAN_LEVELS, planFeatures, planPrice, usePlans } from './subscriptions.api.js';

const EXPIRY_WARNING_DAYS = 7;

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

function daysLeft(expiresAt) {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

function SubscriptionSkeleton() {
  return (
    <div className="sub-grid sk-fade" aria-hidden="true">
      {['Plan', 'Precio', 'Desde', 'Vence'].map((label) => <div key={label}><span>{label}</span><span className="sk-line sk-value" /></div>)}
    </div>
  );
}

function PlansSkeleton() {
  return (
    <div className="app-plans sk-fade">
      <LoadingStatus label="Cargando planes…" />
      {[0, 1, 2, 3].map((key) => (
        <article className="app-plan is-skeleton" key={key} aria-hidden="true">
          <span className="sk-line sk-title" />
          <span className="sk-line sk-price" />
          <span className="sk-line short" />
          <ul>{[0, 1, 2].map((item) => <li key={item}><span className="sk-line" /></li>)}</ul>
          <span className="sk-line sk-button" />
        </article>
      ))}
    </div>
  );
}

/** Une el plan con sus cobros: cada intento aparece aquí en cuanto termina, aprobado o no. */
function RecentPayments({ refreshKey }) {
  const { session } = useSession();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    listPayments({ page: 1, limit: 3, token: session.token, signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => { if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error: storageErrorMessage(error) })); });
    return () => controller.abort();
  }, [session.token, refreshKey, attempt]);

  const { data, loading, error } = state;
  if (data?.pagination.total === 0 && !error) return null;
  return (
    <section className="panel recent-payments" aria-labelledby="recent-payments-title" aria-busy={loading}>
      <div className="panel-head">
        <h2 id="recent-payments-title">Últimos pagos</h2>
        {data && <Link className="panel-link" to="/app/payments">Ver todos ({data.pagination.total}) <ArrowRight strokeWidth={2} aria-hidden="true" /></Link>}
      </div>
      {error && <div className="gallery-error" role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => setAttempt((value) => value + 1)}>Volver a intentar</button></div>}
      {!data && !error && <RowsSkeleton rows={3} panel={false} label="Cargando tus últimos pagos…" />}
      {data && (
        <ul className="recent-payments-list">
          {data.payments.map((payment) => {
            const status = PAYMENT_STATUS[payment.status] ?? { label: payment.status, tone: 'muted' };
            return (
              <li key={payment.id}>
                <div><strong>Plan {payment.planName}</strong><small>{formatDateTime(payment.createdAt)} · •••• {payment.cardLast4}</small></div>
                <span className="num">{formatMoney(payment.amount, payment.currency)}</span>
                <span className={`status-pill is-${status.tone}`}>{status.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PlansPage() {
  const { quota, refreshQuota } = useLibrary();
  const catalog = usePlans();
  const subscription = useSubscription();
  const [dialog, setDialog] = useState(null);
  const [paymentsVersion, setPaymentsVersion] = useState(0);
  const current = subscription.data?.plan ?? null;
  const days = subscription.data?.expiresAt ? daysLeft(subscription.data.expiresAt) : null;

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
          <div className="subscription-actions">
            {current && !isFreePlan(current) && (
              <button type="button" className="btn btn-primary btn-small" onClick={() => setDialog({ mode: 'renew', plan: current })}>
                <RotateCw aria-hidden="true" />Renovar un mes
              </button>
            )}
            <button type="button" className="icon-button is-small" onClick={subscription.reload} disabled={subscription.loading} aria-label="Actualizar suscripción" title="Actualizar">
              <RefreshCw className={subscription.loading ? 'spin' : undefined} strokeWidth={2} />
            </button>
          </div>
        </div>
        {subscription.error && <div className="gallery-error" role="alert"><p>{subscription.error}</p><button type="button" className="btn btn-secondary" onClick={subscription.reload}>Volver a intentar</button></div>}
        {!subscription.data && !subscription.error && <SubscriptionSkeleton />}
        {subscription.data && (
          <div className="sub-grid">
            <div><span>Plan</span><strong>{current.name}</strong></div>
            <div><span>Precio</span><strong>{planPrice(current)}{Number(current.monthlyPrice) > 0 && <small> / mes</small>}</strong></div>
            <div><span>Desde</span><strong>{formatDate(subscription.data.startedAt)}</strong></div>
            <div>
              <span>Vence</span>
              <strong>{subscription.data.expiresAt ? formatDate(subscription.data.expiresAt) : 'Sin vencimiento'}</strong>
              {days !== null && <small className={days <= EXPIRY_WARNING_DAYS ? 'sub-expiring' : undefined}>{days > 1 ? `Faltan ${days} días` : days === 1 ? 'Vence mañana' : 'Vence hoy'}</small>}
            </div>
          </div>
        )}
      </section>

      <QuotaSummary upgrade={false} title="Uso de tu plan" />

      {catalog.error && <div className="gallery-error" role="alert"><p>{catalog.error}</p><button type="button" className="btn btn-secondary" onClick={catalog.retry}>Volver a intentar</button></div>}
      {catalog.loading && <PlansSkeleton />}

      {!catalog.loading && !catalog.error && (
        <div className="app-plans">
          {catalog.plans.map((plan, index) => {
            const isCurrent = plan.code === current?.code;
            const action = actionFor(plan, current);
            const shortfall = action?.mode === 'downgrade' ? capacityShortfall(quota.data, plan) : null;
            return (
              <article className={`app-plan${plan.code === 'pro' ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`} key={plan.code} style={{ '--i': index }}>
                <div className="app-plan-head">
                  <h2>{plan.name}</h2>
                  {isCurrent && <span className="plan-tag is-current"><BadgeCheck strokeWidth={2} aria-hidden="true" />Tu plan</span>}
                  {plan.code === 'pro' && !isCurrent && <span className="plan-tag is-hot">Recomendado</span>}
                </div>
                <p className="app-plan-price"><strong>{planPrice(plan)}</strong><span>{Number(plan.monthlyPrice) > 0 ? '/ mes' : 'sin tarjeta'}</span></p>
                <ul>{planFeatures(plan).map((item) => <li key={item}><Check strokeWidth={2.4} aria-hidden="true" />{item}</li>)}</ul>
                {shortfall && <p className="app-plan-warning"><TriangleAlert strokeWidth={2} aria-hidden="true" />Libera {formatBytesCeil(shortfall.bytesToFree)} para poder cambiar</p>}
                {isCurrent ? <span className="btn is-static app-plan-current">Plan actual</span>
                  : action ? <button type="button" className={`btn ${action.mode === 'downgrade' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setDialog({ mode: action.mode, plan })}>{action.label}</button>
                    : subscription.loading ? <span className="btn is-static app-plan-pending"><span className="sk-line" /></span>
                      : <span className="btn btn-ghost is-static">No disponible</span>}
              </article>
            );
          })}
        </div>
      )}

      <RecentPayments refreshKey={paymentsVersion} />

      {!catalog.loading && !catalog.error && catalog.plans.length > 0 && (
        <section className="compare-card" aria-labelledby="compare-title">
          <h2 id="compare-title">Compara los planes</h2>
          <div className="compare-scroll">
            <table className="compare-table">
              <thead><tr><th scope="col"><span className="sr-only">Característica</span></th>{catalog.plans.map((plan) => (
                <th scope="col" key={plan.code} className={plan.code === 'pro' ? 'is-featured' : undefined}>{plan.name}{plan.code === current?.code && <span className="cmp-current">Tu plan</span>}<small>{planPrice(plan)}</small></th>))}</tr></thead>
              <tbody>
                <tr><th scope="row">Almacenamiento</th>{catalog.plans.map((plan) => <td key={plan.code} className={plan.code === 'pro' ? 'is-featured' : undefined}>{formatBytes(plan.capacityBytes)}</td>)}</tr>
                <tr><th scope="row">Subidas por día</th>{catalog.plans.map((plan) => <td key={plan.code} className={plan.code === 'pro' ? 'is-featured' : undefined}>{plan.dailyUploadLimit === null ? 'Sin límite' : plan.dailyUploadLimit}</td>)}</tr>
                <tr><th scope="row">Envío por día</th>{catalog.plans.map((plan) => <td key={plan.code} className={plan.code === 'pro' ? 'is-featured' : undefined}>{plan.dailyBytesLimit === null ? 'Sin límite' : formatBytes(plan.dailyBytesLimit)}</td>)}</tr>
                <tr><th scope="row">Vigencia</th>{catalog.plans.map((plan) => <td key={plan.code} className={plan.code === 'pro' ? 'is-featured' : undefined}>{plan.billingPeriod === 'calendar_month' ? 'Mes calendario' : 'Sin vencimiento'}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="compare-note">Precios en dólares (USD). El almacenamiento cuenta el tamaño original de cada imagen, incluida la papelera. Si un plan de pago vence, vuelves a Free sin perder imágenes.</p>
        </section>
      )}

      {dialog && <PaymentDialog {...dialog} subscription={subscription.data} onClose={() => setDialog(null)} onDone={done} onRecorded={() => setPaymentsVersion((value) => value + 1)} />}
    </div>
  );
}
