import { useAnimatedNumber } from '../../app/landing/motion.js';

/** Cifra con animación de conteo. value null = el servidor no pudo calcularla: se dice, no se inventa un 0. */
export function StatCard({ icon: StatIcon, label, value, format, hint, ready, accent, index = 0 }) {
  const animated = useAnimatedNumber(ready && value !== null ? value : 0, 900);
  return (
    <div className={`stat-card${accent ? ' is-accent' : ''}`} style={{ '--i': index }}>
      <span className="stat-icon" aria-hidden="true"><StatIcon strokeWidth={1.9} /></span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{!ready ? <span className="sk-line" /> : value === null ? <span className="stat-na">No disponible</span> : format(animated)}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
