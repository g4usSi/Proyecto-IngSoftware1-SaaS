import { CalendarClock, FileImage, MapPinOff, Maximize2 } from 'lucide-react';
import { UploadDropzone, UploadQueue } from './UploadDropzone.jsx';
import { QuotaSummary } from './QuotaSummary.jsx';

const rules = [
  { icon: FileImage, title: 'Formatos', text: 'JPG, PNG o WebP estáticos, hasta 25 MB y 40 megapíxeles.' },
  { icon: CalendarClock, title: 'Límite diario', text: 'Depende de tu plan e incluye las subidas pendientes. El día cambia a medianoche en Guatemala.' },
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
          <p>Tus imágenes se convierten a WebP en segundo plano. Aparecen en la biblioteca cuando termina la publicación.</p>
        </div>
      </header>
      <QuotaSummary />
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
