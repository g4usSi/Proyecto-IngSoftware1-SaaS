import { useAnimatedNumber } from '../../app/landing/motion.js';

/** Cifra con animación de conteo. `format` convierte el número animado en texto. */
export function StatCard({ icon: StatIcon, label, value, format, hint, ready, accent, index = 0 }) {
  const animated = useAnimatedNumber(ready ? value : 0, 900);
  return (
    <div className={`stat-card${accent ? ' is-accent' : ''}`} style={{ '--i': index }}>
      <span className="stat-icon" aria-hidden="true"><StatIcon strokeWidth={1.9} /></span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{ready ? format(animated) : <span className="sk-line" />}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
