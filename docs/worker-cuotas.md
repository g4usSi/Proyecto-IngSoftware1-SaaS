# S3-04/S3-05: worker, recuperación y contrato de cuotas

Actualizado el 04/10/2026. S3-04 conserva su núcleo terminado; S3-05 completa la recuperación propia. El acoplamiento real con S3-08 pertenece a S3-11, según [el criterio individual del equipo](https://github.com/g4usSi/Proyecto-IngSoftware1-SaaS/blob/ccb32aa/docs/criterios-cierre-modulos.md).

## Entregado

- BullMQ/Redis y Sharp con estados PostgreSQL `queued → processing → converted`, o `failed`. Con un adaptador de publicación/cuotas, `converted → published`.
- Reconciliación al iniciar el worker y cada 30 segundos: repone trabajos admitidos en PostgreSQL cuyo envío a Redis se perdió. Reintenta entradas Redis terminadas cuando PostgreSQL aún tiene trabajo pendiente.
- Límite persistente de tres intentos de conversión. Vaciar/perder Redis no reinicia ese límite. Los fallos transitorios conservan el original; el backoff pendiente de BullMQ no se adelanta.
- Recuperación después de una interrupción: un recibo SHA-256 acompaña el WebP. Si ya existe un resultado verificado, confirma su estado sin convertirlo nuevamente. Si la interrupción ocurre durante una conversión incompleta, puede repetir ese intento; nunca publica dos resultados por esa entrega.
- Expiración a las 24 horas desde admisión de trabajos aún no publicados. Terminan `failed / JOB_EXPIRED`; no queda una fila indefinidamente en `processing` después de reiniciar el consumidor.
- Limpieza de originales y residuos por UUID. Un trabajo convertido conserva solo `result.webp` y `result.json` hasta publicación o expiración. Los fallidos/publicados eliminan su directorio completo. Los directorios sin fila se eliminan al superar 24 horas.
- Bloqueo PostgreSQL compartido por admisión, conversión, recuperación, publicación y limpieza. El barrido omite trabajos bloqueados, conserva carpetas recientes y no sigue enlaces/junctions. No recorre ni borra objetos definitivos ni temporales de la ruta síncrona ajenos a este módulo.
- Consulta HTTP por propietario y cliente JavaScript para Alegría: [guía de integración](s3-05-handoff.md).

`converted` significa **WebP temporal verificado**, no imagen disponible. `published` requiere una referencia propia y confirmación de cuota en la misma transacción. La aplicación conserva `POST /api/files` síncrono; `POST /api/jobs` responde `503 ASYNC_UPLOAD_NOT_READY` y no admite archivos.

## Arranque

Requiere Node 24, PostgreSQL, Redis y el mismo disco privado accesible desde API/worker. Aplicar migraciones con los procesos detenidos antes de arrancar la nueva versión; no mezclar workers S3-04 antiguos con S3-05.

```powershell
npm ci
docker compose --profile worker up -d postgres redis
npm run db:migrate
npm run dev
# En otra terminal:
npm run worker:images
# Alternativa operativa: un barrido único (no convierte):
npm run worker:recover
```

En `backend/.env`: `DATABASE_URL`, `STORAGE_ROOT`, `REDIS_URL=redis://127.0.0.1:6379/0` y `IMAGE_WORKER_CONCURRENCY=2`. Compose configura AOF y noeviction. La migración incremental `005_image_job_recovery.sql` conserva filas y añade vencimiento, limpieza y liquidación de cuotas. Las filas heredadas reciben 24 horas desde la migración.

El reconciliador pagina por UUID y continúa después de errores de una fila; registra códigos, nunca trazas SQL o credenciales. Las liberaciones pendientes permanecen registradas aunque se haya limpiado el original. El barrido se recupera en el siguiente ciclo. Si Redis conserva una entrada `active`, se respeta su bloqueo y BullMQ la devuelve a espera/fallo mediante su detección de trabajos interrumpidos; no se elimina una entrada activa a la fuerza. Referencias: [stalled jobs](https://docs.bullmq.io/guide/jobs/stalled), [reintentos](https://docs.bullmq.io/guide/retrying-failing-jobs) y [cierre ordenado](https://docs.bullmq.io/guide/workers/graceful-shutdown).

`SIGINT`/`SIGTERM` detienen el ciclo y esperan al trabajo activo antes de cerrar las conexiones. Una terminación forzada se recupera al reiniciar. Las pruebas acreditan caída de procesos; no simulan pérdida física del disco o del servidor PostgreSQL.

## Contrato interno para Elden y S3-11

`createImageJobs({ database, storageRoot, lifecycle? })` expone `stage({ ownerId, file })`, `get(ownerId, id)`, `list(ownerId, query)`, `process(id)` y `recover(id, ensureQueued)`. El archivo inicial de `stage` pertenece al llamador, quien lo debe eliminar después de la admisión o su fallo.

Sin `lifecycle`, las admisiones son internas, sin reservas (`quota_managed=false`). **No conectar esta modalidad a HTTP.** No existe modo de cuotas falsas activable por configuración. Los dobles se inyectan solo en pruebas.

El puerto de integración está implementado y probado con dobles, pero Elden aún debe entregar su implementación de cuotas y el equipo adaptar sus operaciones a este puerto:

| Función del adaptador | Transacción y resultado |
| --- | --- |
| `reserve(client, payload)` | Comparte el INSERT del trabajo. Bloquear usuario, validar plan y pendientes, reservar por UUID. Lanzar error si no hay cupo; se revierten reserva y trabajo. |
| `confirm(client, payload)` | Orquestador de S3-11: publicar/reutilizar objeto, crear referencia propia y llamar a la confirmación de cuota de Elden usando este mismo cliente. Devuelve `{ imageId }`. El worker verifica propietario/hash/objeto ready y marca `published` en esa transacción. |
| `release(client, payload)` | Liberar reserva idempotente por UUID en fallo/expiración; el worker registra liquidación en la misma transacción. Si falla, el siguiente barrido repite. |

`payload` contiene `jobId`, `userId`, `originalHash`, `originalSizeBytes` (string) y `originalName`. Confirmación añade `resultPath` (solo servidor); liberación añade `reason` (código de error). El orquestador debe conservar el original de entrada de confirmación hasta COMMIT: copiar/publicar de forma idempotente, nunca mover ni borrar ese WebP temporal antes de confirmar. Debe coordinar y reparar también sus efectos físicos si revierte la transacción.

Todas las funciones reciben un cliente con transacción abierta: no abrir otro pool, no hacer COMMIT propio ni efectos externos irreversibles. Respetar orden bloqueo **trabajo → usuario → objeto**, idempotencia por UUID y validaciones del plan/reserva. Un COMMIT cuya respuesta se pierde se resuelve releyendo la fila, sin repetir un efecto confirmado.

El adaptador de confirmación incluye publicación porque confirmar consumo solo por haber convertido dejaría cuotas inconsistentes si la publicación falla. La implementación de cuotas de Elden puede mantenerse separada y ser llamada por este orquestador.

Al configurar cuotas reales, API, worker y recuperador deben recibir el mismo adaptador. Actualmente los ejecutables no lo instancian porque no existe implementación S3-08 en esta rama. Las filas con cuotas administradas y sin adaptador conservan su liquidación pendiente; jamás se marcan como liberadas/confirmadas ficticiamente.

## Verificación

El 01/10 se verificó el núcleo en `e590ae8`: 50/50; esa evidencia no cubría S3-05. El 04/10 se ejecutó la suite ampliada con PostgreSQL Docker y Redis real: ver [evidencia S3-05](evidencias/2026-10-04-s3-05/resultado.json).

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'
npm run test:storage
npm run check
Remove-Item Env:TEST_REDIS_URL
```

`test:storage` requiere PostgreSQL local en 5433 y permiso para crear una **base temporal propia**, que elimina al finalizar. Cada prueba Redis usa una cola aleatoria y limpia solo esa cola. Nunca usa FLUSHDB/FLUSHALL. Sin las variables de servicios correspondientes, se informan omisiones explícitas.

Cobertura propia: admisión sin envío, dos reconciliadores, pérdida de entradas Redis, caídas reales antes/después del resultado, máximo de intentos, expiración con conversión activa, huérfanos recientes/bloqueados/enlaces, original perdido, resultado corrupto, errores de confirmación/liberación y rollback con dobles SQL, endpoints JWT/propietario/paginación. S3-11 aún debe comprobar cuotas reales, publicación/deduplicación definitiva y recorrido completo de la interfaz.
