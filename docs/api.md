# Contratos de API

Base: `/api`. JSON UTF-8. Éxito: `{ "data": ... }`. Error: `{ "error": { "code": "CODIGO", "message": "Mensaje" } }`. No se devuelven trazas internas ni hashes de contraseña.

## Operaciones disponibles

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/health` | `200`, `{ "data": { "status": "ok", "service": "smartstorage-api" } }` |
| GET | `/ready` | `200` con BD conectada; `503 DATABASE_UNAVAILABLE` si falta configuración o conexión |
| GET | `/plans` | `200`, catálogo activo de PostgreSQL; requiere migraciones. El seed incluye únicamente Free |
| POST | `/auth/register` | `201`, crea usuario cliente y suscripción Free de forma atómica; no inicia sesión |
| POST | `/auth/login` | `200`, `{ data: { token, expiresAt, user } }` |
| GET | `/auth/me` | `200`, `{ data: user }`; requiere Bearer JWT |
| POST | `/auth/logout` | `200`, `{ data: { loggedOut: true } }`; revoca el JWT actual |
| GET | `/dev/storage-demo` | `200`, `{ data: { enabled, accounts } }`; apagada no devuelve identidades |
| GET | `/files` | `200`, listado paginado privado; necesita autenticación o demo local explícita |
| POST | `/files` | `201`, recibe una imagen y confirma cuando el WebP está listo |
| GET | `/files/:fileId/download` | `200`, descarga WebP del propietario; recurso ajeno o inexistente: `404` |
| GET | `/admin/storage/stats` | `200`, ahorro global calculado; requiere rol `admin` |

Los tamaños BIGINT y precios NUMERIC del catálogo viajan como strings decimales para no perder precisión. Los contadores diarios limitados son enteros o `null`.

El login devuelve el campo **`token`**, no `accessToken`. El frontend lo envía con `Authorization: Bearer <token>` en las rutas privadas. `GET /auth/me` devuelve el usuario directamente dentro de `data`, no `{ data: { user } }`. Ver [contrato detallado de autenticación](auth-frontend.md) y [traspaso al frontend](frontend-handoff.md).

## Storage

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

`GET /files?limit=20&cursor=...` devuelve `{ data: { items: [/* imágenes con ese formato */], nextCursor: null } }`. Para continuar, enviar el cursor recibido sin interpretarlo. El orden es descendente por fecha e ID; `nextCursor` es una cadena mientras queden resultados. La biblioteca vacía devuelve `items: []`.

`GET /files/:fileId/download` devuelve `image/webp` con `Content-Disposition: attachment`. Requiere las mismas credenciales que el listado; un hash o ruta física no sirve como credencial. El frontend obtiene un blob mediante su cliente autorizado, sin publicar el directorio de archivos.

Errores relevantes: `400` archivo faltante/vacío/corrupto o paginación inválida; `413 FILE_TOO_LARGE`; `415` formato o animación no admitidos; `403` capacidad o suscripción no válida; `429` cualquiera de los límites diarios; `503 STORAGE_INTEGRITY_ERROR` si falta un objeto que la BD declara disponible.

`GET /admin/storage/stats` devuelve strings decimales: `originalSizeBytes` (B), `uniqueOriginalSizeBytes` (U), `optimizedSizeBytes` (P), `savedBytes` (B−P), `savedPercent`, `imageCount` y `objectCount`. Biblioteca vacía: ceros y `savedPercent: "0.00"`. Incluye cada objeto físico una sola vez y puede informar ahorro negativo. Las cuentas demo son clientes, no administradores.

## Rutas aún pendientes (501)

| Método | Ruta | Contrato previsto |
| --- | --- | --- |
| POST | `/auth/verify-email` | `{ token }`; consumir token de un solo uso |
| POST | `/auth/forgot-password` | `{ email }`; respuesta neutral sin revelar si existe la cuenta |
| POST | `/auth/reset-password` | `{ token, password }`; token de un solo uso |
| DELETE | `/files/:fileId` | Elimina el enlace lógico; solo se borra el WebP cuando no quedan referencias |
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

La revocación de sesiones ya tiene su migración `003_revoked_tokens.sql`. Verificación de correo y pagos siguen pendientes. Las cuotas actuales se derivan de `images`, serializando por usuario; antes del borrado se debe definir un consumo diario que no pueda reiniciarse eliminando imágenes.
