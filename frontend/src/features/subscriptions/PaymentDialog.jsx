import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CreditCard, Download, LoaderCircle, XCircle } from 'lucide-react';
import { ActionDialog } from '../../components/ActionDialog.jsx';
import { ApiError } from '../../services/api.js';
import { useSession } from '../auth/session.jsx';
import { useLibrary } from '../storage/library.jsx';
import { formatBytes, formatBytesCeil, formatDate, formatMoney } from '../storage/format.js';
import { capacityShortfall, changePlan, checkout, downloadReceipt, isFreePlan, planPrice, renew } from './subscriptions.api.js';

const TEST_CARDS = [
  { number: '4242424242424242', label: 'Aprobada', tone: 'success' },
  { number: '4000000000000002', label: 'Rechazada', tone: 'danger' },
  { number: '4000000000000119', label: 'Error de pago', tone: 'warn' },
];
const titles = { checkout: 'Contratar', upgrade: 'Mejorar a', downgrade: 'Cambiar a', renew: 'Renovar' };
// Una respuesta instantánea haría parpadear la ventana: se muestra lo justo para leer que el pago se está procesando.
const MIN_PROCESSING_MS = 700;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// Sin respuesta o 5xx: no sabemos si se cobró; reintentar con la MISMA clave nunca crea otro pago.
const uncertain = (error) => !(error instanceof ApiError) || error.status >= 500 || error.code === 'INVALID_RESPONSE';
const groupCard = (digits) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

function PaySteps({ current }) {
  return (
    <ol className="pay-steps" aria-label={`Paso ${current} de 2`}>
      {['Tarjeta', 'Confirmar'].map((label, index) => (
        <li key={label} className={index + 1 === current ? 'is-current' : index + 1 < current ? 'is-done' : undefined}><i aria-hidden="true">{index + 1}</i>{label}</li>
      ))}
    </ol>
  );
}

function vigencia(mode, plan, subscription) {
  if (mode === 'downgrade') {
    if (isFreePlan(plan)) return 'Se aplica de inmediato, sin vencimiento';
    return subscription?.expiresAt ? `Se aplica de inmediato, hasta el ${formatDate(subscription.expiresAt)}` : 'Se aplica de inmediato';
  }
  return mode === 'renew' && subscription?.expiresAt ? `Un mes más desde el ${formatDate(subscription.expiresAt)}` : 'Un mes calendario desde hoy';
}

/**
 * Contratar, renovar, subir o bajar de plan. La tarjeta vive solo en este diálogo (nunca se guarda) y no se pide CVV.
 * mode: 'checkout' | 'upgrade' | 'downgrade' | 'renew'. onDone: cambió el plan. onRecorded: hay un pago nuevo en el historial, aprobado o no.
 */
export function PaymentDialog({ mode, plan, subscription, onClose, onDone, onRecorded }) {
  const { session } = useSession();
  const { quota } = useLibrary();
  const needsCard = mode !== 'downgrade';
  const [step, setStep] = useState(needsCard ? 'card' : 'review');
  const [card, setCard] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [retryable, setRetryable] = useState(false);
  // El servidor decide con 409 PLAN_CAPACITY_EXCEEDED; con la cuota ya conocida se avisa antes de intentarlo.
  const [capacity, setCapacity] = useState(() => (mode === 'downgrade' ? capacityShortfall(quota.data, plan) : null));
  const [result, setResult] = useState(null);
  const [receipt, setReceipt] = useState({ busy: false, done: false, error: null });
  const attemptKey = useRef(null);
  const cardValid = /^\d{16}$/.test(card);

  async function submit() {
    setStep('processing'); setError(null); setRetryable(false);
    if (needsCard) attemptKey.current ??= crypto.randomUUID();
    const options = { token: session.token, idempotencyKey: attemptKey.current };
    const minimum = pause(MIN_PROCESSING_MS);
    try {
      const data = mode === 'checkout' ? await checkout({ planCode: plan.code, cardNumber: card }, options)
        : mode === 'renew' ? await renew({ cardNumber: card }, options)
          : await changePlan({ planCode: plan.code, cardNumber: needsCard ? card : undefined }, options);
      await minimum;
      attemptKey.current = null;
      const status = mode === 'downgrade' ? 'approved' : data.payment?.status;
      setResult({ status, data });
      setStep('result');
      if (data.payment) onRecorded?.();
      if (status === 'approved') onDone();
    } catch (reason) {
      await minimum;
      setStep('review');
      if (uncertain(reason)) {
        setRetryable(true);
        setError('No pudimos confirmar el resultado. Reintentar usa el mismo intento, así que no se cobra dos veces.');
      } else {
        attemptKey.current = null;
        if (reason.code === 'PLAN_CAPACITY_EXCEEDED') setCapacity(reason.details);
        else if (['INVALID_CARD', 'INVALID_TEST_CARD'].includes(reason.code)) { setStep('card'); setError(reason.message); }
        else setError(reason.message);
      }
    }
  }

  function tryAnotherCard() {
    attemptKey.current = null; // un intento nuevo lleva una clave nueva
    setCard(''); setTouched(false); setResult(null); setError(null); setStep('card');
  }

  async function saveReceipt() {
    setReceipt({ busy: true, done: false, error: null });
    try {
      await downloadReceipt(result.data.payment, { token: session.token });
      setReceipt({ busy: false, done: true, error: null });
    } catch (reason) {
      setReceipt({ busy: false, done: false, error: reason instanceof ApiError ? reason.message : 'No se pudo descargar el recibo. Vuelve a intentarlo.' });
    }
  }

  const title = `${titles[mode]} ${plan.name}`;

  if (step === 'card') {
    return (
      <ActionDialog title={title} confirmLabel="Continuar" onClose={onClose} error={error} stepKey={step}
        onConfirm={() => { setTouched(true); if (cardValid) { setError(null); setStep('review'); } }}>
        <PaySteps current={1} />
        <div className="pay-order">
          <div><strong>{plan.name}</strong><span>{formatBytes(plan.capacityBytes)} · {mode === 'renew' ? 'un mes más' : 'un mes'}</span></div>
          <strong className="pay-order-price">{planPrice(plan)}</strong>
        </div>
        <label className="pay-field">Número de tarjeta
          <span className="pay-input"><CreditCard aria-hidden="true" />
            <input inputMode="numeric" autoComplete="off" autoFocus placeholder="4242 4242 4242 4242" maxLength={19}
              value={groupCard(card)} aria-invalid={touched && !cardValid} aria-describedby="pay-card-help"
              onChange={(event) => setCard(event.target.value.replace(/\D/g, '').slice(0, 16))} onBlur={() => setTouched(true)} />
          </span>
        </label>
        <p id="pay-card-help" className={`pay-help${touched && !cardValid ? ' is-error' : ''}`}>
          {touched && !cardValid ? 'Escribe los 16 dígitos de una tarjeta de prueba.' : 'Pago simulado: no pedimos CVV ni guardamos el número. Elige una tarjeta de prueba:'}
        </p>
        <div className="pay-test-cards">
          {TEST_CARDS.map((item) => (
            <button key={item.number} type="button" className="pay-test-card" aria-pressed={card === item.number} aria-label={`•••• ${item.number.slice(-4)} · ${item.label}`}
              onClick={() => { setCard(item.number); setTouched(true); setError(null); }}>
              <span>•••• {item.number.slice(-4)}</span><span className={`status-pill is-${item.tone}`}>{item.label}</span>
            </button>
          ))}
        </div>
      </ActionDialog>
    );
  }

  if (step === 'processing') {
    return (
      <ActionDialog title={title} onClose={onClose} busy hideActions stepKey={step}>
        <div className="pay-processing" role="status">
          <span className="pay-spinner" aria-hidden="true"><CreditCard /></span>
          <strong>{needsCard ? 'Procesando tu pago' : 'Cambiando tu plan'}</strong>
          <p>{needsCard ? `Confirmando ${planPrice(plan)} con la tarjeta •••• ${card.slice(-4)}. No cierres esta ventana.` : `Comprobando tu espacio usado y aplicando ${plan.name}.`}</p>
        </div>
      </ActionDialog>
    );
  }

  if (step === 'review') {
    const blocked = Boolean(capacity);
    return (
      <ActionDialog title={title} onClose={onClose} error={error} stepKey={step}
        confirmLabel={retryable ? 'Reintentar' : mode === 'downgrade' ? 'Confirmar cambio' : `Pagar ${planPrice(plan)}`}
        disabled={blocked} onConfirm={submit}>
        {needsCard && <PaySteps current={2} />}
        <dl className="pay-summary">
          <div><dt>Plan</dt><dd>{plan.name}</dd></div>
          <div><dt>Almacenamiento</dt><dd>{formatBytes(plan.capacityBytes)}</dd></div>
          <div><dt>Vigencia</dt><dd>{vigencia(mode, plan, subscription)}</dd></div>
          {needsCard && (
            <div><dt>Tarjeta</dt><dd>•••• {card.slice(-4)}{!retryable && <button type="button" className="link-button pay-change" aria-label="Cambiar tarjeta" onClick={() => setStep('card')}>Cambiar</button>}</dd></div>
          )}
          <div className="pay-total"><dt>Total</dt><dd>{mode === 'downgrade' ? 'Sin cobro' : planPrice(plan)}</dd></div>
        </dl>
        {mode === 'downgrade' && !blocked && <p className="pay-note">Tu espacio usado debe caber en {formatBytes(plan.capacityBytes)}. La papelera cuenta como espacio usado.</p>}
        {blocked && (
          <div className="pay-alert" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Libera al menos {formatBytesCeil(capacity.bytesToFree)} antes de cambiar.</strong>
              <p>Usas {formatBytes(BigInt(capacity.usedBytes) + BigInt(capacity.reservedBytes ?? 0))} y {plan.name} admite {formatBytes(capacity.capacityBytes)}. Elimina imágenes definitivamente desde la <Link to="/app/trash" onClick={onClose}>Papelera</Link> o mueve contenido fuera de <Link to="/app/storage" onClick={onClose}>Mis imágenes</Link>.</p>
            </div>
          </div>
        )}
      </ActionDialog>
    );
  }

  const { status, data } = result;
  const approved = status === 'approved';
  const expires = data.subscription?.expiresAt;
  return (
    <ActionDialog title={approved ? (mode === 'downgrade' ? 'Plan cambiado' : 'Pago aprobado') : status === 'rejected' ? 'Pago rechazado' : 'No se pudo procesar el pago'}
      hideCancel={approved} cancelLabel="Cerrar" stepKey={step}
      confirmLabel={approved ? 'Listo' : 'Probar con otra tarjeta'}
      onClose={onClose} onConfirm={approved ? onClose : tryAnotherCard}>
      <div className={`pay-result is-${approved ? 'approved' : 'failed'}`} role="status">
        {approved ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
        <p>{approved
          ? `Tu plan ahora es ${plan.name}${expires ? `, vigente hasta el ${formatDate(expires)}` : ''}.`
          : status === 'rejected' ? 'El banco de prueba rechazó la tarjeta. No se hizo ningún cargo y tu plan no cambió.'
            : 'Ocurrió un error al procesar el pago. No se hizo ningún cargo y tu plan no cambió.'}</p>
      </div>
      {data.payment && (
        <dl className="pay-summary pay-receipt">
          <div><dt>Monto</dt><dd>{formatMoney(data.payment.amount, data.payment.currency)}</dd></div>
          <div><dt>Tarjeta</dt><dd>•••• {card.slice(-4)}</dd></div>
          <div><dt>Referencia</dt><dd className="pay-reference">{data.payment.reference}{data.repeated ? ' · pago ya registrado' : ''}</dd></div>
        </dl>
      )}
      {data.payment && (
        <div className="pay-links">
          {approved && (
            <button type="button" className="btn btn-secondary btn-small" onClick={saveReceipt} disabled={receipt.busy}>
              {receipt.busy ? <LoaderCircle className="spin" aria-hidden="true" /> : receipt.done ? <CheckCircle2 aria-hidden="true" /> : <Download aria-hidden="true" />}
              {receipt.busy ? 'Descargando…' : receipt.done ? 'Recibo descargado' : 'Descargar recibo'}
            </button>
          )}
          <Link className="link-button" to="/app/payments" onClick={onClose}>Ver en el historial</Link>
        </div>
      )}
      {receipt.error && <p className="action-error" role="alert">{receipt.error}</p>}
    </ActionDialog>
  );
}
