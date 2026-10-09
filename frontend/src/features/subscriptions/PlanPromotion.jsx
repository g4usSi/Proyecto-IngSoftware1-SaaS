import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Sparkles } from 'lucide-react';
import { useLibrary } from '../storage/library.jsx';
import { plans } from './plans.data.js';

const pro = plans.find((plan) => plan.code === 'pro');
const reasons = {
  '/app/storage': { title: 'Haz espacio para tu próxima colección.', text: 'Pro tendrá 100 GB para que tu biblioteca pueda seguir creciendo.' },
  '/app/albums': { title: 'Más espacio para cada proyecto.', text: 'Con los 100 GB de Pro podrás guardar más imágenes en tus álbumes.' },
  '/app/upload': { title: 'Que tus ideas no esperen al día siguiente.', text: 'Pro incluirá subidas sin límite diario, dentro de la capacidad de tu plan.' },
  '/app/history': { title: 'Crea a tu ritmo, todos los días.', text: 'Pro incluirá subidas sin límite diario para tus próximas sesiones de trabajo.' },
  '/app/jobs': { title: 'Tus próximas imágenes, con prioridad.', text: 'Pro incluirá prioridad de procesamiento para tus nuevas subidas.' },
  '/app/trash': { title: 'Más espacio para lo que decides conservar.', text: 'Pro tendrá 100 GB para ampliar tu biblioteca.' },
  '/app/insights': { title: 'Combina tu ahorro con más capacidad.', text: 'Pro sumará 100 GB de almacenamiento a la conversión WebP que ya usas.' },
  '/app/security': { title: 'Prepara tu siguiente proyecto.', text: 'Pro incluirá acceso completo al SDK para integrar tus flujos de imágenes.' },
};

/** Presenta el catálogo futuro sin simular una compra ni atribuir a Pro soluciones a errores. */
export function PlanPromotion({ pathname }) {
  const { quota } = useLibrary();
  if (quota.data?.plan.code !== 'free') return null;
  const overview = pathname === '/app';
  const reason = reasons[pathname];
  if (!overview && !reason) return null;

  if (!overview) return <aside className="plan-context" aria-label="Ventaja de Pro">
    <Sparkles aria-hidden="true" />
    <p><strong>{reason.title}</strong> {reason.text}</p>
    <span className="pro-coming">Pro · Próximamente</span>
  </aside>;

  return <section className="upgrade-banner" aria-labelledby="upgrade-title">
    <div className="upgrade-banner-content">
      <div className="upgrade-eyebrow"><span>Tu plan: Free</span><span>Pro · Próximamente</span></div>
      <h2 id="upgrade-title">Tus ideas merecen más espacio.</h2>
      <p>Conoce el siguiente paso para tu biblioteca con SmartStorage Pro.</p>
      <ul>{pro.features.map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}</ul>
    </div>
    <div className="upgrade-banner-action">
      <p><strong>{pro.price}</strong><span> / mes</span></p>
      <Link className="btn btn-primary" to="/app/plans">Mejorar plan<ArrowUpRight aria-hidden="true" /></Link>
      <small>Conoce los planes · Compra próximamente</small>
    </div>
  </section>;
}
