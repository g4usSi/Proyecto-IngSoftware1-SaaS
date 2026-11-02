# Worker, recuperación y cuotas compartidas

Responsable: Geovanny; reservas de cuota: base de Elden. Registro de entregas anteriores: [historial](historial/geovanny.md).

## Operación

```powershell
npm ci
docker compose --profile worker up -d --wait postgres redis
# API y workers detenidos durante migraciones:
npm run db:migrate
npm run dev
# Otra terminal:
npm run worker:images
# Barrido único, sin consumidor:
npm run worker:recover
```

API, worker y recuperador comparten DATABASE_URL, STORAGE_ROOT y REDIS_URL en backend/.env. Compose publica Redis sólo en loopback, usa AOF y noeviction. IMAGE_WORKER_CONCURRENCY acepta 1–8, por defecto 2. No mezclar ejecutables antiguos con estas migraciones.

## Recorrido disponible

1. `POST /api/jobs` recibe una imagen, reserva cuota e inserta el trabajo en la misma transacción. La identidad procede del JWT. `folderId` opcional se valida contra el propietario.
2. Después de COMMIT, envía sólo el UUID a BullMQ y responde 202 con estado privado. Si Redis falla, conserva la admisión y el reconciliador repara la entrega. `Idempotency-Key` UUID opcional reutiliza el mismo trabajo cuando archivo, nombre y carpeta coinciden.
3. El consumidor convierte con Sharp; guarda recibo del resultado y estado converted.
4. El lifecycle bloquea usuario→objeto, publica o reutiliza el WebP, crea una referencia propia, confirma cuota y registra published dentro de una transacción PostgreSQL.
5. Después de COMMIT, limpia originales y resultado temporal. Los fallos terminales y la expiración liberan la reserva una sola vez.

`POST /api/files` conserva su recorrido síncrono y usa el mismo repositorio de cuotas y eventos de consumo. La interfaz web usa solamente `/api/jobs`.

## Estados de trabajos

| Recurso | Resultado |
| --- | --- |
| `POST /api/jobs` | Multipart `file`, `folderId` opcional y JWT; `Idempotency-Key` UUID opcional; 202 con el trabajo. |
| `GET /api/jobs?limit=20&cursor=...` | Trabajos propios, `{ data: { items, nextCursor } }`; limit 1–100. |
| `GET /api/jobs/:jobId` | `{ data: job }`; ajeno o inexistente: 404. |

Estados: `queued` → `processing` → `converted` → `published`, o `failed`. `converted` conserva un WebP temporal hasta la publicación transaccional. Sólo `published` con `available` e `imageId` permite descargar. Si la imagen se borró o está en papelera, `available` es false.

`nextPollAfterMs` es null en estados finales. `quotaState` indica pending o settled en trabajos administrados; `not_required` sólo aparece en trabajos internos históricos. Un trabajo fallido requiere una admisión nueva si el usuario desea volver a intentarlo. Contrato: [OpenAPI](contracts/jobs.openapi.json); ejemplos en [job-states.json](contracts/job-states.json).

## Reglas de cuota

- pending→confirmed o pending→released. Cada UUID se reserva, confirma o libera una sola vez; repetir la operación mantiene el estado. Las transiciones entre confirmed y released se rechazan.
- La capacidad lógica suma los tamaños originales de las referencias actuales, incluida la papelera, y todas las reservas pendientes, aunque sean de otro día.
- Los límites diarios suman el consumo confirmado y los pendientes del día de admisión en America/Guatemala. `usage_date` queda fija: una confirmación de ayer realizada hoy consume ayer.
- Borrar una imagen libera capacidad. La reserva confirmada y el agregado diario permanecen.
- Si la suscripción de pago venció por fecha, rigen los límites de Free sin borrar imágenes. Una suscripción futura, una no activa o un plan inactivo responden `403 NO_ACTIVE_SUBSCRIPTION`.

Errores públicos: NO_ACTIVE_SUBSCRIPTION, CAPACITY_EXCEEDED, DAILY_UPLOAD_LIMIT_EXCEEDED y DAILY_BYTES_LIMIT_EXCEEDED. Errores internos: RESERVATION_CONFLICT, RESERVATION_NOT_FOUND, RESERVATION_ALREADY_RELEASED y RESERVATION_ALREADY_CONFIRMED.

## Cambios de plan

Lo verifica `backend/tests/quotas-plan-change.integration.test.js` con PostgreSQL real, contrastando `GET /api/quotas/me` con sumas en SQL.

| Escenario | Resultado |
| --- | --- |
| Subir de plan con pago aprobado | Sube la capacidad; consumo y contador diario se conservan. |
| Bajar con usado + reservado dentro del plan nuevo | `200`, sin pago; la reserva se conserva. |
| Bajar con consumo excedido | `409 PLAN_CAPACITY_EXCEEDED` con `details.bytesToFree`; nada cambia. La papelera cuenta. |
| Renovar | El vencimiento avanza; plan, consumo y cupos diarios no cambian. |
| Vencer sin renovar | Rigen los límites de Free; el disponible nunca es negativo y las imágenes siguen descargables. |
| Bajar de plan y cargar a la vez | Usado + reservado nunca superan la capacidad vigente. |
| Pago rechazado | Capacidad y consumo sin cambios. |
| Misma `Idempotency-Key` en paralelo | Un solo pago y una sola suscripción activa. |

Límite conocido: si el historial se altera y la suscripción más reciente no está activa, la API responde `403 NO_ACTIVE_SUBSCRIPTION` en vez de aplicar Free. En el flujo normal no ocurre.

## Migraciones

`005_quota_reservations.sql` conserva el archivo publicado de Elden. `006_shared_quota_lifecycle.sql` añade usage_date, relación opcional con la imagen, carpeta del trabajo y tareas durables de limpieza física; vincula publicaciones anteriores, incorpora imágenes síncronas una sola vez y reconstruye los agregados desde eventos confirmados.

El migrador registra nombre y checksum en una transacción y omite archivos aplicados. No editar migraciones publicadas.

## Contrato interno

`createManagedImageJobs({ database, storageRoot })` instala el lifecycle real; es la fábrica usada por HTTP, worker y recuperador. `createImageJobs` sin lifecycle queda para pruebas del núcleo y trabajos históricos internos.

| Operación | Comportamiento |
| --- | --- |
| `quotas.reserve(client, { reservationKey, userId, bytes })` | Client con transacción abierta; bloquea usuario con FOR NO KEY UPDATE, valida inicio y expiración del plan, capacidad, pendientes y límites. Repetir UUID y datos no duplica. |
| `quotas.confirm(client, key, userId, imageId?)` | Mismo client; transición pending→confirmed e incremento del día reservado. |
| `quotas.release(client, key, userId)` | Mismo client; pending→released, repetición sin efecto. Funciona aunque la cuenta se desactive tras la admisión. |
| `withUserTransaction(userId, callback)` | Conveniencia para consumidores independientes; abre su transacción. El lifecycle usa las operaciones con client recibido. |

No hay BEGIN/COMMIT internos en reserve, confirm ni release. El bloqueo del usuario permanece hasta el COMMIT del llamador. La admisión reserva antes del INSERT del trabajo, evitando conflictos con KEY SHARE de claves foráneas. Orden de integración: trabajo→usuario→objeto. El limpiador de objetos toma sólo el bloqueo del objeto y no pide después un usuario.

## Fallos y recuperación

- PostgreSQL es la fuente de verdad. El reconciliador inicia con el worker y repite cada 30 segundos; conserva backoff y entradas Redis activas y repone entregas perdidas.
- Máximo de tres intentos persistentes; perder Redis no reinicia el contador. Expiración a las 24 horas de la admisión.
- El publicador copia el resultado y lo renombra atómicamente; conserva el resultado de entrada hasta COMMIT. Una caída antes de COMMIT puede dejar un objeto físico sin fila, que se reutiliza al recuperar o se retira al liberar. Conserva siempre objetos con fila o referencias de otras cargas.
- Una caída después de COMMIT se resuelve leyendo published: no vuelve a crear imagen ni incrementar consumo. El recibo permite recuperar converted sin repetir Sharp.
- DELETE de la última referencia confirma primero SQL y registra storage_cleanup_tasks. El borrado físico se realiza después bajo bloqueo del objeto; si se interrumpe o falla, el siguiente barrido lo completa. Una subida que adopta ese hash conserva su objeto.
- Limpieza de temporales por UUID, sin seguir enlaces ni barrer temporales síncronos ajenos. SIGINT y SIGTERM esperan el cierre; una terminación forzada se recupera al reiniciar.

## Verificación

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'
npm run test:storage
npm run check
Remove-Item Env:TEST_REDIS_URL
```

test:storage crea y elimina una base temporal local en 5433; cada prueba Redis usa una cola aleatoria que elimina al finalizar, sin FLUSHDB ni FLUSHALL. Incluye límites y concurrencia compartidos, medianoche, suscripción futura, rollback, migración repetida, idempotencia HTTP, publicación privada, deduplicación, liberación y expiración, borrado y caídas reales antes y después de COMMIT.
