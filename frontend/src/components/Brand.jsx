import { Link } from 'react-router-dom';
import logoPrincipal from '../assets/brand/smartstorage-principal.svg';
import logoFondoOscuro from '../assets/brand/smartstorage-fondo-oscuro.svg';

/** Logo oficial. `light` = versión para fondos oscuros (letras blancas). */
export function Brand({ light = false }) {
  return (
    <Link className="brand" to="/" aria-label="SmartStorage, inicio">
      <img src={light ? logoFondoOscuro : logoPrincipal} alt="" width="904" height="176" />
    </Link>
  );
}
