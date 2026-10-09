# Worker, recuperación y cuotas compartidas

Actualizado el 07/10/2026. Integra la base de Elden S3-08 y el acoplamiento backend S3-11. El frontend del producto mantiene su entrega anterior; sus nuevos contratos están en la [guía de Alegría](frontend-auth-jobs-handoff.md).

## Operación

```powershell
npm ci
docker compose --profile worker up -d postgres redis
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
2. Después de COMMIT, envía sólo el UUID a BullMQ y responde 202 con estado privado. Si Redis falla, conserva la admisión y el reconciliador repara la entrega. `Idempotency-Key` UUID opcional reutiliza el mismo trabajo cuando archivo/nombre/carpeta coinciden.
3. El consumidor convierte con Sharp; guarda recibo del resultado y estado converted.
4. El lifecycle bloquea usuario→objeto, publica o reutiliza el WebP, crea una referencia propia, confirma cuota y registra published dentro de una transacción PostgreSQL.
5. Después de COMMIT, limpia originales y resultado temporal. Los fallos terminales y la expiración liberan la reserva una sola vez.

GET de listado/detalle mantiene el contrato S3-05. La descarga usa imageId y JWT. POST /api/files conserva su recorrido síncrono y usa el mismo repositorio de cuotas y eventos de consumo.

## Cuotas y migración

`005_quota_reservations.sql` conserva el archivo publicado de Elden. `006_shared_quota_lifecycle.sql` añade usage_date, relación opcional con la imagen, carpeta del trabajo y tareas durables de limpieza física.

La capacidad usa tamaños originales de referencias actuales más todas las reservas pendientes. El consumo diario usa eventos confirmados independientes de images más reservas pendientes del día. El día se fija al admitir en America/Guatemala y se conserva al confirmar, aunque cambie la fecha.

La migración vincula reservas de publicaciones anteriores, incorpora imágenes síncronas existentes una sola vez y reconstruye los agregados desde los eventos confirmados. Conserva reservas de imágenes ya borradas. El migrador registra nombre y checksum en una transacción y omite archivos aplicados; una segunda ejecución no vuelve a sumar consumo. No editar migraciones publicadas/aplicadas.

## Contrato interno

`createManagedImageJobs({ database, storageRoot })` instala el lifecycle real; es la fábrica usada por HTTP, worker y recuperador. `createImageJobs` sin lifecycle queda para pruebas del núcleo y trabajos históricos internos.

| Operación | Comportamiento |
| --- | --- |
| `quotas.reserve(client, { reservationKey, userId, bytes })` | Client con transacción abierta; bloquea usuario con FOR NO KEY UPDATE, valida inicio/expiración del plan, capacidad, pendientes y límites. Repite UUID/datos sin duplicar. |
| `quotas.confirm(client, key, userId, imageId?)` | Mismo client; transición pending→confirmed e incremento del día reservado. El lifecycle proporciona una imagen propia del tamaño correcto. |
| `quotas.release(client, key, userId)` | Mismo client; pending→released, repetición sin efecto. Funciona aunque la cuenta se desactive tras admisión. |
| `withUserTransaction(userId, callback)` | Conveniencia para consumidores independientes; abre su transacción. El lifecycle usa las operaciones con client recibido. |

No hay BEGIN/COMMIT internos en reserve/confirm/release. El bloqueo del usuario permanece hasta el COMMIT del llamador. Admisión reserva antes del INSERT del trabajo, evitando conflictos con KEY SHARE de claves foráneas. Orden de integración: trabajo→usuario→objeto. El limpiador de objetos toma sólo el bloqueo del objeto y no pide después un usuario.

## Fallos y recuperación

- PostgreSQL es la fuente de verdad. El reconciliador inicia con el worker y repite cada 30 segundos; conserva backoff/entradas Redis activas y repone entregas perdidas.
- Máximo de tres intentos persistentes; perder Redis no reinicia el contador. Expiración a las 24 horas de la admisión.
- El publicador copia el resultado y lo renombra atómicamente; conserva el resultado de entrada hasta COMMIT. Una caída antes de COMMIT puede dejar un objeto físico sin fila, que se reutiliza al recuperar o se retira al liberar. Conserva siempre objetos con fila/referencias de otras cargas.
- Una caída después de COMMIT se resuelve leyendo published: no vuelve a crear imagen ni incrementar consumo. El recibo permite recuperar converted sin repetir Sharp.
- DELETE de la última referencia confirma primero SQL y registra storage_cleanup_tasks. El borrado físico se realiza después bajo bloqueo del objeto; si se interrumpe o falla, el siguiente barrido lo completa. Una subida que adopta ese hash conserva su objeto.
- Limpieza de temporales por UUID, sin seguir enlaces/junctions ni barrer temporales síncronos ajenos. SIGINT/SIGTERM esperan el cierre; una terminación forzada se recupera al reiniciar.

## Verificación

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'
npm run test:storage
npm run check
Remove-Item Env:TEST_REDIS_URL
```

test:storage crea y elimina una base temporal local en 5433; cada prueba Redis usa una cola aleatoria que elimina al finalizar, sin FLUSHDB/FLUSHALL. Incluye límites/concurrencia compartidos, medianoche, suscripción futura, rollback, migración repetida, idempotencia HTTP, publicación privada, deduplicación, liberación/expiración, borrado y caídas reales antes/después de COMMIT. La verificación del frontend asíncrono continúa con Alegría.
