# Autenticación: guía de integración para el frontend

Qué necesita el frontend para usar lo que ya está implementado del módulo de usuarios y autenticación. Se actualiza al terminar cada bloque.

Convenciones generales (ya cubiertas por `apiRequest()` de `services/api.js`):

- Éxito: `{ "data": ... }`. Fallo: `{ "error": { "code": "...", "message": "..." } }`.
- `message` está en español y se puede mostrar tal cual al usuario. Usa `code` para la lógica.
- Las peticiones con cuerpo llevan `Content-Type: application/json`.
- La API en JSON usa camelCase.

## Estado por endpoint

| Endpoint | Estado |
| --- | --- |
| `POST /api/auth/register` | Implementado (Bloque 1) |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Implementado (Bloque 2) |
| `POST /api/auth/verify-email`, `forgot-password`, `reset-password` | Pendiente, responden `501 AUTH_NOT_IMPLEMENTED` |

Las rutas privadas de otros módulos (`/api/files`, `/api/subscriptions/me`) ya exigen el token: sin él responden `401`. Con un token válido, `/api/subscriptions/me` todavía responde `501 SUBSCRIPTIONS_NOT_IMPLEMENTED`.

## `POST /api/auth/register`

Crea una cuenta nueva con una suscripción Free activa en la misma operación de PostgreSQL. **No requiere token.** No inicia sesión: tras registrarse, el usuario debe iniciar sesión.

Cuerpo:

```json
{ "name": "Lany Pérez", "email": "lany@example.com", "password": "Clave#Segura1" }
```

- `name` y `email` se limpian en el servidor (espacios al inicio y al final; el correo se guarda en minúsculas).
- Los tres campos son obligatorios y deben ser texto.

Éxito: `201`

```json
{
  "data": {
    "id": "3f1c1c1e-0000-4000-8000-000000000001",
    "name": "Lany Pérez",
    "email": "lany@example.com",
    "role": "client",
    "active": true,
    "emailVerified": false,
    "createdAt": "2026-09-24T12:00:00.000Z"
  }
}
```

La respuesta nunca incluye la contraseña ni su hash. El rol inicial siempre es `client`; el rol no se puede enviar en el cuerpo.

### Errores

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta el nombre (o está vacío) | `El nombre es obligatorio.` |
| 400 | `VALIDATION_ERROR` | Nombre de más de 120 caracteres | `El nombre no puede superar 120 caracteres.` |
| 400 | `VALIDATION_ERROR` | Falta el correo | `El correo electrónico es obligatorio.` |
| 400 | `VALIDATION_ERROR` | Correo con formato inválido o de más de 254 caracteres | `El formato del correo electrónico no es válido.` |
| 400 | `VALIDATION_ERROR` | Falta la contraseña | `La contraseña es obligatoria.` |
| 400 | `VALIDATION_ERROR` | Contraseña de menos de 8 caracteres | `La contraseña debe tener al menos 8 caracteres.` |
| 400 | `VALIDATION_ERROR` | Contraseña de más de 128 caracteres | `La contraseña no puede superar 128 caracteres.` |
| 400 | `VALIDATION_ERROR` | Sin letra minúscula | `La contraseña debe incluir una letra minúscula.` |
| 400 | `VALIDATION_ERROR` | Sin letra mayúscula | `La contraseña debe incluir una letra mayúscula.` |
| 400 | `VALIDATION_ERROR` | Sin número | `La contraseña debe incluir un número.` |
| 400 | `VALIDATION_ERROR` | Sin símbolo | `La contraseña debe incluir un símbolo.` |
| 400 | `INVALID_JSON` | El cuerpo no es JSON válido | `El cuerpo JSON no es válido.` |
| 409 | `EMAIL_ALREADY_REGISTERED` | El correo ya tiene una cuenta | `El correo electrónico ya está registrado.` |
| 503 | `FREE_PLAN_UNAVAILABLE` | El plan Free no está activo o no se han aplicado las migraciones | `El plan Free no está disponible para registrar cuentas.` |
| 500 | `INTERNAL_ERROR` | Error inesperado | `Ocurrió un error interno.` |

Notas:

- Si hay varios problemas a la vez, la API devuelve **solo el primero** (en el orden de la tabla). Para una mejor experiencia, el frontend puede validar antes de enviar con las mismas reglas.
- El mensaje `VALIDATION_ERROR` no indica qué campo falló; si necesitas resaltar campos, se puede añadir después un campo `field` al error (avísame).

### Política de contraseñas

Debe cumplir todo esto: entre 8 y 128 caracteres, al menos una minúscula, una mayúscula, un número y un símbolo (cualquier carácter que no sea letra, número ni espacio). Conviene mostrarla en el formulario antes de enviar.

## Cómo se envía el token

Tras iniciar sesión, guarda `token` y envíalo en **todas** las peticiones privadas:

```
Authorization: Bearer <token>
```

- El token dura lo que indique `expiresAt` (por defecto 1 hora). No hay renovación: al vencer, hay que iniciar sesión de nuevo.
- Ante cualquier `401` en una ruta privada (`AUTH_REQUIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`), borra el token guardado y lleva al usuario a `/login`.
- El rol (`client` o `admin`) sale del servidor en cada petición. Para decidir qué mostrar, usa `user.role` de la respuesta de login o de `GET /api/auth/me`.
- `apiRequest()` de `services/api.js` acepta la opción `token` y envía el encabezado Bearer. La pantalla de login todavía debe guardar la sesión y pasar `{ user, accessToken: token }` a `StoragePage`.

## `POST /api/auth/login`

Inicia sesión. **No requiere token.**

Cuerpo:

```json
{ "email": "lany@example.com", "password": "Clave#Segura1" }
```

El correo se limpia igual que en el registro (espacios y mayúsculas no importan).

Éxito: `200`

```json
{
  "data": {
    "token": "eyJhbGciOi...",
    "expiresAt": "2026-09-24T13:00:00.000Z",
    "user": {
      "id": "3f1c1c1e-0000-4000-8000-000000000001",
      "name": "Lany Pérez",
      "email": "lany@example.com",
      "role": "client",
      "active": true,
      "emailVerified": false,
      "createdAt": "2026-09-24T12:00:00.000Z"
    }
  }
}
```

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta el correo o la contraseña | `El correo electrónico y la contraseña son obligatorios.` |
| 401 | `INVALID_CREDENTIALS` | Contraseña incorrecta **o** correo inexistente (misma respuesta a propósito) | `Correo electrónico o contraseña incorrectos.` |
| 403 | `ACCOUNT_DISABLED` | Contraseña correcta pero la cuenta está desactivada | `Tu cuenta está desactivada. Contacta al administrador.` |
| 429 | `TOO_MANY_ATTEMPTS` | 5 intentos fallidos seguidos con ese correo | `Demasiados intentos fallidos. Inténtalo de nuevo en N minutos.` |
| 503 | `AUTH_NOT_CONFIGURED` | El servidor no tiene `JWT_SECRET` | `La autenticación no está configurada en el servidor (falta JWT_SECRET).` |

Límite de intentos: tras 5 fallos con el mismo correo, ese correo queda bloqueado 15 minutos (aunque luego se escriba la contraseña correcta). Un inicio de sesión correcto reinicia el contador. Muestra el `message` tal cual: ya incluye el tiempo restante.

## `POST /api/auth/logout`

Cierra la sesión: el token deja de valer en el servidor. **Requiere token.** Sin cuerpo.

Éxito: `200`

```json
{ "data": { "loggedOut": true } }
```

Después, borra el token del cliente. Si se reutiliza, responde `401 TOKEN_INVALID`. Otras sesiones del mismo usuario (otros dispositivos) siguen activas.

## `GET /api/auth/me`

Devuelve el usuario de la sesión actual. **Requiere token.** Útil para restaurar la sesión al recargar la página.

Éxito: `200`, con el mismo objeto `user` que devuelve el login dentro de `data`:

```json
{ "data": { "id": "...", "name": "Lany Pérez", "email": "lany@example.com", "role": "client", "active": true, "emailVerified": false, "createdAt": "2026-09-24T12:00:00.000Z" } }
```

## Errores de cualquier ruta privada

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 401 | `AUTH_REQUIRED` | No se envió el encabezado `Authorization: Bearer ...` | `Debes iniciar sesión para acceder a este recurso.` |
| 401 | `TOKEN_INVALID` | Token falso, alterado, cerrado con logout o de un usuario que ya no existe | `La sesión no es válida. Inicia sesión de nuevo.` |
| 401 | `TOKEN_EXPIRED` | Token vencido | `La sesión expiró. Inicia sesión de nuevo.` |
| 403 | `ACCOUNT_DISABLED` | La cuenta se desactivó con la sesión abierta | `Tu cuenta está desactivada. Contacta al administrador.` |
| 403 | `FORBIDDEN` | El rol no tiene permiso (rutas de administrador) | `No tienes permiso para realizar esta acción.` |

## Cuenta activa o desactivada

Toda cuenta nueva se crea con `active: true`. Una cuenta desactivada no puede iniciar sesión (`403 ACCOUNT_DISABLED`) y su token deja de funcionar. La activación y desactivación desde el panel de administración llega en el Bloque 4.
