import {
  ArrowRight, CloudUpload, CreditCard, Image, LayoutGrid, Layers, LockKeyhole, Sparkles,
} from 'lucide-react';

// Íconos de la app (lucide-react). Para añadir uno: importarlo y darle un nombre aquí.
const icons = {
  arrow: ArrowRight,
  image: Image,
  upload: CloudUpload,
  layers: Layers,
  lock: LockKeyhole,
  grid: LayoutGrid,
  plan: CreditCard,
  spark: Sparkles,
};

export function Icon({ name, className = '' }) {
  const Glyph = icons[name];
  if (!Glyph) return null;
  return <Glyph className={`icon ${className}`} strokeWidth={1.75} aria-hidden="true" />;
}
