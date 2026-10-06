# S3-08: cuotas para trabajos asíncronos

## Objetivo

S3-08 implementa reservas de cuota para permitir que los trabajos de
procesamiento asíncrono sean admitidos sin exceder los límites del plan
del usuario.

La reserva considera tanto el consumo confirmado como los trabajos que
todavía se encuentran pendientes.

## Estados de una reserva

Una reserva puede encontrarse en uno de estos estados:

- `pending`: la cuota está reservada para un trabajo pendiente.
- `confirmed`: el trabajo terminó correctamente y el consumo fue confirmado.
- `released`: el trabajo falló o fue descartado y la cuota reservada fue liberada.

Transiciones válidas:

`pending -> confirmed`

`pending -> released`

Una reserva confirmada no puede liberarse y una reserva liberada no puede
confirmarse.

## Identificador

Cada operación utiliza `reservationKey`, un UUID único.

El mismo UUID puede utilizarse nuevamente en un reintento sin crear una
segunda reserva.

Si el UUID ya existe con otro usuario o cantidad de bytes, la operación
se rechaza con `RESERVATION_CONFLICT`.

## Reserva

La operación:

`reserve(connection, { reservationKey, userId, bytes })`

comprueba:

- capacidad total del plan;
- límite diario de archivos;
- límite diario de bytes;
- consumo ya confirmado;
- reservas pendientes del usuario.

Las reservas del mismo usuario se serializan mediante un bloqueo de la
fila del usuario dentro de una transacción.

Esto garantiza que dos trabajos concurrentes intentando consumir el último
cupo no puedan ser admitidos simultáneamente.

## Confirmación

La operación:

`confirm(connection, reservationKey, userId)`

cambia una reserva `pending` a `confirmed`.

La confirmación registra el consumo en `quota_daily_usage`.

Repetir la confirmación del mismo UUID es idempotente y no incrementa
nuevamente el consumo diario.

## Liberación

La operación:

`release(connection, reservationKey, userId)`

cambia una reserva `pending` a `released`.

Una reserva liberada deja de participar en el cálculo de capacidad y de
límites pendientes.

Repetir la liberación del mismo UUID es idempotente.

Una reserva liberada antes de confirmarse no incrementa el consumo diario.

## Historial diario

`quota_daily_usage` mantiene el consumo diario separado de `images`.

Por lo tanto, eliminar posteriormente una imagen puede liberar capacidad
de almacenamiento sin eliminar el consumo diario que ya fue confirmado.

## Contrato para el worker

`withUserTransaction(userId, operation)` entrega la conexión PostgreSQL
de la transacción al callback.

La admisión futura del worker puede utilizar el siguiente patrón:

```js
await quotasRepository.withUserTransaction(userId, async (connection) => {
  await quotasRepository.reserve(connection, {
    reservationKey: jobId,
    userId,
    bytes,
  });

  await jobsRepository.insert(connection, {
    id: jobId,
    userId,
    bytes,
  });
});
```
