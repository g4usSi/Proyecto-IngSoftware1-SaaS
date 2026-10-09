import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { AuthShell, AuthStatusIcon } from './AuthLayout.jsx';

export function SessionRequired() {
  const navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => navigate('/', { replace: true }), 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <AuthShell badge="Acceso restringido" title="Página no disponible">
      <div className="auth-state" role="status">
        <AuthStatusIcon icon={LockKeyhole} />
        <p>Necesitas iniciar sesión para acceder a esta página.</p>
        <p className="auth-small">Volverás al inicio en unos segundos.</p>
      </div>
      <div className="auth-actions">
        <Link className="auth-submit" to="/login">Iniciar sesión</Link>
        <Link className="auth-secondary" to="/">Volver al inicio ahora</Link>
      </div>
    </AuthShell>
  );
}
