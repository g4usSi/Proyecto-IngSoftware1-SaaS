import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CircleCheckBig, KeyRound, LinkIcon, Mail, MailCheck, ShieldCheck } from 'lucide-react';
import { authErrorMessage, forgotPassword, resetPassword, verifyEmail } from './auth.api.js';
import { AuthShell, AuthStatusIcon, Collapse, Field, PasswordField, SubmitButton } from './AuthLayout.jsx';
import { ResendButton } from './AuthPage.jsx';
import { newPasswordErrors, validateEmailOnly } from './auth.validation.js';

/** /verify-email?token=… — se verifica una sola vez al abrir el enlace. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  return <VerifyEmailToken key={token} token={token} />;
}

function VerifyEmailToken({ token }) {
  const [state, setState] = useState({ status: token ? 'loading' : 'invalid', message: null });
  const [email, setEmail] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // StrictMode monta dos veces en desarrollo; el token es de un solo uso.
    if (!token || started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(() => setState({ status: 'verified', message: null }))
      .catch((error) => setState({
        status: error?.code === 'VERIFICATION_TOKEN_INVALID' || error?.code === 'VALIDATION_ERROR' ? 'invalid' : 'error',
        message: authErrorMessage(error),
      }));
  }, [token]);

  if (state.status === 'loading') {
    return (
      <AuthShell title="Verificando tu correo…">
        <div className="auth-state"><span className="auth-spinner is-large" aria-hidden="true" /><p role="status">Un momento, estamos confirmando tu enlace.</p></div>
      </AuthShell>
    );
  }

  if (state.status === 'verified') {
    return (
      <AuthShell badge="Cuenta activa" title="¡Correo verificado!">
        <div className="auth-state">
          <AuthStatusIcon icon={CircleCheckBig} tone="success" />
          <p>Tu cuenta ya está activa. Inicia sesión para empezar a subir tus imágenes.</p>
        </div>
        <div className="auth-actions">
          <Link className="auth-submit" to="/login"><span>Iniciar sesión</span><ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell badge="Enlace no válido" title={state.status === 'error' ? 'No pudimos verificar' : 'Este enlace ya no sirve'}>
      <div className="auth-state">
        <AuthStatusIcon icon={LinkIcon} tone="danger" />
        <p>{state.status === 'error' ? state.message : 'El enlace venció o ya se usó. Si ya verificaste tu cuenta, simplemente inicia sesión.'}</p>
      </div>
      <div className="auth-actions">
        <Link className="auth-submit" to="/login"><span>Ir a iniciar sesión</span><ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
        <div className="auth-inline-resend">
          <Field label="¿Necesitas otro enlace? Escribe tu correo" name="email" type="email" icon={Mail} autoComplete="email" placeholder="tu@correo.com"
            value={email} onChange={(event) => setEmail(event.target.value)} />
          <ResendButton email={validateEmailOnly(email).email ? '' : email.trim()} />
        </div>
      </div>
    </AuthShell>
  );
}

/** /forgot-password — siempre responde con el mismo aviso neutral. */
export function ForgotPasswordPage() {
  const initialEmail = useLocation().state?.email ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [formError, setFormError] = useState(null);
  const errors = validateEmailOnly(email);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (errors.email) return;
    setBusy(true);
    try {
      const data = await forgotPassword(email.trim());
      setSent(data?.message ?? 'Si el correo está registrado, te enviamos instrucciones para restablecer la contraseña.');
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell badge="Revisa tu correo" title="Te enviamos instrucciones">
        <div className="auth-state">
          <AuthStatusIcon icon={MailCheck} tone="accent" />
          <p>{sent}</p>
          <p className="auth-small">El enlace vence en 1 hora y sirve una sola vez.</p>
        </div>
        <div className="auth-actions">
          <Link className="auth-submit" to="/login"><span>Volver a iniciar sesión</span><ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell badge="Recuperar acceso" title="¿Olvidaste tu contraseña?" intro="Escribe tu correo y te enviaremos un enlace para crear una nueva.">
      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={busy} className="auth-fields">
          <Field label="Correo electrónico" name="email" type="email" icon={Mail} autoComplete="email" placeholder="tu@correo.com" maxLength={254}
            value={email} onChange={(event) => { setEmail(event.target.value); setFormError(null); }} errors={submitted ? errors.email : null} />
          <Collapse open={Boolean(formError)}>
            <p className="auth-form-error" role="alert"><AlertCircle strokeWidth={2} aria-hidden="true" />{formError}</p>
          </Collapse>
          <SubmitButton busy={busy} busyLabel="Enviando…" icon={ArrowRight}>Enviar enlace</SubmitButton>
        </fieldset>
      </form>
      <p className="auth-switch">¿La recordaste? <Link to="/login">Inicia sesión</Link></p>
    </AuthShell>
  );
}

/** /reset-password?token=… — nueva contraseña con las mismas reglas del registro. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  return <ResetPasswordToken key={token} token={token} />;
}

function ResetPasswordToken({ token }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(token ? 'form' : 'invalid');
  const [serverError, setServerError] = useState(null);

  const passwordErrors = newPasswordErrors(password);
  const confirmErrors = confirm !== password ? ['Las contraseñas no coinciden.'] : [];
  const showPassword = (submitted || password) && passwordErrors.length ? passwordErrors : serverError ? [serverError] : null;

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (passwordErrors.length || confirmErrors.length) return;
    setBusy(true);
    try {
      await resetPassword({ token, password });
      setStatus('done');
    } catch (error) {
      if (error?.code === 'RESET_TOKEN_INVALID') setStatus('invalid');
      else setServerError(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (status === 'done') {
    return (
      <AuthShell badge="Listo" title="Contraseña actualizada">
        <div className="auth-state">
          <AuthStatusIcon icon={ShieldCheck} tone="success" />
          <p>Ya puedes iniciar sesión con tu nueva contraseña.</p>
        </div>
        <div className="auth-actions">
          <Link className="auth-submit" to="/login"><span>Iniciar sesión</span><ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
        </div>
      </AuthShell>
    );
  }

  if (status === 'invalid') {
    return (
      <AuthShell badge="Enlace no válido" title="Este enlace ya no sirve">
        <div className="auth-state">
          <AuthStatusIcon icon={LinkIcon} tone="danger" />
          <p>El enlace de recuperación venció o ya se usó. Pide uno nuevo para cambiar tu contraseña.</p>
        </div>
        <div className="auth-actions">
          <Link className="auth-submit" to="/forgot-password"><span>Solicitar otro enlace</span><ArrowRight strokeWidth={2} aria-hidden="true" /></Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell badge="Recuperar acceso" title="Crea una nueva contraseña" intro="Usa una contraseña que no hayas usado antes en SmartStorage.">
      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={busy} className="auth-fields">
          <PasswordField isNew label="Nueva contraseña" value={password} onChange={(event) => { setPassword(event.target.value); setServerError(null); }} errors={showPassword} />
          <PasswordField name="passwordConfirmation" autoComplete="new-password" label="Repite la contraseña" placeholder="Escríbela otra vez" value={confirm} onChange={(event) => setConfirm(event.target.value)}
            errors={(submitted || confirm) && confirmErrors.length && !passwordErrors.length ? confirmErrors : null} />
          <SubmitButton busy={busy} busyLabel="Guardando…" icon={KeyRound}>Guardar contraseña</SubmitButton>
        </fieldset>
      </form>
    </AuthShell>
  );
}
