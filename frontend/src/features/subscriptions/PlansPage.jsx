import { Link } from 'react-router-dom';
import { BadgeCheck, Check, Clock3, Minus } from 'lucide-react';
import { useSession } from '../auth/session.jsx';
import { plans } from './plans.data.js';

const comparison = [
  { label: 'Almacenamiento lógico', values: ['2 GB', '25 GB', '100 GB', '500 GB o a medida'] },
  { label: 'Subida diaria', values: ['10 subidas o 200 MB', '500 MB', 'Sin límite', 'A medida'] },
  { label: 'Conversión a WebP', values: [true, true, true, true] },
  { label: 'Deduplicación global', values: [true, true, true, true] },
  { label: 'Acceso al SDK/API', values: [false, 'Básico', 'Completo', 'Completo'] },
  { label: 'Prioridad de proceso', values: [false, false, true, true] },
  { label: 'Soporte prioritario', values: [false, false, false, true] },
];

function Cell({ value }) {
  if (value === true) return <Check className="cmp-yes" strokeWidth={2.4} aria-label="Incluido" />;
  if (value === false) return <Minus className="cmp-no" strokeWidth={2} aria-label="No incluido" />;
  return <span>{value}</span>;
}

export function PlansPage() {
  const { session } = useSession();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Mejorar plan</span>
          <h1>Más espacio cuando lo necesites</h1>
          <p>Todas las cuentas empiezan en Free. Los planes de pago estarán disponibles pronto.</p>
        </div>
      </header>

      <div className="app-plans">
        {plans.map((plan, index) => {
          const current = session && plan.code === 'free';
          return (
            <article className={`app-plan${plan.featured ? ' is-featured' : ''}${current ? ' is-current' : ''}`} key={plan.code} style={{ '--i': index }}>
              <div className="app-plan-head">
                <h2>{plan.name}</h2>
                {current && <span className="plan-tag is-current"><BadgeCheck strokeWidth={2} aria-hidden="true" />Tu plan</span>}
                {plan.featured && <span className="plan-tag is-hot">Recomendado</span>}
              </div>
              <p className="app-plan-price"><strong>{plan.price}</strong><span>/ mes</span></p>
              <p className="app-plan-desc">{plan.description}</p>
              <ul>{plan.features.map((item) => <li key={item}><Check strokeWidth={2.4} aria-hidden="true" />{item}</li>)}</ul>
              {plan.available
                ? (current
                  ? <span className="btn btn-secondary is-static">Plan actual</span>
                  : <Link className="btn btn-primary" to="/register">Empezar gratis</Link>)
                : <span className="btn btn-ghost is-static" title="Los pagos todavía no están habilitados"><Clock3 strokeWidth={2} aria-hidden="true" />{plan.cta} · Próximamente</span>}
            </article>
          );
        })}
      </div>

      <section className="compare-card" aria-labelledby="compare-title">
        <h2 id="compare-title">Compara los planes</h2>
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr><th scope="col"><span className="sr-only">Característica</span></th>{plans.map((plan) => <th scope="col" key={plan.code} className={plan.featured ? 'is-featured' : undefined}>{plan.name}<small>{plan.price} / mes</small></th>)}</tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={plans[index].code} className={plans[index].featured ? 'is-featured' : undefined}><Cell value={value} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="compare-note">Precios en quetzales. El almacenamiento lógico cuenta el tamaño original de cada subida, aunque guardemos solo el WebP.</p>
      </section>
    </div>
  );
}
