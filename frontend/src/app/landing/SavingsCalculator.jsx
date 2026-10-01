import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { formatBytes, useAnimatedNumber } from './motion.js';

// Rangos orientativos de reducción al convertir a WebP (calidad 80). No son una garantía:
// la biblioteca muestra el tamaño original y el WebP real de cada imagen.
const formats = {
  jpg: { label: 'Fotos JPG', min: 0.25, max: 0.35 },
  png: { label: 'Fotos PNG', min: 0.6, max: 0.8 },
};
const FREE_CAPACITY = 2_000_000_000;

export function SavingsCalculator() {
  const id = useId();
  const [count, setCount] = useState(120);
  const [sizeMb, setSizeMb] = useState(4);
  const [format, setFormat] = useState('jpg');

  const { min, max } = formats[format];
  const originalBytes = count * sizeMb * 1e6;
  const webpHigh = originalBytes * (1 - min);
  const webpLow = originalBytes * (1 - max);
  const middle = (webpHigh + webpLow) / 2;

  const animatedOriginal = useAnimatedNumber(originalBytes, 500);
  const animatedWebp = useAnimatedNumber(middle, 500);
  const fitsFree = Math.floor(FREE_CAPACITY / (sizeMb * 1e6));

  return (
    <div className="calc">
      <div className="calc-inputs">
        <div className="calc-format" role="radiogroup" aria-label="Tipo de imágenes">
          {Object.entries(formats).map(([key, { label }]) => (
            <button key={key} type="button" role="radio" aria-checked={format === key} className={format === key ? 'is-active' : undefined} onClick={() => setFormat(key)}>{label}</button>
          ))}
          <span className="calc-format-thumb" style={{ transform: `translateX(${format === 'jpg' ? 0 : 100}%)` }} aria-hidden="true" />
        </div>

        <label className="calc-range" htmlFor={`${id}-count`}>
          <span>Imágenes</span><output>{count}</output>
          <input id={`${id}-count`} type="range" min="10" max="1000" step="10" value={count} onChange={(event) => setCount(Number(event.target.value))} style={{ '--fill': `${((count - 10) / 990) * 100}%` }} />
        </label>
        <label className="calc-range" htmlFor={`${id}-size`}>
          <span>Peso promedio</span><output>{sizeMb} MB</output>
          <input id={`${id}-size`} type="range" min="0.5" max="25" step="0.5" value={sizeMb} onChange={(event) => setSizeMb(Number(event.target.value))} style={{ '--fill': `${((sizeMb - 0.5) / 24.5) * 100}%` }} />
        </label>
        <p className="calc-note"><Info strokeWidth={2} /><span>Tu plan cuenta el tamaño original de cada subida. Con este peso, el plan Free de 2 GB admite unas <strong>{fitsFree.toLocaleString('es-GT')}</strong> imágenes.</span></p>
      </div>

      <div className="calc-result" aria-live="polite">
        <span className="calc-result-label">Tus archivos pasarían de</span>
        <div className="calc-bars">
          <div className="calc-bar">
            <span>Originales</span>
            <div><i style={{ width: '100%' }} /></div>
            <strong>{formatBytes(animatedOriginal)}</strong>
          </div>
          <div className="calc-bar is-webp">
            <span>En WebP</span>
            <div><i style={{ width: `${(middle / originalBytes) * 100}%` }} /></div>
            <strong>≈ {formatBytes(animatedWebp)}</strong>
          </div>
        </div>
        <p className="calc-big"><span>{Math.round(min * 100)}–{Math.round(max * 100)} %</span> más ligeros</p>
        <p className="calc-range-text">Entre {formatBytes(webpLow)} y {formatBytes(webpHigh)} en total. Estimación orientativa: el resultado real depende de cada imagen y lo ves en tu biblioteca.</p>
      </div>
    </div>
  );
}
