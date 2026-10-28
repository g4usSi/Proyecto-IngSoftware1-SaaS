import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CreditCard, XCircle } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { ApiError } from '../../services/api.js';
import { useSession } from '../auth/session.jsx';
import { formatBytes, formatDate } from '../storage/format.js';
import { changePlan, checkout, planPrice, renew } from './subscriptions.api.js';

const TEST_CARDS = [
  { number: '4242424242424242', label: 'Aprobada' },
  { number: '4000000000000002', label: 'Rechazada' },
  { number: '4000000000000119', label: 'Error de pago' },
];
const titles = { checkout: 'Contratar', upgrade: 'Mejorar a', downgrade: 'Cambiar a', renew: 'Renovar' };
// Sin respuesta o 5xx: no sabemos si se cobró; reintentar con la MISMA clave nunca crea otro pago.
const uncertain = (error) => !(error instanceof ApiError) || error.status >= 500 || error.code === 'INVALID_RESPONSE';
const groupCard = (digits) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * Contratar, renovar, subir o bajar de plan. La tarjeta vive solo en este diálogo (nunca se guarda) y no se pide CVV.
 * mode: 'checkout' | 'upgrade' | 'downgrade' | 'renew'.
 */
export function PaymentDialog({ mode, plan, subscription, onClose, onDone }) {
  const { session } = useSession();
  const needsCard = mode !== 'downgrade';
  const [step, setStep] = useState(needsCard ? 'card' : 'review');
  const [card, setCard] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [retryable, setRetryable] = useState(false);
  const [capacity, setCapacity] = useState(null);
  const [result, setResult] = useState(null);
  const attemptKey = useRef(null);
  const cardValid = /^\d{16}$/.test(card);

  async function submit() {
    setBusy(true); setError(null); setRetryable(false);
    if (needsCard) attemptKey.current ??= crypto.randomUUID();
    const options = { token: session.token, idempotencyKey: attemptKey.current };
    try {
      const data = mode === 'checkout' ? await checkout({ planCode: plan.code, cardNumber: card }, options)
        : mode === 'renew' ? await renew({ cardNumber: card }, options)
          : await changePlan({ planCode: plan.code, cardNumber: needsCard ? card : undefined }, options);
      attemptKey.current = null;
      const status = mode === 'downgrade' ? 'approved' : data.payment?.status;
      setResult({ status, data });
      setStep('result');
      if (status === 'approved') onDone();
    } catch (reason) {
      if (uncertain(reason)) {
        setRetryable(true);
        setError('No pudimos confirmar el resultado. Reintentar usa el mismo intento, así que no se cobra dos veces.');
      } else {
        attemptKey.current = null;
        if (reason.code === 'PLAN_CAPACITY_EXCEEDED') setCapacity(reason.details);
        else if (['INVALID_CARD', 'INVALID_TEST_CARD'].includes(reason.code)) { setStep('card'); setError(reason.message); }
        else setError(reason.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function tryAnotherCard() {
    attemptKey.current = null; // un intento nuevo lleva una clave nueva
    setCard(''); setTouched(false); setResult(null); setError(null); setStep('card');
  }

  const title = `${titles[mode]} ${mode === 'renew' ? plan.name : plan.name}`;

  if (step === 'card') {
    return (
      <ActionDialog title={title} confirmLabel="Continuar" onClose={onClose} error={error}
        disabled={!cardValid} onConfirm={() => { setTouched(true); if (cardValid) { setError(null); setStep('review'); } }}>
        <p>Pago simulado: usa una tarjeta de prueba. No pedimos CVV ni guardamos el número.</p>
        <label className="pay-field">Número de tarjeta
          <span className="pay-input"><CreditCard aria-hidden="true" />
            <input inputMode="numeric" autoComplete="off" autoFocus placeholder="4242 4242 4242 4242" maxLength={19}
              value={groupCard(card)} aria-invalid={touched && !cardValid} aria-describedby="pay-card-help"
              onChange={(event) => setCard(event.target.value.replace(/\D/g, '').slice(0, 16))} onBlur={() => setTouched(true)} />
          </span>
        </label>
        <p id="pay-card-help" className={`pay-help${touched && !cardValid ? ' is-error' : ''}`}>
          {touched && !cardValid ? 'Escribe los 16 dígitos de una tarjeta de prueba.' : 'Tarjetas de prueba:'}
        </p>
        <div className="pay-test-cards">
          {TEST_CARDS.map((item) => (
            <button key={item.number} type="button" className="btn btn-secondary btn-small" onClick={() => { setCard(item.number); setTouched(true); }}>
              •••• {item.number.slice(-4)} · {item.label}
            </button>
          ))}
        </div>
      </ActionDialog>
    );
  }

  if (step === 'review') {
    const blocked = Boolean(capacity);
    return (
      <ActionDialog title={title} onClose={onClose} busy={busy} error={error}
        confirmLabel={retryable ? 'Reintentar' : mode === 'downgrade' ? 'Confirmar cambio' : `Pagar ${planPrice(plan)}`}
        busyLabel={mode === 'downgrade' ? 'Cambiando…' : 'Procesando pago…'} disabled={blocked} onConfirm={submit}>
        <dl className="pay-summary">
          <div><dt>Plan</dt><dd>{plan.name}</dd></div>
          <div><dt>Almacenamiento</dt><dd>{formatBytes(plan.capacityBytes)}</dd></div>
          <div><dt>Vigencia</dt><dd>{mode === 'downgrade' ? 'Se aplica de inmediato'
            : mode === 'renew' && subscription?.expiresAt ? `Un mes más desde el ${formatDate(subscription.expiresAt)}` : 'Un mes calendario desde hoy'}</dd></div>
          {needsCard && <div><dt>Tarjeta</dt><dd>•••• {card.slice(-4)}</dd></div>}
          <div className="pay-total"><dt>Total</dt><dd>{mode === 'downgrade' ? 'Sin cobro' : `${planPrice(plan)} USD`}</dd></div>
        </dl>
        {mode === 'downgrade' && !blocked && <p className="pay-note">Tu espacio usado debe caber en {formatBytes(plan.capacityBytes)}. La papelera cuenta como espacio usado.</p>}
        {blocked && (
          <div className="pay-alert" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Libera al menos {formatBytes(capacity.bytesToFree)} antes de cambiar.</strong>
              <p>Usas {formatBytes(BigInt(capacity.usedBytes) + BigInt(capacity.reservedBytes ?? 0))} y {plan.name} admite {formatBytes(capacity.capacityBytes)}. Elimina imágenes definitivamente desde la <Link to="/app/trash" onClick={onClose}>Papelera</Link> o mueve contenido fuera de <Link to="/app/storage" onClick={onClose}>Mis imágenes</Link>.</p>
            </div>
          </div>
        )}
        {needsCard && !retryable && <button type="button" className="link-button" onClick={() => setStep('card')} disabled={busy}>Cambiar tarjeta</button>}
      </ActionDialog>
    );
  }

  const { status, data } = result;
  const expires = data.subscription?.expiresAt;
  return (
    <ActionDialog title={status === 'approved' ? (mode === 'downgrade' ? 'Plan cambiado' : 'Pago aprobado') : status === 'rejected' ? 'Pago rechazado' : 'No se pudo procesar el pago'}
      hideCancel={status === 'approved'} cancelLabel="Cerrar"
      confirmLabel={status === 'approved' ? 'Listo' : 'Probar con otra tarjeta'}
      onClose={onClose} onConfirm={status === 'approved' ? onClose : tryAnotherCard}>
      <div className={`pay-result is-${status}`} role="status">
        {status === 'approved' ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
        <p>{status === 'approved'
          ? `Tu plan ahora es ${plan.name}${expires ? `, vigente hasta el ${formatDate(expires)}` : ''}.`
          : status === 'rejected' ? 'El banco de prueba rechazó la tarjeta. No se hizo ningún cargo y tu plan no cambió.'
            : 'Ocurrió un error al procesar el pago. No se hizo ningún cargo y tu plan no cambió.'}</p>
        {data.payment && <small>Referencia {data.payment.reference}{data.repeated ? ' · pago ya registrado' : ''}</small>}
      </div>
    </ActionDialog>
  );
}
