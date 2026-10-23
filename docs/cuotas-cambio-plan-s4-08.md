# S4-08 — Cuotas y consumo al cambiar de plan

Verificación de Storage con las suscripciones de S4-02/S4-03 (rama
`feature/pagos-planes` @ `ebea53f`). Las pruebas viven en
`backend/tests/quotas-plan-change.integration.test.js` y usan PostgreSQL real
(`TEST_DATABASE_URL`); cada prueba crea su propio esquema desde las migraciones.

## Qué se comprueba

| Escenario | Resultado esperado |
| --- | --- |
| Free → Standard (checkout aprobado) | Sube la capacidad; el consumo y el contador diario se conservan; ninguna imagen se pierde. |
| Carga tras subir de plan | Se acepta hasta el límite exacto y la siguiente se rechaza con `CAPACITY_EXCEEDED`. |
| Bajar de plan con usados + reservados dentro del plan nuevo | `200`, sin pago nuevo; la reserva pendiente se conserva. |
| Bajar de plan con consumo excedido | `409 PLAN_CAPACITY_EXCEEDED`; suscripción, pagos e imágenes intactos. La papelera cuenta; al borrar hasta el límite exacto, se permite. |
| Reserva pendiente al bajar | Cuenta como consumo hasta que se libera o se borra. |
| Deduplicación | Dos cuentas con el mismo archivo comparten un objeto físico, pero cada una consume su original lógico. |
| Renovar | El vencimiento avanza; plan, consumo y cupos diarios no cambian. |
| Vencimiento sin renovar | Rigen los límites Free; el consumo real se informa completo, el disponible nunca es negativo, no se borra ni se oculta ninguna imagen y la descarga sigue funcionando. |
| Cargas concurrentes (síncronas y asíncronas) | Se aceptan exactamente las que caben. |
| Bajar de plan y cargar a la vez (8 rondas) | Usados + reservados nunca superan la capacidad del plan vigente. |
| Misma `Idempotency-Key` en paralelo | Un solo pago y una sola suscripción activa. |
| Pago rechazado | Capacidad y consumo sin cambios. |

Cada prueba contrasta `GET /api/quotas/me` con sumas calculadas directamente en
SQL (usados, reservados, disponibles y suscripciones activas por usuario).

## Hallazgos

1. **Mensaje del downgrade rechazado.** La tarjeta S4-03 pide que indique cuánto
   espacio liberar; hoy responde un texto genérico. Queda como prueba `todo`
   (no rompe la regresión) para que Elden la active al corregirlo.
2. **Migración 011.** `feature/pagos-planes` usa `011_payment_subscription_link.sql`
   (también 012 y 013), pero `011` estaba reservada para usuarios (Andy). Debe
   acordarse la numeración antes de integrar `feature/usuarios-login`.
3. **Vencimiento y orden de historial.** `GET /api/quotas/me` y la carga eligen la
   última suscripción por `started_at`. Si el historial se altera de forma
   incoherente (una suscripción cancelada más reciente que la vencida) responde
   `403 NO_ACTIVE_SUBSCRIPTION` en vez de caer a Free. En el flujo normal esto no
   ocurre, porque la suscripción de pago siempre empieza después de la Free
   cerrada.

## Cómo ejecutar

```bash
cd backend
TEST_DATABASE_URL=postgres://usuario@localhost:5432/postgres \
  node --test tests/quotas-plan-change.integration.test.js
```

Resultado en la verificación del 22/10/2026 (Node 24.22, PostgreSQL 16):
12 aprobadas y 1 `todo` (hallazgo 1); suite completa del backend 163 aprobadas,
0 fallos, 1 `todo`. La prueba de carrera se repitió 6 veces sin fallos.
