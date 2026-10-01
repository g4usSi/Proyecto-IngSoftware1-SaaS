import { useEffect, useState } from 'react';
import { Check, CloudUpload, CopyCheck, Fingerprint, ImageUp, MapPinOff, Sparkles, UserRound } from 'lucide-react';
import { formatBytes, useAnimatedNumber, useReducedMotion } from './motion.js';

// Ejemplo ilustrativo. Los valores no son una promesa: el ahorro real depende de cada imagen.
const ORIGINAL_BYTES = 5_200_000;
const WEBP_BYTES = 1_100_000;
// Se reproduce una sola vez y se queda en la última etapa.
const stages = [
  { id: 'upload', label: 'Subir', icon: CloudUpload, duration: 1300 },
  { id: 'hash', label: 'Huella', icon: Fingerprint, duration: 1000 },
  { id: 'convert', label: 'WebP', icon: Sparkles, duration: 1200 },
  { id: 'done', label: 'Listo', icon: Check, duration: 1100 },
  { id: 'dedupe', label: 'Sin copias', icon: CopyCheck },
];
const indexOf = (id) => stages.findIndex((stage) => stage.id === id);

export function CompressionDemo() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const last = stages.length - 1;

  // Está en el hero: arranca al cargar la página (con una pausa para que entre el título).
  useEffect(() => {
    if (reduced) { setStep(last); return undefined; }
    if (step === last) return undefined;
    const delay = stages[step].duration + (step === 0 ? 500 : 0);
    const timer = setTimeout(() => setStep(step + 1), delay);
    return () => clearTimeout(timer);
  }, [step, reduced, last]);

  const stage = stages[step].id;
  const converted = step >= indexOf('convert');
  const bytes = useAnimatedNumber(converted ? WEBP_BYTES : ORIGINAL_BYTES, 900);
  const saved = Math.round((1 - WEBP_BYTES / ORIGINAL_BYTES) * 100);

  function tilt(event) {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty('--ry', `${x * 7}deg`);
    event.currentTarget.style.setProperty('--rx', `${-y * 7}deg`);
  }
  function resetTilt(event) {
    event.currentTarget.style.setProperty('--ry', '0deg');
    event.currentTarget.style.setProperty('--rx', '0deg');
  }

  return (
    <figure
      className="demo"
      data-stage={stage}
      onPointerMove={tilt}
      onPointerLeave={resetTilt}
      aria-label="Animación de ejemplo: una imagen se sube, se identifica con su huella SHA-256, se convierte a WebP y una segunda subida idéntica reutiliza la misma copia."
    >
      <div className="demo-window">
        <div className="demo-bar">
          <span className="demo-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="demo-title">Mi biblioteca</span>
          <span className="demo-live"><i aria-hidden="true" /><span data-for="busy">Procesando</span><span data-for="ready">Listo</span></span>
        </div>

        <ol className="demo-steps" aria-hidden="true">
          {stages.map(({ id, label, icon: StepIcon }, index) => (
            <li key={id} className={index < step ? 'is-done' : index === step ? 'is-active' : ''}>
              <span><StepIcon strokeWidth={2} /></span>{label}
            </li>
          ))}
        </ol>

        <div className="demo-image">
          <div className="demo-landscape" aria-hidden="true">
            <span className="demo-sun" />
            <span className="demo-cloud demo-cloud-a" />
            <span className="demo-cloud demo-cloud-b" />
            <span className="demo-mountain demo-mountain-back" />
            <span className="demo-mountain demo-mountain-front" />
          </div>
          <span className="demo-pixels" aria-hidden="true" />
          <span className="demo-scan" aria-hidden="true" />
          <span className="demo-drop" aria-hidden="true"><ImageUp strokeWidth={1.75} />Suelta tu imagen</span>
          <span className="demo-format" aria-hidden="true"><b className="from">PNG</b><b className="to">WEBP</b></span>
          <span className="demo-privacy" aria-hidden="true"><MapPinOff strokeWidth={2} />Sin EXIF ni GPS</span>
        </div>

        <div className="demo-file">
          <div className="demo-file-row">
            <span className="demo-file-icon"><ImageUp strokeWidth={1.75} /></span>
            <div className="demo-file-name">
              <strong>atardecer<span className="ext-from">.png</span><span className="ext-to">.webp</span></strong>
              <span className="demo-file-status">
                <span data-for="upload">Subiendo…</span>
                <span data-for="hash">Calculando huella…</span>
                <span data-for="convert">Convirtiendo a WebP…</span>
                <span data-for="done">Guardada en tu biblioteca</span>
                <span data-for="dedupe">Guardada en tu biblioteca</span>
              </span>
            </div>
            <div className="demo-size">
              <strong>{formatBytes(bytes)}</strong>
              <span className="demo-saved">−{saved} %</span>
            </div>
          </div>
          <div className="demo-meter"><span className="demo-meter-upload" /><span className="demo-meter-size" /></div>
          <div className="demo-hash"><Fingerprint strokeWidth={2} /><code>sha256 · 9f2c7a41d0e8…b3e41c</code></div>
        </div>

        <div className="demo-dup">
          <span className="demo-dup-user"><UserRound strokeWidth={2} />Otra cuenta sube el mismo archivo</span>
          <span className="demo-dup-result"><CopyCheck strokeWidth={2} />Misma huella: se reutiliza la copia · <b>+0 B</b> en disco</span>
        </div>
      </div>
      <figcaption className="demo-caption">Ejemplo ilustrativo · el ahorro real depende de cada imagen</figcaption>
    </figure>
  );
}
