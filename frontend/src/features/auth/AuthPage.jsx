import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, MailCheck, MailWarning, Mail, RotateCw, UserRound } from 'lucide-react';
import { authErrorMessage, resendVerification } from './auth.api.js';
import { AuthShell, AuthStatusIcon, Collapse, Field, PasswordField, SubmitButton } from './AuthLayout.jsx';
import { fieldForServerError, validateLogin, validateRegistration } from './auth.validation.js';
import { useSession } from './session.jsx';

const empty = { name: '', email: '', password: '' };

export function AuthPage({ mode }) {
  const register = mode === 'register';
  const { session, login, register: registerAccount } = useSession();
  const navigate = useNavigate();
  const notice = useLocation().state?.notice;
  const [values, setValues] = useState(empty);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [unverified, setUnverified] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/app" replace />;
  if (registeredEmail) return <CheckEmail email={registeredEmail} />;

  const localErrors = register ? validateRegistration(values) : validateLogin(values);
  const errorFor = (field) => ((submitted || touched[field]) && localErrors[field]) || (serverErrors[field] ? [serverErrors[field]] : null);

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      setServerErrors((current) => ({ ...current, [field]: undefined }));
      setFormError(null);
      if (field === 'email') setUnverified(false);
    };
  }
  const blur = (field) => () => { if (values[field]) setTouched((current) => ({ ...current, [field]: true })); };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    setUnverified(false);
    if (Object.keys(localErrors).length) {
      const first = ['name', 'email', 'password'].find((field) => localErrors[field]);
      event.currentTarget.querySelector(`[name="${first}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      if (register) {
        // El registro no inicia sesión: primero hay que verificar el correo.
        await registerAccount(values);
        setRegisteredEmail(values.email.trim());
        return;
      }
      await login({ email: values.email, password: values.password });
      navigate('/app', { replace: true });
    } catch (error) {
      if (error?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
      } else {
        const field = fieldForServerError(error);
        if (field) setServerErrors({ [field]: authErrorMessage(error) });
        else setFormError(authErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      badge={register ? 'Plan Free · 2 GB gratis' : 'Tu biblioteca te espera'}
      title={register ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}
      intro={register ? 'Empieza a guardar tus imágenes en WebP, sin copias repetidas.' : 'Inicia sesión para ver y subir tus imágenes.'}
    >
      {notice && !formError && <p className="auth-notice" role="status"><CheckCircle2 strokeWidth={2} aria-hidden="true" />{notice}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={busy} className="auth-fields">
          <legend className="sr-only">{register ? 'Datos de registro' : 'Credenciales'}</legend>
          {register && (
            <Field label="Nombre" name="name" icon={UserRound} autoComplete="name" placeholder="Tu nombre" maxLength={120}
              value={values.name} onChange={update('name')} onBlur={blur('name')} errors={errorFor('name')} />
          )}
          <Field label="Correo electrónico" name="email" type="email" icon={Mail} autoComplete="email" placeholder="tu@correo.com" maxLength={254}
            value={values.email} onChange={update('email')} onBlur={blur('email')} errors={errorFor('email')} />
          <PasswordField isNew={register} value={values.password} onChange={update('password')} onBlur={blur('password')} errors={errorFor('password')} />

          {!register && <Link className="auth-forgot" to="/forgot-password" state={{ email: values.email }}>¿Olvidaste tu contraseña?</Link>}

          <Collapse open={unverified}>
            <UnverifiedNotice email={values.email.trim()} />
          </Collapse>

          <Collapse open={Boolean(formError)}>
            <p className="auth-form-error" role="alert"><AlertCircle strokeWidth={2} aria-hidden="true" />{formError}</p>
          </Collapse>

          <SubmitButton busy={busy} busyLabel={register ? 'Creando tu cuenta…' : 'Entrando…'} icon={ArrowRight}>
            {register ? 'Crear cuenta' : 'Iniciar sesión'}
          </SubmitButton>
        </fieldset>
      </form>

      <p className="auth-switch">
        {register ? '¿Ya tienes cuenta?' : '¿Todavía no tienes cuenta?'}{' '}
        <Link to={register ? '/login' : '/register'}>{register ? 'Inicia sesión' : 'Crea una gratis'}</Link>
      </p>
    </AuthShell>
  );
}

/** Botón de reenvío con estado propio. La respuesta del servidor es neutral. */
export function ResendButton({ email }) {
  return <ResendForEmail key={email.trim().toLowerCase()} email={email} />;
}

function ResendForEmail({ email }) {
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState(null);

  async function resend() {
    setState('sending');
    try {
      await resendVerification(email);
      setState('sent');
      setMessage('Si la cuenta existe y no está verificada, te enviamos un nuevo enlace.');
    } catch (error) {
      setState('idle');
      setMessage(authErrorMessage(error));
    }
  }

  return (
    <div className="auth-resend">
      <button type="button" className="auth-secondary" onClick={resend} disabled={state === 'sending' || state === 'sent' || !email}>
        {state === 'sending' ? <span className="auth-spinner" aria-hidden="true" /> : state === 'sent' ? <CheckCircle2 strokeWidth={2} aria-hidden="true" /> : <RotateCw strokeWidth={2} aria-hidden="true" />}
        {state === 'sent' ? 'Enlace reenviado' : 'Reenviar correo de verificación'}
      </button>
      <Collapse open={Boolean(message)}><p className="auth-resend-note" role="status">{message}</p></Collapse>
    </div>
  );
}

function UnverifiedNotice({ email }) {
  return (
    <div className="auth-warning" role="alert">
      <p><MailWarning strokeWidth={2} aria-hidden="true" /><span><strong>Verifica tu correo para entrar.</strong> Abre el enlace que te enviamos a <b>{email}</b>.</span></p>
      <ResendButton email={email} />
    </div>
  );
}

/** Pantalla tras registrarse: la cuenta existe pero falta verificar el correo. */
function CheckEmail({ email }) {
  return (
    <AuthShell badge="Último paso" title="Revisa tu correo">
      <div className="auth-state">
        <AuthStatusIcon icon={MailCheck} tone="accent" />
        <p>Enviamos un enlace de verificación a <strong>{email}</strong>. Ábrelo para activar tu cuenta y después inicia sesión.</p>
        <p className="auth-small">El enlace vence en 24 horas. Si no lo ves, revisa la carpeta de spam.</p>
      </div>
      <div className="auth-actions">
        <Link className="auth-submit" to="/login"><span>Ir a iniciar sesión</span><ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
        <ResendButton email={email} />
      </div>
    </AuthShell>
  );
}
