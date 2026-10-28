import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Sparkles } from 'lucide-react';
import { useLibrary } from '../storage/library.jsx';
import { formatBytes } from '../storage/format.js';
import { planFeatures, planPrice, usePlans } from './subscriptions.api.js';

const reasons = {
  '/app/storage': 'Haz espacio para tu próxima colección.',
  '/app/albums': 'Más espacio para cada proyecto.',
  '/app/upload': 'Que tus ideas no esperen al día siguiente.',
  '/app/history': 'Crea a tu ritmo, todos los días.',
  '/app/trash': 'Más espacio para lo que decides conservar.',
  '/app/insights': 'Combina tu ahorro con más capacidad.',
};

/** Invita a mejorar solo a cuentas Free, con los datos reales del plan Pro (GET /plans). */
export function PlanPromotion({ pathname }) {
  const { quota } = useLibrary();
  const { plans } = usePlans();
  const pro = plans.find((plan) => plan.code === 'pro');
  if (quota.data?.plan.code !== 'free' || !pro) return null;
  const overview = pathname === '/app';
  const reason = reasons[pathname];
  if (!overview && !reason) return null;

  if (!overview) return <aside className="plan-context" aria-label="Ventaja de Pro">
    <Sparkles aria-hidden="true" />
    <p><strong>{reason}</strong> Pro te da {formatBytes(pro.capacityBytes)} por {planPrice(pro)} al mes.</p>
    <span className="pro-coming">Pro · {planPrice(pro)} / mes</span>
  </aside>;

  return <section className="upgrade-banner" aria-labelledby="upgrade-title">
    <div className="upgrade-banner-content">
      <div className="upgrade-eyebrow"><span>Tu plan: Free</span><span>Pro</span></div>
      <h2 id="upgrade-title">Tus ideas merecen más espacio.</h2>
      <p>Da el siguiente paso con SmartStorage Pro.</p>
      <ul>{planFeatures(pro).map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}</ul>
    </div>
    <div className="upgrade-banner-action">
      <p><strong>{planPrice(pro)}</strong><span> / mes</span></p>
      <Link className="btn btn-primary" to="/app/plans">Mejorar plan<ArrowUpRight aria-hidden="true" /></Link>
      <small>Pago simulado con tarjeta de prueba</small>
    </div>
  </section>;
}
