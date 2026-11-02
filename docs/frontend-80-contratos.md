# Contratos de la API para el frontend

Guía para mantener las pantallas (responsable: Alegría). Todo lo de aquí **está implementado** y conectado a la interfaz. Base `/api`, JSON UTF-8, éxito `{ "data": ... }`, error `{ "error": { "code", "message", "details"? } }`.
Los bytes viajan como **strings** decimales (1 GB = 1 000 000 000 bytes) y los precios como string con dos decimales
(`"8.00"`). Fechas en ISO 8601 UTC; muéstralas en hora de Guatemala (`America/Guatemala`).
Permisos por ruta: [permisos-api.md](permisos-api.md). Detalle de autenticación y usuarios: [auth-frontend.md](auth-frontend.md).

## Reglas para toda pantalla

- Con `401` cierra la sesión. Con `403` en una ruta `/admin/*` oculta la opción; no es un error de red.
- **Nunca muestres ceros cuando la API falla**: muestra el estado de error con opción de reintentar.
- Mientras carga, usa los esqueletos de `components/Skeletons.jsx`; ver [estilos](estilos.md#estados-de-carga).
- No guardes tokens ni datos de tarjeta en `localStorage`. No envíes precios desde la interfaz: los fija el servidor.
- Las tres paginaciones del backend son distintas; no las mezcles:

| Endpoint | Parámetros | Respuesta |
| --- | --- | --- |
| `GET /payments` | `page` (desde 1), `limit` (1–100, def. 10) | `{ payments, pagination: { page, limit, total, totalPages } }` (`total` es número) |
| `GET /admin/users` | `q`, `status`, `page`, `pageSize` (1–100, def. 20) | `{ items, total, page, pageSize }` (`total` es número) |
| `GET /admin/subscriptions`, `/usage`, `/jobs`, `/audit-events` | `limit` (1–100, def. 20), `offset` | `{ items, total, limit, offset }` (`total` es **string**) |
| `GET /files`, `GET /jobs` | `limit`, `cursor` | `{ items, nextCursor }` (cursor opaco) |

## S4-06 Planes, contratación e historial

### Planes — `GET /plans` (público)

Cuatro planes en USD: `free`, `standard`, `pro`, `enterprise`. Campos útiles: `code`, `name`, `capacityBytes`,
`dailyUploadLimit` (`null` = sin límite), `dailyBytesLimit` (`null` = sin límite), `monthlyPrice`, `currency`,
`billingPeriod` (`none` o `calendar_month`), `pricingModel`, `storagePricePerGbMonth` y `includedStorageBytes`
(Enterprise: US$0.20 por GB-mes adicional sobre 200 GB incluidos). Ignora `monthlyPriceGtq`: es heredado.

### Plan activo — `GET /subscriptions/me`

```json
{ "data": { "id": "…", "status": "active", "startedAt": "2026-10-22T22:38:30.633Z", "expiresAt": "2026-11-22T22:38:30.633Z",
  "plan": { "id": "…", "code": "standard", "name": "Estándar", "capacityBytes": "25000000000",
            "dailyUploadLimit": null, "dailyBytesLimit": "500000000", "monthlyPrice": "8.00", "currency": "USD",
            "billingPeriod": "calendar_month" } } }
```

`expiresAt: null` en Free. Si una suscripción de pago venció, la API responde con el plan **Free** y no borra imágenes.

### Contratar — `POST /subscriptions/checkout`

Cabecera obligatoria `Idempotency-Key` (8–120 caracteres `a-zA-Z0-9_-`; genera un UUID **por intento de pago** y reutilízalo solo
si reintentas el mismo intento). Cuerpo: `{ "planCode": "pro", "card": { "number": "4242424242424242" } }`. El precio lo decide
el servidor: no lo envíes.

| Tarjeta de prueba | Resultado |
| --- | --- |
| `4242424242424242` | `approved` |
| `4000000000000002` | `rejected` |
| `4000000000000119` | `error` |

`201` (o `200` si es un reintento con la misma clave, `repeated: true`) incluso cuando el pago es rechazado: **mira `payment.status`**.

```json
{ "data": { "payment": { "id": "…", "status": "approved", "amount": "8.00", "currency": "USD", "reference": "…" },
            "subscription": { "id": "…", "status": "active", "startedAt": "…", "expiresAt": "…" }, "repeated": false } }
```

`subscription` es `null` si el pago no fue aprobado. Si se aprueba, el servidor envía la factura al correo de la cuenta después de responder; la interfaz no debe esperarla. Errores: `400 INVALID_CARD`, `INVALID_TEST_CARD`, `INVALID_IDEMPOTENCY_KEY`,
`INVALID_PLAN`; `409 IDEMPOTENCY_CONFLICT` (misma clave con otro plan o tarjeta). Nunca pidas ni muestres CVV ni el número completo.

### Renovar — `POST /subscriptions/renew`

Cuerpo `{ "card": { "number": "…" } }` + `Idempotency-Key`. Respuesta igual que el checkout (`payment`, `subscription`, `repeated`):
al aprobarse, `expiresAt` avanza un mes calendario. Free no se renueva: `400 SUBSCRIPTION_NOT_RENEWABLE` (oculta el botón en ese plan).

### Cambiar de plan — `POST /subscriptions/change-plan`

Responde siempre `200`, también al subir con un pago rechazado: mira `payment.status`.

- **Subir:** `{ "planCode": "pro", "card": { … } }` + `Idempotency-Key`. Respuesta: `{ changeType: "upgrade", previousPlan, newPlan, payment, subscription, repeated }`. Si el pago no se aprueba, `subscription` es `null`.
- **Bajar:** `{ "planCode": "standard" }` (sin tarjeta, sin cobro). Respuesta: `{ changeType: "downgrade", previousPlan, newPlan, subscription }`.
- **Bajar con más consumo que la capacidad nueva:** `409 PLAN_CAPACITY_EXCEEDED` con el dato exacto para tu alerta (RF-PAG-05):

```json
{ "error": { "code": "PLAN_CAPACITY_EXCEEDED",
  "message": "El almacenamiento utilizado y reservado (3.00 GB (3000000000 bytes)) supera la capacidad del nuevo plan (2.00 GB (2000000000 bytes)). Libera al menos 1.00 GB (1000000000 bytes) antes de cambiar de plan.",
  "details": { "capacityBytes": "2000000000", "usedBytes": "2500000000", "reservedBytes": "500000000", "bytesToFree": "1000000000" } } }
```

Muestra `details.bytesToFree` formateado ("Libera al menos 1 GB") y bloquea el botón de confirmar. La papelera cuenta como espacio usado hasta borrar de forma definitiva.
Otros errores: `409 SAME_PLAN`, `400 INVALID_PLAN`, `404 PLAN_NOT_FOUND`.

### Historial de pagos — `GET /payments?page=1&limit=10`

```json
{ "data": { "payments": [ { "id": "…", "planId": "…", "planCode": "pro", "planName": "Pro", "amount": "15.00", "currency": "USD",
    "status": "approved", "cardLast4": "4242", "reference": "…", "createdAt": "2026-10-22T22:38:30.672Z" } ],
  "pagination": { "page": 1, "limit": 10, "total": 4, "totalPages": 1 } } }
```

Columnas: fecha, concepto (`planName`), monto, estado, tarjeta `•••• cardLast4`, factura. `status` ∈ `approved` (Pagado), `rejected`, `error`.

### Facturas PDF (RF-PAG-03)

La interfaz aún rotula estos botones como «Recibo»; el PDF se titula «Factura» y se llama `factura-<referencia>.pdf`. Las rutas conservan `receipt`.

- `GET /payments/:paymentId/receipt` → PDF de un pago **aprobado** propio. `409 RECEIPT_NOT_AVAILABLE` si fue rechazado o con error; `404 PAYMENT_NOT_FOUND`.
- `GET /payments/receipts` → un PDF con una página por pago aprobado. `404 NO_RECEIPTS` si no hay ninguno (deshabilita el botón).

Son descargas autenticadas: usa `fetch` con el header `Authorization`, convierte a `blob` y dispara la descarga (un `<a href>` directo no envía el token).
El nombre sugerido viene en `Content-Disposition`.

### Después de pagar

Vuelve a pedir `GET /subscriptions/me` y `GET /quotas/me` (y `GET /payments` si la tabla está visible).

## Consumo y ahorro del cliente (RF-STO-12, RF-PAG-04)

### `GET /quotas/me`

```json
{ "data": { "plan": { "code": "free", "name": "Free" }, "capacityBytes": "2000000000", "usedBytes": "0", "reservedBytes": "0",
  "availableBytes": "2000000000",
  "daily": { "date": "2026-10-22", "uploadLimit": 10, "uploadsUsed": "0", "uploadsReserved": "0",
             "bytesLimit": "200000000", "bytesUsed": "0", "bytesReserved": "0" } } }
```

`usedBytes` es el espacio **lógico** (originales, incluida la papelera); `uploadLimit`/`bytesLimit` en `null` significan sin límite.

### `GET /files/summary` (nuevo)

Compara lo contratado/lógico con lo físico real y da el ahorro acumulado:

```json
{ "data": { "logicalBytes": "7438", "physicalBytes": "1210", "savedBytes": "6228", "savedPercent": "83.73",
  "imageCount": "2", "trashCount": "1", "uniqueObjectCount": "2", "duplicateCount": "1", "unavailableObjectCount": "0" } }
```

- Gráfica "lógico vs físico": `logicalBytes` frente a `physicalBytes`; "contratado" es `capacityBytes` de `/quotas/me`.
- `duplicateCount`: referencias repetidas dentro de la misma cuenta (ahorradas por deduplicación).
- `savedPercent` es `null` y `unavailableObjectCount > 0` si falta algún archivo en disco: muestra "no disponible", no un porcentaje inventado.
- Biblioteca vacía: todo en `"0"` y `savedPercent: "0.00"`. `savedPercent` puede ser negativo (el WebP pesó más que el original).

### Galería y detalle — `GET /files`

Cada imagen ahora incluye, además de lo anterior: `hashPrefix` (primeros 12 caracteres del SHA-256; **no existe el hash completo en la API**),
`optimizedFormat` (`"webp"`) y `duplicate` (`true` si la misma cuenta tiene otra imagen con el mismo contenido).
Estados de galería (RF-STO-10): "procesando" sale de `GET /jobs` (`queued`/`processing`), "optimizada" es una imagen con `status: "ready"`,
"duplicada" es `duplicate: true`. `unavailableItems` lista imágenes cuyo archivo falta (`STORAGE_INTEGRITY_ERROR`).

## Subidas, álbumes y papelera

Las rutas están en [api.md](api.md#álbumes-movimiento-y-papelera). Reglas que deben conservarse al cambiar el diseño:

- `POST /jobs` responde `202`: confirma admisión y reserva, no que la imagen esté lista. Muestra una imagen como disponible solo con `status === 'published' && available && imageId`.
- La cola (`features/storage/library.jsx`) envía hasta tres archivos a la vez, respeta `nextPollAfterMs` y cancela consultas al cerrar sesión. Cambiar de sección no interrumpe los procesos.
- Si se pierde la respuesta de admisión, reenvía con el mismo UUID. Un trabajo definitivamente fallido se vuelve a subir con una clave nueva.
- Refresca `GET /quotas/me` al admitir, publicar, fallar, restaurar o borrar. Si la consulta falla, muestra el error; no aparentes cuota cero.
- Retira imágenes de la vista solo tras una operación exitosa. La confirmación del borrado definitivo debe permanecer.
- En papelera no se puede descargar ni mover. Eliminar un álbum conserva sus imágenes, y eliminar una imagen no afecta a otras cuentas.

Antes de entregar cambios de interfaz: `npm run check`, `npm run test:frontend` y `npm run test:organization-browser`, y revisa escritorio, móvil y ambos temas.

## S4-07 Administración, usuarios y perfil

Todas requieren `role: "admin"` (si no, `403`). Muestra el menú solo si `user.role === 'admin'`.

| Pantalla | Endpoint | Qué muestra |
| --- | --- | --- |
| Resumen | `GET /admin/summary` | Cuentas, planes con suscripciones vigentes, almacenamiento lógico/único/deduplicado, trabajos por estado |
| Ahorro global | `GET /admin/storage/stats` | Tamaño original, único y WebP, `savedPercent` |
| Suscripciones | `GET /admin/subscriptions?status=&plan=&search=&limit=&offset=` | Usuario, plan, inicio, vencimiento, `current` |
| Consumo por cuenta | `GET /admin/usage?plan=&search=&limit=&offset=` | Usado, reservado, disponible, `usedPercent`; `plan: null` = "sin plan" |
| Cola de procesamiento | `GET /admin/jobs?status=&userId=&limit=&offset=` | Ver abajo |
| Usuarios | `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/status` | Búsqueda, detalle, activar/desactivar (no a sí mismo) |
| Bitácora | `GET /admin/audit-events?type=&userId=&search=&limit=&offset=` | Ver abajo |
| Perfil (cliente) | `GET` y `PATCH /auth/me` | Solo se edita `name`; el correo es de solo lectura |

Los formatos de resumen, suscripciones y consumo están en [api.md](api.md#consultas-administrativas-s4-04). Los de usuarios, en [auth-frontend.md](auth-frontend.md).

### Cola de procesamiento — `GET /admin/jobs` (RF-STO-14)

```json
{ "data": { "items": [ { "id": "…", "status": "queued", "retrying": false, "attempts": 0, "errorCode": null,
  "originalName": "foto.png", "originalSizeBytes": "3719", "sharedObject": true, "imageId": null,
  "createdAt": "…", "updatedAt": "…", "convertedAt": null,
  "user": { "id": "…", "name": "Ana", "email": "ana@ejemplo.com", "active": true } } ],
  "total": "3", "limit": 20, "offset": 0 } }
```

`status` ∈ `queued` (pendiente), `processing` (procesando), `converted`, `published` (listo), `failed` (error). `retrying: true` = ya hubo intentos y sigue sin terminar.
`sharedObject: true` = otra imagen ya tenía ese contenido (deduplicación). Filtros inválidos: `400 INVALID_ADMIN_QUERY`.

### Bitácora — `GET /admin/audit-events` (RF-AUT-12)

```json
{ "data": { "items": [ { "id": "12", "type": "login_failed", "userId": "…", "actorId": null, "email": "ana@ejemplo.com",
  "detail": { "reason": "invalid_credentials" }, "ipAddress": "::1", "userAgent": "Mozilla/5.0 …", "createdAt": "…" } ],
  "total": "3", "limit": 20, "offset": 0 } }
```

`type` ∈ `login_success`, `login_failed`, `logout`, `password_changed`, `password_reset`, `account_status_changed`.
`detail.reason` en `login_failed`: `invalid_credentials`, `locked`, `account_disabled`, `email_not_verified`. En `account_status_changed`: `detail.active` y `actorId` es el administrador que lo hizo.
Filtros: `type`, `userId` (cuenta afectada o actor) y `search` (correo). Errores: `400 INVALID_AUDIT_QUERY`. Nunca contiene contraseñas ni tokens.

## Cuentas y datos para probar

Promueve una cuenta a administrador en la base: `UPDATE users SET role='admin' WHERE email='tu@correo';` y vuelve a iniciar sesión.
Usa solo las tarjetas de prueba de la tabla; el pago es simulado.
