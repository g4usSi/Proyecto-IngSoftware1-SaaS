import { useId, useState } from 'react';
import { Plus } from 'lucide-react';

const questions = [
  { q: '¿Qué formatos puedo subir?', a: 'Imágenes JPG, PNG y WebP estáticas de hasta 25 MB cada una. Las imágenes animadas no se aceptan por ahora.' },
  { q: '¿Mis imágenes pierden calidad?', a: 'Se convierten a WebP con calidad 80 y conservan exactamente las mismas dimensiones en píxeles. En la mayoría de fotos la diferencia no se nota a simple vista, y el archivo pesa bastante menos.' },
  { q: '¿Se guarda mi archivo original?', a: 'No. Solo conservamos la versión WebP definitiva; el original se elimina al terminar el procesamiento. Guardamos su tamaño como dato para que veas cuánto se redujo.' },
  { q: '¿Alguien más puede ver mis imágenes?', a: 'No. Cada imagen está ligada a tu cuenta y solo se descarga con tu sesión. Aunque otra persona suba el mismo archivo, cada quien ve únicamente sus propias imágenes.' },
  { q: '¿Qué pasa si subo la misma imagen dos veces?', a: 'La reconocemos por su huella SHA-256 y reutilizamos la copia que ya existe, en lugar de guardar otra igual. En tu biblioteca aparece como una imagen más.' },
  { q: '¿Cuánto cuesta?', a: 'El plan Free es gratis: 2 GB, hasta 10 subidas y 200 MB por día. Estándar (Q35 al mes), Pro (Q100) y Enterprise (desde Q300) ofrecen más capacidad; su contratación estará disponible pronto.' },
  { q: '¿Se borran los datos de ubicación de mis fotos?', a: 'Sí. Al convertir la imagen quitamos los metadatos EXIF, incluida la ubicación GPS. Antes aplicamos la orientación para que la foto se vea derecha.' },
];

export function Faq() {
  const baseId = useId();
  const [open, setOpen] = useState(0);

  return (
    <div className="faq">
      {questions.map(({ q, a }, index) => {
        const isOpen = open === index;
        return (
          <div className={`faq-item${isOpen ? ' is-open' : ''}`} key={q} data-reveal data-reveal-delay={index * 60}>
            <h3>
              <button type="button" aria-expanded={isOpen} aria-controls={`${baseId}-${index}`} id={`${baseId}-q${index}`} onClick={() => setOpen(isOpen ? -1 : index)}>
                <span>{q}</span><Plus strokeWidth={2} aria-hidden="true" />
              </button>
            </h3>
            <div className="faq-answer" id={`${baseId}-${index}`} role="region" aria-labelledby={`${baseId}-q${index}`}>
              <div><p>{a}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
