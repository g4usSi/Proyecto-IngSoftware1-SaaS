import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheckBig, KeyRound, LoaderCircle, Save } from 'lucide-react';
import { DetailSkeleton } from '../../components/Skeletons.jsx';
import { formatFullDate } from '../storage/format.js';
import { authErrorMessage, getMe, updateMe } from './auth.api.js';
import { useSession } from './session.jsx';
import './security.css';

const NAME_MAX = 120;

/** Perfil del cliente (GET/PATCH /auth/me): solo el nombre se edita; el correo es de solo lectura. */
export function ProfilePage() {
  const { session, updateUser } = useSession();
  const [profile, setProfile] = useState({ data: null, error: null });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setProfile((current) => ({ ...current, error: null }));
    getMe({ token: session.token, signal: controller.signal })
      .then((data) => { setProfile({ data, error: null }); setName(data.name); })
      .catch((reason) => { if (!controller.signal.aborted) setProfile({ data: null, error: authErrorMessage(reason) }); });
    return () => controller.abort();
  }, [session.token, attempt]);

  const trimmed = name.trim();
  const invalid = !trimmed ? 'Escribe tu nombre.' : trimmed.length > NAME_MAX ? `El nombre no puede superar ${NAME_MAX} caracteres.` : null;
  const unchanged = profile.data && trimmed === profile.data.name;

  async function submit(event) {
    event.preventDefault();
    if (invalid || unchanged || busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const user = await updateMe({ name: trimmed }, { token: session.token });
      setProfile({ data: user, error: null });
      setName(user.name);
      updateUser(user);
      setSaved(true);
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const user = profile.data;
  return (
    <div className="page">
      <header className="page-head">
        <div><span className="kicker">Tu cuenta</span><h1>Mi perfil</h1><p>Consulta tus datos y actualiza tu nombre.</p></div>
        <Link className="btn btn-secondary" to="/app/security"><KeyRound aria-hidden="true" />Cambiar contraseña</Link>
      </header>

      {profile.error && <div className="gallery-error" role="alert"><p>{profile.error}</p><button type="button" className="btn btn-secondary" onClick={() => setAttempt((value) => value + 1)}>Volver a intentar</button></div>}
      {!user && !profile.error && <div className="security-card"><DetailSkeleton rows={5} label="Cargando tu perfil…" /></div>}

      {user && (
        <section className="security-card" aria-label="Datos del perfil">
          <form onSubmit={submit} noValidate>
            <fieldset disabled={busy}>
              <div className="security-field">
                <label htmlFor="profile-name">Nombre</label>
                <div className="security-input">
                  <input id="profile-name" name="name" autoComplete="name" maxLength={NAME_MAX + 10} value={name}
                    onChange={(event) => { setName(event.target.value); setSaved(false); setError(null); }}
                    aria-invalid={Boolean(invalid)} aria-describedby={invalid ? 'profile-name-error' : undefined} />
                </div>
                {invalid && <p className="security-error" id="profile-name-error" role="alert">{invalid}</p>}
              </div>
              <div className="security-field">
                <label htmlFor="profile-email">Correo electrónico</label>
                <div className="security-input"><input id="profile-email" value={user.email} readOnly aria-describedby="profile-email-hint" /></div>
                <p className="security-hint" id="profile-email-hint">El correo no se puede cambiar desde aquí.</p>
              </div>
              <dl className="kv-list">
                <div><dt>Tipo de cuenta</dt><dd>{user.role === 'admin' ? 'Administrador' : 'Cliente'}</dd></div>
                <div><dt>Correo verificado</dt><dd>{user.emailVerified ? 'Sí' : 'No'}</dd></div>
                <div><dt>Miembro desde</dt><dd>{formatFullDate(user.createdAt)}</dd></div>
              </dl>
              {error && <p className="security-error" role="alert">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={Boolean(invalid) || unchanged}>
                {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}{busy ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </fieldset>
          </form>
          {saved && <p className="security-success" role="status"><CircleCheckBig aria-hidden="true" />Nombre actualizado.</p>}
        </section>
      )}
    </div>
  );
}
