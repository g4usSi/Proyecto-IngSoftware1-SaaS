import { Link } from 'react-router-dom';
import { ArrowDownUp, ChevronDown, CloudUpload, KeyRound } from 'lucide-react';
import { questions } from './landing/Faq.jsx';

// Ayuda dentro de la aplicación: responde sin sacar al usuario de su sesión ni llevarlo a la página pública.
const appQuestions = [
  { q: '¿Cómo cambio de plan?', a: 'En «Planes», el botón «Cambiar de plan» baja a las tarjetas. También está en tu perfil, en «Pagos» y en la barra lateral. Subir de plan se paga con una tarjeta de prueba; bajar no cobra, pero tu consumo debe caber en el plan nuevo.' },
  { q: '¿Cómo recupero una imagen que borré?', a: 'Las imágenes que envías a la papelera siguen ahí hasta que las borras de forma definitiva, y siguen contando para tu espacio. Entra a «Papelera» y usa «Restaurar».' },
  { q: '¿Para qué sirven las claves de API?', a: 'Permiten que tus programas suban y consulten imágenes con el SDK de Python o de Node.js, sin tu contraseña. Están disponibles desde el plan Estándar. La clave se muestra una sola vez; si la pierdes, revócala y crea otra.' },
];

const shortcuts = [
  { to: '/app/upload', icon: CloudUpload, label: 'Subir imágenes' },
  { to: '/app/plans#cambiar-plan', icon: ArrowDownUp, label: 'Cambiar de plan' },
  { to: '/app/api-keys', icon: KeyRound, label: 'Claves de API' },
];

export function HelpPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Tu cuenta</span>
          <h1>Ayuda y preguntas</h1>
          <p>Respuestas rápidas sobre tus imágenes, tu plan y la privacidad de tu cuenta.</p>
        </div>
      </header>

      <nav className="help-shortcuts" aria-label="Accesos rápidos">
        {shortcuts.map(({ to, icon: Icon, label }) => (
          <Link key={to} className="btn btn-secondary" to={to}><Icon aria-hidden="true" />{label}</Link>
        ))}
      </nav>

      <section className="panel help-list" aria-labelledby="help-title">
        <h2 id="help-title">Preguntas frecuentes</h2>
        {[...appQuestions, ...questions].map(({ q, a }, index) => (
          <details key={q} open={index === 0}>
            <summary><span>{q}</span><ChevronDown strokeWidth={2} aria-hidden="true" /></summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
