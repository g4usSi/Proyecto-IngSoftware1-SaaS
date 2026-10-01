import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, LockKeyhole } from 'lucide-react';
import { useDemoAccount } from '../../app/AppLayout.jsx';
import { getDemoConfiguration, storageErrorMessage } from './storage.api.js';

/** Sin sesión: invita a iniciar sesión u ofrece la demo local si está activa. */
export function NoIdentity() {
  const { setDemoAccount } = useDemoAccount();
  const [demo, setDemo] = useState({ status: 'loading', accounts: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 10_000);
    let active = true;
    setDemo({ status: 'loading', accounts: [], error: null });
    getDemoConfiguration({ signal: controller.signal })
      .then((data) => { if (active) setDemo({ status: data.enabled ? 'enabled' : 'disabled', accounts: data.accounts ?? [], error: null }); })
      .catch((error) => { if (active) setDemo({ status: 'error', accounts: [], error: controller.signal.aborted ? 'El servicio tardó demasiado en responder.' : storageErrorMessage(error) }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  return (
    <div className="welcome-card">
      <span className="welcome-icon" aria-hidden="true"><LockKeyhole strokeWidth={1.6} /></span>
      <h1>Tu biblioteca te espera</h1>
      <p>Inicia sesión para subir imágenes, verlas y descargarlas en WebP.</p>
      <div className="welcome-actions">
        <Link className="btn btn-primary" to="/login">Iniciar sesión</Link>
        <Link className="btn btn-secondary" to="/register">Crear cuenta gratis</Link>
      </div>
      {demo.status === 'enabled' && (
        <div className="demo-picker">
          <span><FlaskConical strokeWidth={2} aria-hidden="true" />Demo local activa: elige una cuenta de prueba</span>
          <div>
            {demo.accounts.map((account) => (
              <button key={account.id} type="button" className="btn btn-secondary" onClick={() => setDemoAccount(account)}>{account.name}</button>
            ))}
          </div>
        </div>
      )}
      {demo.status === 'error' && (
        <p className="welcome-error">{demo.error} <button type="button" className="link-button" onClick={() => setAttempt((value) => value + 1)}>Reintentar</button></p>
      )}
    </div>
  );
}
