# S3-08: reservas y consumo diario compartido

Actualizado el 07/10/2026. Base de Elden: feature/pagos-planes @ 5372a98 / 8911139. Correcciones y acoplamiento solicitados por Geovanny se incorporan en tema-y-flujo-git.

## Reglas

- pending→confirmed o pending→released. Cada UUID se reserva, confirma o libera una sola vez; repetir la operación mantiene el estado. Transiciones entre confirmed y released se rechazan.
- La capacidad lógica suma todas las referencias propias y todas las reservas pendientes, incluidos trabajos de otro día.
- Los límites diarios suman consumo confirmado y pendientes del día de admisión en America/Guatemala. usage_date queda fija hasta confirmación. Una confirmación de ayer realizada hoy consume ayer.
- Borrar una imagen elimina su referencia y libera capacidad. La reserva confirmada y el agregado diario permanecen.
- El plan debe estar activo, haber comenzado y no haber expirado.
- POST /api/files y POST /api/jobs usan las mismas reservas y el mismo historial.

## Conexión y bloqueos

El repositorio expone reserve(client,payload), confirm(client,key,userId,imageId?) y release(client,key,userId). El llamador entrega una transacción abierta; cada operación bloquea el usuario con FOR NO KEY UPDATE y conserva ese bloqueo hasta COMMIT/ROLLBACK.

withUserTransaction conserva la conveniencia de una operación independiente. El servicio original lo usa; el lifecycle del worker reutiliza su propia conexión. No abrir otra transacción desde el lifecycle.

La admisión reserva antes de insertar image_processing_jobs. Publicación toma usuario→objeto después del bloqueo por UUID del trabajo. El índice único de reservation_key evita duplicar admisiones; el vínculo image_id evita contar una imagen confirmada dos veces al trasladar datos existentes.

## Migraciones y datos anteriores

La migración 005 de Elden se conserva. La nueva 006 fija usage_date, vincula publicaciones anteriores e incorpora las imágenes actuales como reservas confirmadas históricas. quota_daily_usage se reconstruye desde eventos confirmados que sobreviven al borrado. El migrador registra checksum y no reaplica el traslado.

Para despliegue, detener API y consumidores, aplicar migraciones y arrancar todos desde el mismo código. La suite verifica un esquema anterior con historial y publicaciones, ejecuta el migrador dos veces y comprueba que no duplica eventos ni bytes.

## Contratos públicos

GET /api/quotas/me entrega plan, capacidad, usado, reservado, disponible y límites/consumos diarios. reserve/confirm/release son operaciones internas. POST /api/jobs admite multipart autenticado y devuelve 202; DELETE /api/files/:fileId elimina una referencia propia.

Errores compartidos: NO_ACTIVE_SUBSCRIPTION, CAPACITY_EXCEEDED, DAILY_UPLOAD_LIMIT_EXCEEDED y DAILY_BYTES_LIMIT_EXCEEDED. Errores internos del módulo: RESERVATION_CONFLICT, RESERVATION_NOT_FOUND, RESERVATION_ALREADY_RELEASED y RESERVATION_ALREADY_CONFIRMED.

Pruebas: backend/tests/quotas.test.js y backend/tests/async-quota.integration.test.js, junto con la regresión existente. Arranque y recuperación: [worker-cuotas.md](worker-cuotas.md). Trabajo pendiente de Alegría: [guía vigente](frontend-auth-jobs-handoff.md).
