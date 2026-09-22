import { Icon } from '../../components/Icon.jsx';
import { PendingState } from '../../components/PendingState.jsx';

export function StoragePage() {
  return (
    <>
      <div className="page-heading storage-heading"><div><span className="eyebrow">BIBLIOTECA</span><h1>Mis imágenes</h1><p>Un lugar para guardar lo que creas.</p></div><button type="button" className="button button-dark" disabled aria-describedby="upload-pending"><Icon name="upload" /> Subir imagen</button></div>
      <section className="library-panel" aria-label="Galería de imágenes pendiente de integración">
        <div className="panel-heading"><span><Icon name="image" /> Galería</span><span className="small-badge">Próximamente</span></div>
        <PendingState icon="image" title="Tu biblioteca empieza aquí.">La subida de imágenes y la galería estarán disponibles al integrar tu cuenta y el almacenamiento.</PendingState>
        <div className="library-note" id="upload-pending"><Icon name="lock" /><span>Esta vista no tiene una sesión activa ni archivos cargados.</span></div>
      </section>
      <div className="feature-explainer"><span className="explainer-icon"><Icon name="layers" /></span><div><h2>Menos copias, el mismo espacio personal.</h2><p>Guardaremos una única versión WebP por contenido idéntico. Cada usuario conservará sus propios permisos de acceso.</p></div></div>
    </>
  );
}
