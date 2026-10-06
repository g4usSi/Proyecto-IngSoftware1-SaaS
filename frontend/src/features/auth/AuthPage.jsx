import { useId, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { Brand } from '../../components/Brand.jsx';
import { HeroShader } from '../../app/landing/HeroShader.jsx';
import { authErrorMessage } from './auth.api.js';
import { fieldForServerError, passwordRules, validateLogin, validateRegistration } from './auth.validation.js';
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
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/app" replace />;

  const localErrors = register ? validateRegistration(values) : validateLogin(values);
  const errorFor = (field) => ((submitted || touched[field]) && localErrors[field]) || (serverErrors[field] ? [serverErrors[field]] : null);

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      setServerErrors((current) => ({ ...current, [field]: undefined }));
      setFormError(null);
    };
  }
  const blur = (field) => () => { if (values[field]) setTouched((current) => ({ ...current, [field]: true })); };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(localErrors).length) {
      const first = ['name', 'email', 'password'].find((field) => localErrors[field]);
      event.currentTarget.querySelector(`[name="${first}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      if (register) {
        const signedIn = await registerAccount(values);
        if (!signedIn) {
          navigate('/login', { replace: true, state: { notice: 'Tu cuenta se creó. Inicia sesión para continuar.' } });
          return;
        }
      } else {
        await login({ email: values.email, password: values.password });
      }
      navigate('/app', { replace: true });
    } catch (error) {
      const field = fieldForServerError(error);
      if (field) setServerErrors({ [field]: authErrorMessage(error) });
      else setFormError(authErrorMessage(error));
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="auth-screen">
      <HeroShader />
      <header className="auth-top">
        <Brand light />
        <Link className="auth-back" to="/"><ArrowLeft strokeWidth={2} aria-hidden="true" />Volver al inicio</Link>
      </header>

      <section className="auth-panel" aria-labelledby="auth-title">
        <span className="auth-badge">{register ? 'Plan Free · 2 GB gratis' : 'Tu biblioteca te espera'}</span>
        <h1 id="auth-title">{register ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}</h1>
        <p className="auth-intro">{register ? 'Empieza a guardar tus imágenes en WebP, sin copias repetidas.' : 'Inicia sesión para ver y subir tus imágenes.'}</p>

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
            <PasswordField register={register} value={values.password} onChange={update('password')} onBlur={blur('password')} errors={errorFor('password')} />

            <Collapse open={Boolean(formError)}>
              <p className="auth-form-error" role="alert"><AlertCircle strokeWidth={2} aria-hidden="true" />{formError}</p>
            </Collapse>

            <button className="auth-submit" type="submit">
              <span>{busy ? (register ? 'Creando tu cuenta…' : 'Entrando…') : (register ? 'Crear cuenta' : 'Iniciar sesión')}</span>
              {busy ? <span className="auth-spinner" aria-hidden="true" /> : <ArrowRight strokeWidth={2} aria-hidden="true" />}
            </button>
          </fieldset>
        </form>

        <p className="auth-switch">
          {register ? '¿Ya tienes cuenta?' : '¿Todavía no tienes cuenta?'}{' '}
          <Link to={register ? '/login' : '/register'}>{register ? 'Inicia sesión' : 'Crea una gratis'}</Link>
        </p>
      </section>
    </main>
  );
}

/** Contenedor que se abre y cierra con animación de altura. */
function Collapse({ open, children }) {
  return <div className={`auth-collapse${open ? ' is-open' : ''}`} aria-hidden={!open}><div>{children}</div></div>;
}

function Field({ label, name, type = 'text', icon: FieldIcon, errors, ...input }) {
  const id = useId();
  const invalid = Boolean(errors?.length);
  return (
    <div className={`auth-field${invalid ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="auth-input">
        <FieldIcon strokeWidth={1.8} aria-hidden="true" />
        <input id={id} name={name} type={type} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} {...input} />
      </div>
      <Collapse open={invalid}>
        <p className="auth-field-error" id={`${id}-error`}><AlertCircle strokeWidth={2} aria-hidden="true" />{errors?.[0]}</p>
      </Collapse>
    </div>
  );
}

function PasswordField({ register, value, onChange, onBlur, errors }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  // En registro, los errores de contraseña son los ids de los requisitos que faltan.
  const missing = register && errors?.every((item) => passwordRules.some((rule) => rule.id === item)) ? errors : null;
  const message = !missing && errors?.length ? errors[0] : null;
  const invalid = Boolean(missing?.length || message);

  return (
    <div className={`auth-field${invalid ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>Contraseña</label>
      <div className="auth-input">
        <LockKeyhole strokeWidth={1.8} aria-hidden="true" />
        <input
          id={id} name="password" type={visible ? 'text' : 'password'} value={value} onChange={onChange} onBlur={onBlur}
          autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Crea una contraseña segura' : 'Tu contraseña'}
          maxLength={128} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        />
        <button type="button" className="auth-eye" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible}>
          {visible ? <EyeOff strokeWidth={1.8} /> : <Eye strokeWidth={1.8} />}
        </button>
      </div>

      {register && (
        <Collapse open={!invalid && !value}>
          <p className="auth-hint">Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.</p>
        </Collapse>
      )}

      <Collapse open={Boolean(missing?.length)}>
        <div className="auth-requirements" id={missing ? `${id}-error` : undefined} role="status">
          <p><AlertCircle strokeWidth={2} aria-hidden="true" />A tu contraseña le falta:</p>
          <ul>
            {passwordRules.map((rule) => (
              <li key={rule.id} className={missing?.includes(rule.id) ? 'is-missing' : undefined}>
                <div><span>{rule.label}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </Collapse>

      <Collapse open={Boolean(message)}>
        <p className="auth-field-error" id={message ? `${id}-error` : undefined}><AlertCircle strokeWidth={2} aria-hidden="true" />{message}</p>
      </Collapse>
    </div>
  );
}
