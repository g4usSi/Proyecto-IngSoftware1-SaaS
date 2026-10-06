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
| `POST /api/auth/forgot-password`, `reset-password` | Implementado (Bloque 3) |
| `POST /api/auth/change-password` | Implementado (Bloque 3) |
| `POST /api/auth/verify-email`, `resend-verification` | Implementado. El login exige el correo verificado |

Correos: con las variables `SMTP_*` configuradas en `backend/.env` (Brevo), se envían de verdad. Sin ellas, en desarrollo, el enlace se escribe en la consola del servidor (la terminal de `npm run dev`). El contrato de la API es el mismo en ambos casos.

Pantallas que necesita el frontend:

- `/verify-email?token=...`: al abrirse, llama a `POST /api/auth/verify-email` con el `token` de la URL y muestra el resultado.
- `/forgot-password`: formulario con el correo que llama a `POST /api/auth/forgot-password` y muestra siempre el mismo aviso neutral (el `message` de la respuesta). El login debe tener un enlace "¿Olvidaste tu contraseña?" hacia esta pantalla.
- `/reset-password?token=...`: formulario de nueva contraseña que llama a `POST /api/auth/reset-password`.
- En el login, ante `403 EMAIL_NOT_VERIFIED`, ofrecer "Reenviar correo de verificación" (`POST /api/auth/resend-verification`).
- Tras registrarse, avisar al usuario que revise su correo antes de iniciar sesión.
- Dentro de la sesión (por ejemplo, en el menú de la cuenta): formulario "Cambiar contraseña" con la contraseña actual y la nueva, que llama a `POST /api/auth/change-password`.

Las rutas privadas de otros módulos (`/api/files`, `/api/subscriptions/me`) ya exigen el token: sin él responden `401`. Con un token válido, `/api/subscriptions/me` todavía responde `501 SUBSCRIPTIONS_NOT_IMPLEMENTED`.

## `POST /api/auth/register`

Crea una cuenta nueva con una suscripción Free activa en la misma operación de PostgreSQL. **No requiere token.** No inicia sesión. Envía un correo con el enlace de verificación: el usuario debe verificar su correo antes de poder iniciar sesión. Si el envío falla, la cuenta se crea igual y el usuario puede pedir el reenvío.

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
| 403 | `EMAIL_NOT_VERIFIED` | Contraseña correcta pero el correo no está verificado | `Debes verificar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.` |
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

## `POST /api/auth/forgot-password`

Solicita la recuperación de contraseña. **No requiere token.**

Cuerpo:

```json
{ "email": "lany@example.com" }
```

Éxito: siempre `200`, exista o no la cuenta (para no revelar qué correos están registrados):

```json
{ "data": { "message": "Si el correo está registrado, se enviaron instrucciones para restablecer la contraseña." } }
```

Ese `message` se puede mostrar tal cual al usuario. La respuesta no espera al envío del correo y no cambia si el envío falla: no hay un caso de error que el frontend deba distinguir.

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta el correo | `El correo electrónico es obligatorio.` |

El correo contiene un enlace `FRONTEND_URL/reset-password?token=...` que vence en **1 hora**. El frontend debe tener una ruta `/reset-password` que lea `token` de la query string y lo use al llamar a `reset-password`.

## `POST /api/auth/reset-password`

Establece una nueva contraseña usando el token recibido por correo (de un solo uso). **No requiere token de sesión** (Bearer); usa en su lugar el `token` de recuperación en el cuerpo.

Cuerpo:

```json
{ "token": "…64 caracteres hexadecimales…", "password": "Clave#Segura1" }
```

La contraseña nueva debe cumplir la misma política que en el registro (ver arriba).

Éxito: `200`

```json
{ "data": { "reset": true } }
```

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta el token o la contraseña, o la contraseña no cumple la política | (el primer problema encontrado, mismos mensajes que en registro) |
| 400 | `RESET_TOKEN_INVALID` | El token no existe, ya se usó o venció (misma respuesta para los tres casos, a propósito) | `El enlace de recuperación no es válido o expiró.` |

Tras un reset exitoso, ese token y cualquier otro enlace de recuperación pendiente de la misma cuenta quedan invalidados. El enlace sirve una sola vez aunque lleguen dos envíos al mismo tiempo (por ejemplo, un doble clic): uno responde `200` y el otro `400 RESET_TOKEN_INVALID`, así que conviene desactivar el botón mientras la petición está en curso. Las sesiones (tokens Bearer) que ya existían **no** se cierran automáticamente; si se necesita ese comportamiento, avisar para agregarlo.

## `POST /api/auth/change-password`

Cambia la contraseña del usuario de la sesión actual. **Requiere token** (`Authorization: Bearer <token>`). El usuario se toma del token, nunca del cuerpo.

Cuerpo:

```json
{ "currentPassword": "Clave#Segura1", "newPassword": "OtraClave#9" }
```

La nueva contraseña debe cumplir la misma política que en el registro y ser distinta de la actual.

Éxito: `200`

```json
{ "data": { "changed": true } }
```

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta la contraseña actual | `La contraseña actual es obligatoria.` |
| 400 | `VALIDATION_ERROR` | Falta la nueva contraseña | `La nueva contraseña es obligatoria.` |
| 400 | `VALIDATION_ERROR` | La nueva no cumple la política | (el primer problema encontrado, mismos mensajes que en registro) |
| 400 | `VALIDATION_ERROR` | La nueva es igual a la actual | `La nueva contraseña debe ser distinta de la actual.` |
| 400 | `INVALID_CURRENT_PASSWORD` | La contraseña actual es incorrecta | `La contraseña actual es incorrecta.` |
| 429 | `TOO_MANY_ATTEMPTS` | 5 intentos fallidos seguidos | `Demasiados intentos fallidos. Inténtalo de nuevo en N minutos.` |
| 401/403 | (ver "Errores de cualquier ruta privada") | Sin token, token inválido o vencido, cuenta desactivada | |

Notas:

- `INVALID_CURRENT_PASSWORD` es un **400 a propósito**: no borres la sesión ni redirijas al login; muestra el mensaje junto al campo de la contraseña actual.
- El límite de intentos es el mismo que el del login y es por cuenta: 5 fallos aquí también bloquean el inicio de sesión durante 15 minutos, y al revés.
- La sesión actual y las de otros dispositivos **siguen abiertas** tras el cambio. Los enlaces de recuperación pendientes de la cuenta dejan de servir.
- Desactiva el botón mientras la petición está en curso: si llegan dos cambios a la vez, solo se aplica uno y el otro recibe `INVALID_CURRENT_PASSWORD`.

## `POST /api/auth/verify-email`

Verifica el correo con el token del enlace recibido. **No requiere token de sesión.**

Cuerpo:

```json
{ "token": "…64 caracteres hexadecimales…" }
```

Éxito: `200`

```json
{ "data": { "verified": true } }
```

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta el token | `El token de verificación es obligatorio.` |
| 400 | `VERIFICATION_TOKEN_INVALID` | El token no existe, ya se usó o venció (misma respuesta a propósito) | `El enlace de verificación no es válido o expiró.` |

El enlace vence en **24 horas** y sirve una sola vez. Si el usuario abre el enlace de nuevo después de verificar, recibe `VERIFICATION_TOKEN_INVALID`; conviene que esa pantalla ofrezca ir al login además de reenviar el correo.

## `POST /api/auth/resend-verification`

Envía un nuevo enlace de verificación. El enlace anterior deja de servir. **No requiere token.**

Cuerpo:

```json
{ "email": "lany@example.com" }
```

Éxito: siempre `200`, exista o no la cuenta y esté o no verificada:

```json
{ "data": { "message": "Si el correo está registrado y aún no está verificado, se envió un nuevo enlace de verificación." } }
```

| Estado | `code` | Cuándo | Mensaje |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falta el correo | `El correo electrónico es obligatorio.` |

## Cuenta activa o desactivada

Toda cuenta nueva se crea con `active: true`. Una cuenta desactivada no puede iniciar sesión (`403 ACCOUNT_DISABLED`) y su token deja de funcionar. La activación y desactivación desde el panel de administración llega en el Bloque 4.
