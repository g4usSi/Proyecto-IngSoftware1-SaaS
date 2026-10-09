import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { Brand } from '../../components/Brand.jsx';
import { HeroShader } from '../../app/landing/HeroShader.jsx';
import { passwordRules } from './auth.validation.js';

/** Marco común de las pantallas de cuenta: fondo animado, logo y panel centrado. */
export function AuthShell({ badge, title, intro, children }) {
  return (
    <main id="main-content" className="auth-screen">
      <HeroShader />
      <header className="auth-top">
        <Brand light />
        <Link className="auth-back" to="/"><ArrowLeft strokeWidth={2} aria-hidden="true" />Volver al inicio</Link>
      </header>
      <section className="auth-panel" aria-labelledby="auth-title">
        {badge && <span className="auth-badge">{badge}</span>}
        <h1 id="auth-title">{title}</h1>
        {intro && <p className="auth-intro">{intro}</p>}
        {children}
      </section>
    </main>
  );
}

/** Contenedor que se abre y cierra con animación de altura. */
export function Collapse({ open, children }) {
  return <div className={`auth-collapse${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}><div>{children}</div></div>;
}

/** Ícono grande de estado (correo enviado, verificado, error…). */
export function AuthStatusIcon({ icon: StatusIcon, tone = 'neutral' }) {
  return <span className={`auth-status-icon is-${tone}`} aria-hidden="true"><StatusIcon strokeWidth={1.7} /></span>;
}

export function Field({ label, name, type = 'text', icon: FieldIcon, errors, ...input }) {
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

/**
 * Contraseña con botón de mostrar/ocultar. Con `isNew`, los errores pueden ser ids de
 * `passwordRules` y se listan todos los requisitos que faltan a la vez.
 */
export function PasswordField({ isNew = false, name = 'password', autoComplete, label = 'Contraseña', value, onChange, onBlur, errors, placeholder }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const missing = isNew && errors?.length && errors.every((item) => passwordRules.some((rule) => rule.id === item)) ? errors : null;
  const message = !missing && errors?.length ? errors[0] : null;
  const invalid = Boolean(missing?.length || message);

  return (
    <div className={`auth-field${invalid ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="auth-input">
        <LockKeyhole strokeWidth={1.8} aria-hidden="true" />
        <input
          id={id} name={name} type={visible ? 'text' : 'password'} value={value} onChange={onChange} onBlur={onBlur}
          autoComplete={autoComplete ?? (isNew ? 'new-password' : 'current-password')} placeholder={placeholder ?? (isNew ? 'Crea una contraseña segura' : 'Tu contraseña')}
          maxLength={128} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        />
        <button type="button" className="auth-eye" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible}>
          {visible ? <EyeOff strokeWidth={1.8} /> : <Eye strokeWidth={1.8} />}
        </button>
      </div>

      {isNew && (
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

/** Botón principal de los formularios de cuenta. */
export function SubmitButton({ busy, busyLabel, children, icon: TrailingIcon }) {
  return (
    <button className="auth-submit" type="submit" disabled={busy} aria-busy={busy}>
      <span>{busy ? busyLabel : children}</span>
      {busy ? <span className="auth-spinner" aria-hidden="true" /> : TrailingIcon && <TrailingIcon strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}
