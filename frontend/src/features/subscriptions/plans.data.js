// Catálogo comercial de planes (landing y panel). La API hoy solo publica Free;
// los planes de pago se muestran como "Próximamente" hasta que existan pagos.
export const FREE_CAPACITY_BYTES = 2_000_000_000;

export const plans = [
  {
    code: 'free', name: 'Free', price: 'Q0', available: true,
    description: 'Para empezar a guardar tus imágenes.',
    features: ['2 GB de almacenamiento lógico', '10 subidas o 200 MB al día', 'Sin acceso al SDK/API'],
  },
  {
    code: 'standard', name: 'Estándar', price: 'Q35', cta: 'Elegir plan',
    description: 'Para quienes suben imágenes con frecuencia.',
    features: ['25 GB de almacenamiento lógico', '500 MB al día', 'Acceso básico al SDK/API'],
  },
  {
    code: 'pro', name: 'Pro', price: 'Q100', cta: 'Elegir plan', featured: true,
    description: 'Para proyectos y equipos con mucho volumen.',
    features: ['100 GB de almacenamiento lógico', 'Sin límite diario', 'SDK completo y prioridad de proceso'],
  },
  {
    code: 'enterprise', name: 'Enterprise', price: 'Q300+', cta: 'Contactar',
    description: 'Para organizaciones con necesidades a medida.',
    features: ['500 GB o a medida', 'Soporte prioritario', 'Acuerdo y factura a la medida'],
  },
];
