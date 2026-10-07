# Contratos de API

Base: `/api`. JSON UTF-8. Éxito: `{ "data": ... }`. Error: `{ "error": { "code": "CODIGO", "message": "Mensaje" } }`. No se devuelven trazas internas ni hashes de contraseña.

## Operaciones disponibles

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/health` | `200`, `{ "data": { "status": "ok", "service": "smartstorage-api" } }` |
| GET | `/ready` | `200` con BD conectada; `503 DATABASE_UNAVAILABLE` si falta configuración o conexión |
| GET | `/plans` | `200`, catálogo activo de PostgreSQL; requiere migraciones. El seed incluye únicamente Free |
| POST | `/auth/register` | `201`, crea usuario cliente y suscripción Free de forma atómica; no inicia sesión; envía el correo de verificación |
| POST | `/auth/login` | `200`, `{ data: { token, expiresAt, user } }`; `403 EMAIL_NOT_VERIFIED` si el correo no está verificado |
| POST | `/auth/verify-email` | `200`, `{ data: { verified: true } }`; `{ token }` de un solo uso, vence en 24 h |
| POST | `/auth/resend-verification` | `200`, `{ data: { message } }`; `{ email }`, respuesta neutral |
| POST | `/auth/forgot-password` | `200`, `{ data: { message } }`; `{ email }`, respuesta neutral sin revelar si existe la cuenta |
| POST | `/auth/reset-password` | `200`, `{ data: { reset: true } }`; `{ token, password }`, token de un solo uso, vence en 1 h |
| GET | `/auth/me` | `200`, `{ data: user }`; requiere Bearer JWT |
| POST | `/auth/logout` | `200`, `{ data: { loggedOut: true } }`; revoca el JWT actual |
| GET | `/dev/storage-demo` | `200`, `{ data: { enabled, accounts } }`; apagada no devuelve identidades |
| GET | `/files` | `200`, listado paginado privado; necesita autenticación o demo local explícita |
| POST | `/files` | `201`, recibe una imagen y confirma cuando el WebP está listo |
| GET | `/files/:fileId/download` | `200`, descarga WebP del propietario; recurso ajeno o inexistente: `404` |
| DELETE | `/files/:fileId` | `200`, elimina la referencia propia; conserva consumo diario y objetos compartidos |
| GET | `/jobs` | `200`, trabajos propios paginados; Bearer JWT; `limit` y `cursor` |
| GET | `/jobs/:jobId` | `200`, estado persistente privado; ajeno/inexistente: `404` |
| POST | `/jobs` | `202`, admite multipart, reserva cuota y entrega el trabajo privado; Bearer JWT |
| GET | `/quotas/me` | `200`, plan vigente, capacidad y consumo/reservas diarios; Bearer JWT |
| GET | `/admin/storage/stats` | `200`, ahorro global calculado; requiere rol `admin` |

Los tamaños BIGINT y precios NUMERIC del catálogo viajan como strings decimales para no perder precisión. Los contadores diarios limitados son enteros o `null`.

El login devuelve el campo **`token`**, no `accessToken`. El frontend lo envía con `Authorization: Bearer <token>` en las rutas privadas. `GET /auth/me` devuelve el usuario directamente dentro de `data`, no `{ data: { user } }`. Ver [contrato detallado de autenticación](auth-frontend.md) y [traspaso al frontend](frontend-handoff.md).

## Storage

Para estados de procesamiento y recuperación, ver [entrega S3-05 a Alegría](s3-05-handoff.md) y [OpenAPI de trabajos](contracts/jobs.openapi.json). `converted` no equivale a imagen disponible; solo `published` puede habilitar descarga. La carga síncrona siguiente sigue vigente.

`POST /files` recibe `multipart/form-data`, un único campo de archivo `file` y `folderId` opcional. No acepta un propietario suministrado en el cuerpo. Admite imágenes estáticas JPG, PNG o WebP de hasta 25,000,000 bytes y 40 millones de píxeles; el servidor valida el contenido real. Convierte a WebP calidad 80, aplica orientación y elimina EXIF/GPS. No persiste el original.

Respuesta `201`:

```json
{
  "data": {
    "image": {
      "id": "UUID",
      "originalName": "foto.jpg",
      "createdAt": "2026-09-23T12:00:00.000Z",
      "status": "ready",
      "originalSizeBytes": "2500000",
      "optimizedSizeBytes": "800000"
    }
  }
}
```

Es un ejemplo de formato, no una promesa de compresión. `optimizedSizeBytes` se obtiene del archivo físico. No se expone si otra cuenta ya tenía el contenido.

`GET /files?limit=20&cursor=...` devuelve `{ data: { items: [/* imágenes disponibles con ese formato */], unavailableItems: [], nextCursor: null } }`. Para continuar, enviar el cursor recibido sin interpretarlo. El orden es descendente por fecha e ID; `nextCursor` es una cadena mientras queden resultados. La biblioteca vacía devuelve ambos arrays vacíos.

Si falta un archivo físico o su referencia no es válida, el listado sigue devolviendo `200` con las imágenes sanas. `unavailableItems` contiene `{ id, originalName, createdAt, originalSizeBytes, status: "unavailable", errorCode: "STORAGE_INTEGRITY_ERROR" }` para los registros afectados del propietario; no incluye rutas, hashes ni un tamaño WebP inventado. Los registros y cuotas se conservan. El cursor y `limit` cuentan tanto disponibles como no disponibles: una página puede tener `items: []` y un `nextCursor` válido. El frontend debe mostrar los faltantes, permitir avanzar de página y excluirlos del cálculo de ahorro; su tamaño original sí cuenta para la cuota. Consumidores antiguos pueden omitir este campo adicional.

`GET /files/:fileId/download` devuelve `image/webp` con `Content-Disposition: attachment`. Requiere las mismas credenciales que el listado; un hash o ruta física no sirve como credencial. El frontend obtiene un blob mediante su cliente autorizado, sin publicar el directorio de archivos.

`DELETE /files/:fileId` devuelve `{ data: { deleted: true, imageId: "UUID" } }`. Un ID ajeno, inexistente o ya borrado responde `404`. Libera la capacidad de esa referencia, pero conserva el evento de consumo diario. El último enlace elimina el objeto lógico y programa la limpieza física durable; un WebP aún compartido se conserva. Si el archivo ya faltaba, también permite eliminar la referencia propia.

## Admisión asíncrona y cuotas

`POST /jobs` recibe el mismo multipart `file`/`folderId`, exige JWT y acepta `Idempotency-Key: UUID` opcional. Alegría debe generar una clave por entrada y conservarla al reintentar un envío incierto. Repetir propietario, clave, contenido, nombre y carpeta devuelve el mismo trabajo; cambiar esos datos responde `409 IDEMPOTENCY_CONFLICT`. Una clave ajena devuelve `404`. Para volver a intentar un trabajo terminal fallido, crear una clave nueva.

El `202` devuelve `{ data: ImageJob }` con `Location: /api/jobs/:jobId`. La admisión y la reserva ya están confirmadas en PostgreSQL; un fallo de entrega a Redis mantiene el trabajo recuperable y también devuelve `202`. No equivale a archivo disponible: consultar su estado y habilitar descarga sólo si `status === "published" && available`. El worker convierte, publica la referencia privada y confirma la cuota en la misma transacción. Los errores de formato pueden aparecer después como un trabajo `failed`; el rechazo HTTP previo cubre archivo ausente/vacío, tamaño, carpeta, identidad y cuotas.

`GET /quotas/me` devuelve:

```json
{"data":{"plan":{"code":"free","name":"Free"},"capacityBytes":"2000000000","usedBytes":"1000","reservedBytes":"500","availableBytes":"1999998500","daily":{"date":"2026-10-07","uploadLimit":10,"uploadsUsed":"1","uploadsReserved":"1","bytesLimit":"200000000","bytesUsed":"1000","bytesReserved":"500"}}}
```

Bytes y consumo viajan como strings decimales; `uploadLimit` es entero o `null` y `bytesLimit` es string o `null`. La capacidad incluye referencias sin archivo y reservas pendientes de cualquier fecha. El consumo diario y las reservas diarias corresponden al día de **admisión** en Guatemala, incluso si se confirma después de medianoche. Refrescar cuotas tras admisión, publicación, fallo y borrado. Una suscripción futura, vencida o un plan inactivo responde `403 NO_ACTIVE_SUBSCRIPTION`.

Ambas rutas de subida siguen vigentes y comparten límites; usar sólo una por entrada del frontend. Ver [guía pendiente de Alegría](frontend-auth-jobs-handoff.md), [lifecycle y recuperación](worker-cuotas.md) y [OpenAPI](contracts/jobs.openapi.json).

Errores relevantes: `400` archivo faltante/vacío/corrupto o paginación inválida; `413 FILE_TOO_LARGE`; `415` formato o animación no admitidos; `403` capacidad o suscripción no válida; `429` cualquiera de los límites diarios; `503 STORAGE_INTEGRITY_ERROR` en descarga, deduplicación o estadísticas si falta un objeto que la BD declara disponible. El listado informa esos objetos mediante `unavailableItems`.

`GET /admin/storage/stats` devuelve strings decimales: `originalSizeBytes` (B), `uniqueOriginalSizeBytes` (U), `optimizedSizeBytes` (P), `savedBytes` (B−P), `savedPercent`, `imageCount` y `objectCount`. Biblioteca vacía: ceros y `savedPercent: "0.00"`. Incluye cada objeto físico una sola vez y puede informar ahorro negativo. Las cuentas demo son clientes, no administradores.

## Rutas aún pendientes (501)

| Método | Ruta | Contrato previsto |
| --- | --- | --- |
| GET | `/subscriptions/me` | Suscripción y plan de la cuenta autenticada |

Estas rutas siguen siendo marcadores de alcance: no deben mostrarse como funciones operativas en el frontend. `GET /subscriptions/me` exige un JWT válido y después responde `501 SUBSCRIPTIONS_NOT_IMPLEMENTED`; no sirve todavía para mostrar el plan de la cuenta. Las rutas privadas sin sesión responden `401`.

Únicamente con la demo local habilitada se admite `X-Storage-Demo-User` para las dos cuentas reservadas. `npm run dev:demo` la activa en el proceso; no permite cuentas arbitrarias ni habilita las rutas de Auth o Suscripciones. El cliente elige una cuenta explícitamente. Ver [límites de la demo](storage.md).

## Contrato de identidad integrado

El cliente envía `Authorization: Bearer <token>`. El middleware verifica firma, expiración, revocación y estado del usuario. Solo entonces asigna:

```js
req.user = { id: 'UUID', email: 'cliente@example.test', role: 'client' };
```

Los controladores de Storage toman el propietario de `req.user.id`; nunca de un `userId` enviado por el cliente. Roles válidos: `client`, `admin`. El registro público siempre crea `client` aunque el cuerpo incluya `role`.

Errores actuales relevantes: `400` validación, `401` sesión inválida, `403` permiso o cuota insuficiente, `404` recurso inexistente/no accesible, `409` conflicto, `413` tamaño excedido, `415` formato inválido y `429` límite de intentos o cuota diaria. El campo `error.code` permite decidir la navegación; `error.message` se puede mostrar al usuario.

## Persistencia para la primera implementación

- `users`: UUID, correo normalizado único, nombre, hash de contraseña, rol, estado y verificación.
- `plans`/`subscriptions`: Free como seed; cada registro real recibe Free en la misma operación. El seed demo prepara sus propias suscripciones locales.
- `folders`/`images`: propiedad por usuario y vínculo con objeto global.
- `stored_objects`: hash del original, tamaño original, estado y ruta relativa WebP.
- `image_processing_jobs`: admisión, estado, reintentos y referencia publicada.
- `quota_reservations`/`quota_daily_usage`: reserva y consumo diario persistentes, independientes del borrado.
- `storage_cleanup_tasks`: limpieza física durable después de borrar la última referencia.

La revocación usa `003_revoked_tokens.sql`, recuperación `004_password_resets.sql`, verificación `005_email_verification_tokens.sql`, trabajos `004_image_processing_jobs.sql`/`005_image_job_recovery.sql`, reservas `005_quota_reservations.sql` y el lifecycle compartido `006_shared_quota_lifecycle.sql`. Aplicar todas con `npm run db:migrate`; no modificar migraciones ya publicadas. Pagos y administración de suscripciones siguen pendientes.
