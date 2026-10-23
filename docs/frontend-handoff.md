# Guía vigente para Alegría

El trabajo pendiente y los contratos nuevos están en [frontend-auth-jobs-handoff.md](frontend-auth-jobs-handoff.md), actualizado el 07/10/2026.

Incluye admisión asíncrona con idempotencia, cuotas del servidor y borrado de imágenes. La guía anterior de Auth y Storage correspondía al corte del 30%; sus tareas ya implementadas se retiraron de la lista vigente. El historial se conserva en Git.

Contratos completos: [API](api.md) y [autenticación](auth-frontend.md).

## Catálogo y cuotas de S4-01

Consultar [la matriz y las condiciones de planes](planes-pagados-s4-01.md) antes de integrar S4-06. `GET /api/plans` ya publica los cuatro planes desde PostgreSQL. La matriz local de la pantalla es una referencia visual; los importes, capacidades y límites deben proceder del servidor.

- Conservar los tamaños como strings/BigInt durante los cálculos y usar GB/MB decimales al presentar unidades.
- Mostrar `monthlyPrice` junto con `currency` (USD); retirar los importes Q35/Q100/Q300 de la integración futura. `monthlyPriceGtq` queda deprecado y es `null` para dólares. No interpretar ese `null` como precio cero.
- Mostrar Estándar US$8, Pro US$15 y Enterprise US$40 con 200 GB incluidos. Enterprise suma US$0.20 por **GB-mes adicional**, ponderado por tiempo. Usar `pricingModel`, `storagePricePerGbMonth`, `includedStorageBytes` y `storageBillingBasis`; la base no es el total final de una factura.
- Presentar la periodicidad desde `billingPeriod`: mes calendario en pagados y sin vencimiento periódico en Free. No mostrar fechas de activación o renovación inventadas.
- Mostrar ambos límites de Free: máximo de subidas **y** bytes diarios. Se rechaza al exceder cualquiera de ellos.
- Interpretar cada límite `null` como ilimitado; no mostrar cero ni inventar un límite personalizado.
- Mostrar carga, catálogo vacío y `503` como estados distintos. Un error no equivale a un plan gratuito ni a consumo cero.
- Distinguir el paquete Enterprise de 200 GB de una ampliación acordada. La tarifa publicada no habilita superar el límite operativo: S4-03 debe entregar la ampliación por suscripción. No calcular una factura desde el consumo actual ni desde los bytes subidos hoy; S4-02/S4-03 deben entregar la medición histórica por tiempo y el total calculado por el servidor.
- No presentar acceso SDK por plan, prioridad o soporte como funciones activas: el catálogo actual no las habilita ni restringe.
- La contratación, el historial, la renovación y el cambio de plan se conectan cuando Elden entregue S4-02/S4-03. Que un plan aparezca en el catálogo no acredita esos recorridos.

Esta guía prepara la integración de Alegría; la interfaz del producto se mantiene a cargo de su módulo.
