import { CalendarClock, FileImage, MapPinOff, Maximize2 } from 'lucide-react';
import { UploadDropzone, UploadQueue } from './UploadDropzone.jsx';

const rules = [
  { icon: FileImage, title: 'Formatos', text: 'JPG, PNG o WebP estáticos, hasta 25 MB y 40 megapíxeles.' },
  { icon: CalendarClock, title: 'Límite diario (Free)', text: '10 subidas o 200 MB por día. Se reinicia a medianoche.' },
  { icon: Maximize2, title: 'Misma resolución', text: 'Convertimos a WebP con calidad 80, sin redimensionar.' },
  { icon: MapPinOff, title: 'Privacidad', text: 'Quitamos los datos EXIF y la ubicación GPS.' },
];

export function UploadPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Biblioteca</span>
          <h1>Subir imágenes</h1>
          <p>Cada imagen se convierte a WebP antes de guardarse. Si ya existía, se reutiliza la misma copia.</p>
        </div>
      </header>
      <UploadDropzone />
      <UploadQueue />
      <ul className="rules-grid">
        {rules.map(({ icon: RuleIcon, title, text }, index) => (
          <li key={title} style={{ '--i': index }}>
            <RuleIcon strokeWidth={1.9} aria-hidden="true" />
            <strong>{title}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
