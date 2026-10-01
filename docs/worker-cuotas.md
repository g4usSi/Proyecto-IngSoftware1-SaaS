# S3-04: worker de imágenes y punto de integración con Elden

## Dependencia comprobada

Trello, consultado el 30/09/2026, indica que [S3-04 de Geovanny](https://trello.com/c/nVmEkUYG) y [S3-08 de Elden](https://trello.com/c/VVR1aLMK) dependen ambas de S2-16. S3-04 no está programada después de S3-08: pueden desarrollarse en paralelo. Elden figura como apoyo del worker y Geovanny como apoyo de las cuotas.

El límite técnico está en **admitir subidas asíncronas y publicar el resultado como imagen del usuario**. Hace falta reservar capacidad y límites diarios desde la admisión, incluyendo trabajos pendientes, y confirmar o liberar esa reserva sin duplicarla al reintentar. Las cuotas actuales solo cuentan imágenes ya publicadas; no cubren una cola de pendientes.

## Implementado en este corte

- BullMQ con Redis, consumidor separado mediante `npm run worker:images` y concurrencia configurable (2 por defecto, máximo 8).
- Migración incremental `004_image_processing_jobs.sql`: propietario, hash/tamaño original, estados persistentes, intentos y código de error.
- Conversión Sharp real con las mismas validaciones JPG/PNG/WebP, límites, orientación y eliminación de metadatos que usa Storage.
- Estados `queued` → `processing` → `converted`, o `failed`. Un error transitorio vuelve a `queued`; BullMQ aplica hasta tres intentos con espera exponencial.
- Serialización por trabajo en PostgreSQL, repetición idempotente de una conversión terminada y consulta interna de estado limitada al propietario.
- Redis solo recibe el UUID del trabajo. El original temporal se elimina tras conversión confirmada o fallo terminal. El WebP convertido espera en almacenamiento privado.

**`converted` significa conversión temporal terminada. No significa imagen publicada, cuota confirmada ni disponibilidad en la galería.** `POST /api/files` conserva el flujo síncrono del 30%, con sus cuotas actuales. Este corte no introduce un endpoint público para saltarse S3-08.

S3-04 está avanzada hasta la integración de admisión/publicación. No se declara completa la entrega funcional del 50% ni S3-05: todavía falta reconciliar trabajos no enviados a Redis, fallos de procesos, temporales expirados y publicación definitiva después de las reservas.

## Archivos y uso interno

```text
storage/.tmp/jobs/<UUID>/original       Entrada privada pendiente de conversión
storage/.tmp/jobs/<UUID>/result.webp    Resultado temporal para publicación posterior
```

El worker y el futuro productor deben compartir `DATABASE_URL` y `STORAGE_ROOT`. No montar este directorio como contenido estático.

`createImageJobs({ database, storageRoot })` ofrece:

| Operación interna | Contrato actual |
| --- | --- |
| `stage({ ownerId, file })` | Copia el archivo temporal y registra un trabajo para un usuario activo. Devuelve `{ id, status: 'queued' }`. No reserva cuota. El llamador conserva la responsabilidad sobre el archivo de entrada que proporcionó. |
| `get(ownerId, id)` | Consulta estado, intentos y error de un trabajo propio, sin exponer hash ni rutas privadas. |
| `process(id, { finalAttempt })` | Consumidor: convierte y registra resultado persistente. Una repetición de un trabajo convertido no crea otra conversión. |

`createImageQueue(config)` construye la cola; esperar `queue.waitUntilReady()` antes de `enqueueImageJob(queue, id)`. La publicación en Redis se puede repetir con el mismo UUID. Si falla después de registrar el trabajo, conservar ese ID para recuperación; no volver a ejecutar `stage` ciegamente. El reconciliador PostgreSQL→Redis corresponde a S3-05.

Estas funciones permiten desarrollo y pruebas internas. **Antes de conectar `stage` a HTTP, habrá que cambiar su admisión para compartir una transacción con la reserva de Elden.** La función actual hace un INSERT independiente y no acredita ese requisito.

## Lo que falta acordar e integrar con Elden

Propuesta de contrato para S3-08, todavía no implementada ni presentada como acuerdo del equipo:

1. **Reserva por UUID de trabajo:** en una transacción con bloqueo de usuario, verificar plan vigente, sumar imágenes publicadas y reservas pendientes, reservar capacidad/cantidad/bytes diarios y registrar el trabajo. Usar bytes originales, aunque el contenido se deduplique después.
2. **Confirmación idempotente:** con orden de bloqueo usuario → objeto, publicar o reutilizar el WebP definitivo, crear una única referencia privada, confirmar el consumo y marcar publicación del trabajo en la misma transacción. Repetir el trabajo debe devolver la misma imagen.
3. **Fallo/cancelación/expiración:** liberar exactamente una vez las reservas pendientes que corresponda. Acordar el tratamiento diario de intentos fallidos; no alterar consumo confirmado accidentalmente.
4. **Historial diario independiente de `images`:** necesario antes del borrado S3-06 para que eliminar una imagen no reinicie las diez subidas o los 200 MB del día. La capacidad sí se libera al eliminar una referencia lógica.

Pruebas conjuntas necesarias: dos trabajos concurrentes en la última cuota disponible; mismo hash en dos cuentas; fallo/reintento sin doble consumo; expiración o cambio de plan durante procesamiento; borrado sin restituir consumo diario; caída entre COMMIT y respuesta.

Hasta esa integración, Geovanny puede desarrollar cola, conversión y estados como aquí. La activación del recorrido asíncrono, la recuperación completa ligada a reservas y el borrado coordinado quedan pendientes del trabajo conjunto. No es necesario esperar a que Elden termine para trabajar en el núcleo del worker.

## Arranque y pruebas

```powershell
npm ci
docker compose --profile worker up -d postgres redis
npm run db:migrate
npm run worker:images
```

Configuración en `backend/.env`, conservando el resto de valores propios:

```dotenv
REDIS_URL=redis://127.0.0.1:6379/0
IMAGE_WORKER_CONCURRENCY=2
```

El arranque verifica que exista la tabla de trabajos. `SIGINT`/`SIGTERM` dejan terminar el trabajo activo antes de cerrar conexiones. Redis se configura con AOF y `noeviction` en Compose. Referencias: [conexiones BullMQ](https://docs.bullmq.io/guide/connections) y [cierre ordenado](https://docs.bullmq.io/guide/workers/graceful-shutdown).

Para ejecutar también la prueba real de la cola:

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'
npm run test:storage
Remove-Item Env:TEST_REDIS_URL
```

El supervisor crea y elimina su propia base PostgreSQL local en 5433. La prueba Redis usa una cola de nombre aleatorio y elimina solo esa cola; no ejecuta `FLUSHDB` ni `FLUSHALL`. Sin `TEST_REDIS_URL`, esa prueba se omite explícitamente: un resultado con omisiones no certifica Redis.

## Verificación de este corte — 01/10/2026

- `npm run check`: sintaxis backend y compilación frontend correctas.
- `npm run test:storage` con `TEST_REDIS_URL`: 50 pruebas aprobadas, 0 fallos y 0 omisiones, usando PostgreSQL 18 y Redis 7 reales en servicios temporales locales.
- La integración de BullMQ verifica entrega diferida a un consumidor, conversión WebP persistida y rechazo de contenido inválido sin reintentos inútiles. Las pruebas de PostgreSQL verifican propietarios, conversiones repetidas y concurrentes, temporales alterados y recuperación de un fallo transitorio.
- Estas pruebas cubren el núcleo interno; no certifican admisión pública, reservas ni publicación, que todavía requieren la integración descrita arriba.
