# Historial de Elden: planes, cuotas, pagos y suscripciones

Registro de entregas pasadas. Para el comportamiento actual, usar [catálogo y planes](../planes-pagados-s4-01.md), [API](../api.md) y [worker y cuotas](../worker-cuotas.md).

## Free y límites (S2-04 a S2-06, 30 %)

Catálogo, asignación atómica de Free al registrarse, capacidad y límites diarios del flujo síncrono. Comprobado con PostgreSQL: límites exactos, concurrencia y cambio de día.

## Reservas de cuota (S3-08, 50 %)

Base publicada: `5372a98`, incluida en `feature/pagos-planes` @ `8911139`. Cumple sus criterios propios en la versión integrada: conserva el día de admisión, valida `started_at` y límites independientes, identifica reservas con el client recibido, revierte con ROLLBACK y confirma o libera una sola vez.

La revisión técnica del 07/10/2026 dio 102/102 con PostgreSQL 17.11 y Redis 7.4.11 reales. Es evidencia automatizada, no aprobación formal de otro integrante. Las correcciones de acoplamiento las pidió Geovanny y no se publicaron en la rama de Elden. [Evidencia](../evidencias/2026-10-07-s3-08-s3-11/resultado.json).

## Catálogo en USD (S4-01, 14/10/2026)

La migración 008 publicó el catálogo provisional en GTQ, con Enterprise de 500 GB. La revisión de Geovanny acordó USD y Enterprise con 200 GB incluidos; la migración 009 lo aplica sin editar las anteriores y conserva IDs, suscripciones y consumo.

Comprobado en `paid-plans.test.js` y `paid-plans.integration.test.js`: actualización desde el esquema previo y desde la 008, repetición, rollback, tarifa Enterprise, planes inactivos, catálogo vacío y fronteras de cuota. [Evidencia](../evidencias/2026-10-14-s4-01/resultado.json).

## Pagos y suscripciones (S4-02, S4-03)

Pago simulado con tarjetas de prueba, idempotencia, historial, renovación, cambio de plan y recibos PDF, en las migraciones 010 a 013 de `feature/pagos-planes`. Integrado por el PR #5 (`bf0b86a`, 23/10/2026), con la suite de backend en 196/196.

**Corrección posterior:** S4-08 detectó que el rechazo al bajar de plan no decía cuánto liberar; ya responde `details.bytesToFree`. Ver el [historial de Geovanny](geovanny.md#consultas-administrativas-y-cuotas-al-cambiar-de-plan-s4-04-s4-08).

**Cambio posterior en su módulo:** `a91b84f` (Geovanny, 30/10/2026) rediseñó el recibo como factura en `receipt-pdf.js` y agregó el envío por correo en `subscriptions.service.js`.

## Sin implementar al cierre del 80 %

- Medición y cobro del excedente de Enterprise: la tarifa se publica, pero no se mide ni se cobra.
- Cancelación manual y cambio de método de pago (parte de CU-17).
