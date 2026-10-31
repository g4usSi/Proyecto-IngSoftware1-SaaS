# Contratos de API

Álbumes, movimiento y papelera: [contratos de organización](organizacion-frontend.md#api-de-organización). La migración 007 añade `folderId`/`deletedAt` a los DTO y oculta de la biblioteca/descarga las imágenes en papelera. `DELETE /files/:id` conserva el borrado definitivo por compatibilidad.

Base: `/api`. JSON UTF-8. Éxito: `{ "data": ... }`. Error: `{ "error": { "code": "CODIGO", "message": "Mensaje" } }`. No se devuelven trazas internas ni hashes de contraseña.

## Operaciones disponibles

| Método | Ruta                        | Resultado                                                                                                                                                      |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                   | `200`, `{ "data": { "status": "ok", "service": "smartstorage-api" } }`                                                                                         |
| GET    | `/ready`                    | `200` con BD conectada; `503 DATABASE_UNAVAILABLE` si falta configuración o conexión                                                                           |
| GET    | `/plans`                    | `200`, catálogo activo de PostgreSQL: Free, Estándar, Pro y Enterprise; requiere migraciones. Ver [cuotas y condiciones del catálogo](planes-pagados-s4-01.md) |
| POST   | `/auth/register`            | `201`, crea usuario cliente y suscripción Free de forma atómica; no inicia sesión; envía el correo de verificación                                             |
| POST   | `/auth/login`               | `200`, `{ data: { token, expiresAt, user } }`; `403 EMAIL_NOT_VERIFIED` si el correo no está verificado                                                        |
| POST   | `/auth/verify-email`        | `200`, `{ data: { verified: true } }`; `{ token }` de un solo uso, vence en 24 h                                                                               |
| POST   | `/auth/resend-verification` | `200`, `{ data: { message } }`; `{ email }`, respuesta neutral                                                                                                 |
| POST   | `/auth/forgot-password`     | `200`, `{ data: { message } }`; `{ email }`, respuesta neutral sin revelar si existe la cuenta                                                                 |
| POST   | `/auth/reset-password`      | `200`, `{ data: { reset: true } }`; `{ token, password }`, token de un solo uso, vence en 1 h                                                                  |
| GET    | `/auth/me`                  | `200`, `{ data: user }`; requiere Bearer JWT                                                                                                                   |
| POST   | `/auth/logout`              | `200`, `{ data: { loggedOut: true } }`; revoca el JWT actual                                                                                                   |
| GET    | `/dev/storage-demo`         | `200`, `{ data: { enabled, accounts } }`; apagada no devuelve identidades                                                                                      |
| GET    | `/files`                    | `200`, listado paginado privado; necesita autenticación o demo local explícita                                                                                 |
| POST   | `/files`                    | `201`, recibe una imagen y confirma cuando el WebP está listo                                                                                                  |
| GET    | `/files/:fileId/download`   | `200`, descarga WebP del propietario; recurso ajeno o inexistente: `404`                                                                                       |
| DELETE | `/files/:fileId`            | `200`, elimina la referencia propia; conserva consumo diario y objetos compartidos                                                                             |
| GET    | `/jobs`                     | `200`, trabajos propios paginados; Bearer JWT; `limit` y `cursor`                                                                                              |
| GET    | `/jobs/:jobId`              | `200`, estado persistente privado; ajeno/inexistente: `404`                                                                                                    |
| POST   | `/jobs`                     | `202`, admite multipart, reserva cuota y entrega el trabajo privado; Bearer JWT                                                                                |
| GET    | `/quotas/me`                | `200`, plan vigente, capacidad y consumo/reservas diarios; Bearer JWT                                                                                          |
| GET    | `/admin/storage/stats`      | `200`, ahorro global calculado; requiere rol `admin`                                                                                                           |
| GET | `/admin/summary` | `200`, resumen de cuentas, planes, almacenamiento lógico y trabajos; requiere rol `admin` |
| GET | `/admin/subscriptions` | `200`, suscripciones paginadas con usuario y plan; requiere rol `admin` |
| GET | `/admin/usage` | `200`, consumo por cuenta (lógico, reservado, disponible); requiere rol `admin` |
| GET | `/admin/jobs` | `200`, cola global de procesamiento paginada (RF-STO-14); requiere rol `admin` |
| GET | `/admin/audit-events` | `200`, bitácora de autenticación y cuentas (RF-AUT-12); requiere rol `admin` |
| GET | `/files/summary` | `200`, consumo lógico frente a físico y ahorro de la cuenta; Bearer JWT |
| GET | `/payments/:paymentId/receipt` | `200`, factura PDF de un pago aprobado propio; Bearer JWT |
| GET | `/payments/receipts` | `200`, PDF con una factura por pago aprobado; Bearer JWT |

Cada pago aprobado de `checkout`, `renew` o `change-plan` envía además la factura en PDF al correo de la cuenta, por el mismo SMTP de los correos de autenticación (Brevo). El envío ocurre después de confirmar el pago y no bloquea la respuesta: si falla, se registra en el log del servidor, el pago se conserva y la factura sigue disponible en estas rutas. Un reintento con la misma `Idempotency-Key` no la reenvía. Sin variables `SMTP_*` no se envía nada. La factura es de un pago simulado y no tiene validez fiscal.

Contratos para el frontend del 80 %: [frontend-80-contratos.md](frontend-80-contratos.md). Matriz de permisos: [permisos-api.md](permisos-api.md).

Los tamaños BIGINT y precios NUMERIC del catálogo viajan como strings decimales para no perder precisión. Los contadores diarios limitados son enteros o `null`.

`GET /plans` es público y devuelve `{ "data": [...] }`, ordenado por capacidad y código. Un catálogo sin planes activos devuelve `200` y `data: []`. Si PostgreSQL o las migraciones no están disponibles, responde `503 DATABASE_UNAVAILABLE` sin exponer detalles internos. `null` en un límite diario significa sin límite; nunca equivale a cero ni a una cuota personalizada pendiente.

El catálogo describe capacidades; consultarlo no contrata ni activa una suscripción. Los precios, la vigencia y el alcance de Enterprise se documentan en [S4-01](planes-pagados-s4-01.md). Los beneficios de SDK, prioridad y soporte no son permisos implementados por este endpoint.

Desde la migración 009, `monthlyPrice` y `currency` representan el importe mensual (USD), `billingPeriod` su vigencia y `pricingModel` el modelo de precio. Enterprise devuelve `monthlyPrice: "40.00"`, `capacityBytes: "200000000000"`, `includedStorageBytes: "200000000000"`, `storagePricePerGbMonth: "0.20"` y `storageBillingBasis: "time_weighted_excess"`: sólo se cobra el excedente de los 200 GB incluidos, ponderado por tiempo. La ampliación de capacidad y la medición para facturación corresponden a S4-02/S4-03. `monthlyPriceGtq` queda deprecado y devuelve `null` para dólares. La respuesta mantiene los límites diarios y el resto de campos anteriores. Ejecutar las migraciones antes de usar este contrato.

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
{
  "data": {
    "plan": { "code": "free", "name": "Free" },
    "capacityBytes": "2000000000",
    "usedBytes": "1000",
    "reservedBytes": "500",
    "availableBytes": "1999998500",
    "daily": {
      "date": "2026-10-07",
      "uploadLimit": 10,
      "uploadsUsed": "1",
      "uploadsReserved": "1",
      "bytesLimit": "200000000",
      "bytesUsed": "1000",
      "bytesReserved": "500"
    }
  }
}
```

Bytes y consumo viajan como strings decimales; `uploadLimit` es entero o `null` y `bytesLimit` es string o `null`. La capacidad incluye referencias sin archivo y reservas pendientes de cualquier fecha. El consumo diario y las reservas diarias corresponden al día de **admisión** en Guatemala, incluso si se confirma después de medianoche. Refrescar cuotas tras admisión, publicación, fallo y borrado. Una suscripción futura, vencida o un plan inactivo responde `403 NO_ACTIVE_SUBSCRIPTION`.

Ambas rutas de subida siguen vigentes y comparten límites; usar sólo una por entrada del frontend. Ver [guía pendiente de Alegría](frontend-auth-jobs-handoff.md), [lifecycle y recuperación](worker-cuotas.md) y [OpenAPI](contracts/jobs.openapi.json).

Errores relevantes: `400` archivo faltante/vacío/corrupto o paginación inválida; `413 FILE_TOO_LARGE`; `415` formato o animación no admitidos; `403` capacidad o suscripción no válida; `429` cualquiera de los límites diarios; `503 STORAGE_INTEGRITY_ERROR` en descarga, deduplicación o estadísticas si falta un objeto que la BD declara disponible. El listado informa esos objetos mediante `unavailableItems`.

`GET /admin/storage/stats` devuelve strings decimales: `originalSizeBytes` (B), `uniqueOriginalSizeBytes` (U), `optimizedSizeBytes` (P), `savedBytes` (B−P), `savedPercent`, `imageCount` y `objectCount`. Biblioteca vacía: ceros y `savedPercent: "0.00"`. Incluye cada objeto físico una sola vez y puede informar ahorro negativo. Las cuentas demo son clientes, no administradores.

## Consultas administrativas (S4-04)

Las tres rutas exigen `Authorization: Bearer <token>` de una cuenta activa con rol `admin`: sin sesión `401`, cliente `403 FORBIDDEN`. Son de solo lectura, responden `Cache-Control: private, no-store` y no usan columnas de precio, por lo que funcionan con el esquema hasta la migración 007 y con el de pagos (009). Los bytes y contadores viajan como strings decimales (1 GB = 1 000 000 000 bytes). Un parámetro desconocido, repetido o fuera de rango responde `400 INVALID_ADMIN_QUERY`.

Paginación común: `limit` (1–100, por defecto 20) y `offset` (por defecto 0). Las listas responden `{ items, total, limit, offset }`, con `total` como string. `search` (hasta 100 caracteres) busca por correo o nombre sin distinguir mayúsculas; `%` y `_` se tratan como texto.

`GET /admin/summary` (sin parámetros):

```json
{"data":{
  "users":{"total":"3","active":"3","verified":"3","admins":"1"},
  "plans":[{"code":"free","name":"Free","capacityBytes":"2000000000","currentSubscriptions":"3"}],
  "storage":{"logicalBytes":"2500","reservedBytes":"250","uniqueOriginalBytes":"1500",
    "deduplicatedBytes":"1000","deduplicatedPercent":"40.00",
    "imageCount":"3","trashCount":"1","uniqueObjectCount":"2"},
  "jobs":{"queued":"0","processing":"0","converted":"0","published":"0","failed":"0"}}}
```

- `logicalBytes`: suma de originales de todas las referencias, incluida la papelera (lo que se cobra a los clientes).
- `uniqueOriginalBytes`: originales de objetos físicos distintos. `deduplicatedBytes` = lógico − único, y `deduplicatedPercent` es su porcentaje sobre lo lógico (`"0.00"` sin datos).
- El tamaño físico WebP y el ahorro por conversión siguen en `GET /admin/storage/stats`, que lee los archivos del disco.
- `currentSubscriptions` cuenta suscripciones vigentes (`active`, ya iniciadas y sin vencer), con el mismo criterio que la admisión de cuotas.

`GET /admin/subscriptions?status=&plan=&search=&limit=&offset=`: `status` es `active`, `expired` o `cancelled`; `plan` es un código como `free`. Orden: inicio más reciente primero.

```json
{"data":{"items":[{"id":"UUID","status":"active","current":true,
  "startedAt":"2026-10-18T23:05:26.455Z","expiresAt":null,
  "user":{"id":"UUID","name":"Ana","email":"ana@ejemplo.com","active":true},
  "plan":{"code":"free","name":"Free","capacityBytes":"2000000000"}}],
  "total":"1","limit":20,"offset":0}}
```

`GET /admin/usage?plan=&search=&limit=&offset=`: una fila por cuenta, ordenada por consumo comprometido (usado + reservado), de mayor a menor. `plan` filtra por el plan vigente.

```json
{"data":{"items":[{"user":{"id":"UUID","name":"Ana","email":"ana@ejemplo.com","active":true},
  "plan":{"code":"free","name":"Free","capacityBytes":"2000000000"},
  "usedBytes":"1500","reservedBytes":"0","availableBytes":"1999998500","usedPercent":"0.00",
  "imageCount":"2","trashCount":"1"}],"total":"3","limit":20,"offset":0}}
```

Una cuenta sin suscripción vigente devuelve `plan: null`, `availableBytes: null` y `usedPercent: null`; la interfaz debe mostrarlo como "sin plan", no como cero. `availableBytes` nunca es negativo; `usedPercent` puede superar 100 si las reservas exceden la capacidad tras un cambio de plan.

## Suscripciones y pagos (S4-02 y S4-03)

Las siguientes rutas están implementadas y requieren autenticación mediante JWT.

| Método | Ruta                             | Descripción                                   |
| ------ | -------------------------------- | --------------------------------------------- |
| GET    | `/api/subscriptions/me`          | Consulta el plan y la suscripción del usuario |
| POST   | `/api/subscriptions/checkout`    | Contrata un plan mediante pago simulado       |
| GET    | `/api/payments`                  | Consulta el historial de pagos del usuario    |
| POST   | `/api/subscriptions/renew`       | Renueva la suscripción por un mes calendario  |
| POST   | `/api/subscriptions/change-plan` | Permite subir o bajar de plan                 |

### Reglas de pagos

- Los pagos son simulados y pueden tener estado `approved`, `rejected` o `error`.
- Los precios se obtienen del catálogo de planes del servidor, en USD.
- Las solicitudes de pago utilizan la cabecera `Idempotency-Key` para evitar cobros duplicados.
- No se almacena el número completo de la tarjeta ni el CVV.
- El historial de pagos pertenece únicamente al usuario autenticado.

### Reglas de suscripciones

- Los planes de pago tienen vigencia de un mes calendario, calculado en horario de Guatemala.
- El plan Free no tiene fecha de vencimiento.
- Renovar una suscripción extiende su vencimiento un mes calendario.
- Subir de plan requiere un pago simulado y activa inmediatamente el nuevo plan.
- Bajar de plan no genera un nuevo cobro.
- Para bajar de plan, el almacenamiento utilizado más el reservado no puede superar la capacidad del nuevo plan.
- Si supera esa capacidad, el sistema responde `409 PLAN_CAPACITY_EXCEEDED`.
- Cuando vence una suscripción de pago, se aplican los límites del plan Free sin eliminar las imágenes almacenadas.
- Las operaciones de suscripción utilizan transacciones y bloqueos por usuario para coordinar solicitudes simultáneas.

### Contratar un plan (S4-02)

**Endpoint:** `POST /api/subscriptions/checkout`

Requiere autenticación JWT y una clave de idempotencia.

**Cabeceras:**

```http
Authorization: Bearer TOKEN_JWT
Content-Type: application/json
Idempotency-Key: clave-unica-de-la-solicitud
```

**Ejemplo de solicitud:**

```json
{
  "planCode": "standard",
  "card": {
    "number": "4242424242424242"
  }
}
```

**Resultado esperado:**

- `201 Created`: solicitud de pago procesada.
- `approved`: el pago fue aprobado y se activa el plan Standard.
- `rejected`: el pago fue rechazado y no se cambia la suscripción.
- `error`: ocurrió un error simulado en el pago y no se cambia la suscripción.

El precio del plan Standard es de USD 8.00 mensuales y se obtiene del catálogo del servidor.

Repetir una solicitud con la misma clave de idempotencia y los mismos datos no debe generar otro pago.

### Renovación de suscripción (S4-03)

**Endpoint:** `POST /api/subscriptions/renew`

Permite renovar una suscripción mediante un pago simulado.

**Cabeceras:**

- `Authorization: Bearer TOKEN_JWT`
- `Content-Type: application/json`
- `Idempotency-Key: clave-unica`

**Ejemplo de solicitud:**

```json
{
  "card": {
    "number": "4242424242424242"
  }
}
```

**Reglas:**

- El importe se obtiene del plan contratado.
- Si el pago es aprobado, el vencimiento se extiende un mes calendario en horario de Guatemala.
- Un pago rechazado o con error no debe extender la suscripción.
- Repetir la misma solicitud con la misma clave no debe generar otro pago ni extender nuevamente la fecha.

### Cambio de plan (S4-03)

**Endpoint:** `POST /api/subscriptions/change-plan`

Permite cambiar el plan de la cuenta autenticada.

**Ejemplo para subir de Standard a Pro:**

```json
{
  "planCode": "pro",
  "card": {
    "number": "4242424242424242"
  }
}
```

**Ejemplo para bajar de Pro a Standard:**

```json
{
  "planCode": "standard"
}
```

**Reglas:**

- Subir de plan requiere un pago simulado aprobado.
- El nuevo plan se activa inmediatamente después del pago.
- Bajar de plan no genera un cobro adicional.
- Si el espacio utilizado más el reservado supera la capacidad del nuevo plan, se devuelve `409 PLAN_CAPACITY_EXCEEDED`.
- Una solicitud repetida con la misma clave de idempotencia no debe generar pagos duplicados.
- Los cambios se realizan mediante transacciones y bloqueos por usuario.

### Vencimiento de suscripciones

Cuando vence una suscripción de pago, la API aplica los límites del plan Free sin eliminar las imágenes almacenadas.

El plan Free no tiene vencimiento. Si el almacenamiento existente supera su capacidad, no se permiten nuevas cargas que excedan los límites.

### Autenticación

Estas rutas privadas requieren un JWT válido. Las solicitudes sin autenticación responden `401`.

Únicamente con la demo local habilitada se admite `X-Storage-Demo-User` para las dos cuentas reservadas. `npm run dev:demo` la activa en el proceso; no permite cuentas arbitrarias ni habilita las rutas de Auth o Suscripciones. El cliente elige una cuenta explícitamente. Ver [límites de la demo](storage.md).

## Contrato de identidad integrado

El cliente envía `Authorization: Bearer <token>`. El middleware verifica firma, expiración, revocación y estado del usuario. Solo entonces asigna:

```js
req.user = { id: "UUID", email: "cliente@example.test", role: "client" };
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
