import { useEffect, useRef, useState } from 'react';
import { CircleCheckBig, Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { authErrorMessage, changePassword } from './auth.api.js';
import { newPasswordErrors, passwordRules } from './auth.validation.js';
import { useSession } from './session.jsx';
import './security.css';

export function ChangePasswordPage() {
  const { session } = useSession();
  return session ? <ChangePasswordForm key={session.token} token={session.token} email={session.user.email} /> : null;
}

function PasswordInput({ name, label, value, onChange, error, autoComplete, hint }) {
  const [visible, setVisible] = useState(false);
  const describedBy = [error && `${name}-error`, hint && 'security-password-hint'].filter(Boolean).join(' ') || undefined;
  return (
    <div className="security-field">
      <label htmlFor={name}>{label}</label>
      <div className="security-input">
        <input id={name} name={name} type={visible ? 'text' : 'password'} value={value} onChange={onChange}
          autoComplete={autoComplete} maxLength={128} required aria-invalid={Boolean(error)} aria-describedby={describedBy} />
        <button type="button" className="icon-button" aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
          aria-pressed={visible} onClick={() => setVisible((previous) => !previous)}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="security-error" id={`${name}-error`} role="alert">{error}</p>}
    </div>
  );
}

function ChangePasswordForm({ token, email }) {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  function update(name, value) {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: '', ...(name === 'newPassword' ? { confirmPassword: '' } : {}) }));
    setMessage('');
    setSuccess(false);
  }

  function showErrors(nextErrors) {
    setErrors(nextErrors);
    formRef.current?.elements.namedItem(Object.keys(nextErrors)[0])?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    if (requestRef.current) return;
    setSuccess(false);
    setMessage('');
    const nextErrors = {};
    if (!values.currentPassword) nextErrors.currentPassword = 'Escribe tu contraseña actual.';
    const missing = newPasswordErrors(values.newPassword);
    if (missing.length) nextErrors.newPassword = missing.map((problem) => passwordRules.find((rule) => rule.id === problem)?.label ?? problem).join('. ');
    else if (values.newPassword === values.currentPassword) nextErrors.newPassword = 'La nueva contraseña debe ser distinta de la actual.';
    if (values.confirmPassword !== values.newPassword || !values.confirmPassword) nextErrors.confirmPassword = 'Repite la nueva contraseña; ambas deben coincidir.';
    if (Object.keys(nextErrors).length) { showErrors(nextErrors); return; }

    setErrors({});
    setBusy(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      await changePassword(values, { token, signal: controller.signal });
      if (controller.signal.aborted) return;
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccess(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error?.code === 'INVALID_CURRENT_PASSWORD') setErrors({ currentPassword: authErrorMessage(error) });
      else setMessage(authErrorMessage(error));
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div><span className="kicker">Tu cuenta</span><h1>Cambiar contraseña</h1><p>Actualiza la contraseña de tu cuenta.</p></div>
      </header>
      <section className="security-card" aria-label="Seguridad de la cuenta">
        <form ref={formRef} onSubmit={submit} noValidate aria-busy={busy}>
          <input type="text" name="username" value={email} autoComplete="username" readOnly hidden />
          <fieldset disabled={busy}>
            <PasswordInput name="currentPassword" label="Contraseña actual" value={values.currentPassword}
              onChange={(event) => update('currentPassword', event.target.value)} error={errors.currentPassword} autoComplete="current-password" />
            <PasswordInput name="newPassword" label="Nueva contraseña" value={values.newPassword}
              onChange={(event) => update('newPassword', event.target.value)} error={errors.newPassword} autoComplete="new-password" hint />
            <p className="security-hint" id="security-password-hint">Entre 8 y 128 caracteres, con mayúscula, minúscula, número y símbolo.</p>
            <PasswordInput name="confirmPassword" label="Repite la nueva contraseña" value={values.confirmPassword}
              onChange={(event) => update('confirmPassword', event.target.value)} error={errors.confirmPassword} autoComplete="new-password" />
            {message && <p className="security-error" role="alert">{message}</p>}
            <button className="btn btn-primary" type="submit">
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
              {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </fieldset>
        </form>
        {success && <p className="security-success" role="status"><CircleCheckBig aria-hidden="true" />Contraseña actualizada. Tus sesiones siguen abiertas.</p>}
      </section>
    </div>
  );
}
