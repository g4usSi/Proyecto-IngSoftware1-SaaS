# Estados de trabajos y recuperación

Actualizado el 07/10/2026. Para las tareas nuevas de Alegría, usar la [guía vigente](frontend-auth-jobs-handoff.md).

| Recurso | Resultado |
| --- | --- |
| `POST /api/jobs` | Multipart `file`, `folderId` opcional y JWT; `Idempotency-Key` UUID opcional; 202 con job. |
| `GET /api/jobs?limit=20&cursor=...` | Trabajos propios, `{ data: { items, nextCursor } }`; limit 1–100. |
| `GET /api/jobs/:jobId` | `{ data: job }`; ajeno/inexistente: 404. |

Estados: `queued` → `processing` → `converted` → `published`, o `failed`. `converted` conserva un WebP temporal hasta publicación transaccional. Sólo `published` con `available` e `imageId` permite descargar la referencia propia. Si se borró la imagen, available=false.

`nextPollAfterMs` es null en estados finales. `quotaState` indica pending/settled en trabajos administrados; `not_required` sólo aparece en trabajos internos históricos. Cancelar consultas al salir o cerrar sesión. La UI ya tiene consulta de procesos; queda conectar su admisión.

La API admite y reserva antes de enviar a Redis. Un envío perdido se recupera desde PostgreSQL, al iniciar el worker y cada 30 segundos. La misma clave permite recuperar una admisión cuya respuesta HTTP se perdió. Un trabajo fallido requiere nueva admisión si el usuario desea volver a intentarlo.

Arranque y operación: [worker-cuotas.md](worker-cuotas.md). Contrato: [OpenAPI](contracts/jobs.openapi.json). Los ejemplos de [job-states.json](contracts/job-states.json) son muestras para desarrollo.

La evidencia S3-05 del 04/10 conserva su alcance histórico con dobles de cuotas; las pruebas nuevas de cuotas reales y publicación se registran por separado en la entrega S3-08/S3-11.
