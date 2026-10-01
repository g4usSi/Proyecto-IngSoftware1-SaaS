# Traspaso a Alegría: integrar la interfaz de SmartStorage

> Esta guía se escribió antes del commit `9c29060`, que integró el nuevo frontend. La tabla de archivos describe el punto de partida de esa tarea; los contratos y criterios de comprobación siguen siendo la referencia. Para el estado actual, consulta el código de `frontend/src/` y el README principal.

Trabajar desde `tema-y-flujo-git`. Esta rama contiene el backend de usuarios/autenticación y Storage, además de la demo local de subida. Al redactar esta guía faltaba conectar la sesión real con las pantallas existentes y adaptar el diseño. Los contratos completos están en [auth-frontend.md](auth-frontend.md), [api.md](api.md) y [storage.md](storage.md).

## Estado que encontrarás

| Archivo | Situación actual | Punto de integración |
| --- | --- | --- |
| `frontend/src/features/auth/AuthPage.jsx` | Formulario visual deshabilitado, sin peticiones | Habilitar registro y login, estados de carga y errores. |
| `frontend/src/app/App.jsx` | Monta `<StoragePage />` sin sesión | Proporcionar la sesión real a Storage y definir la navegación tras login/logout. |
| `frontend/src/features/storage/StoragePage.jsx` | Subida, galería y descarga ya funcionan con demo; acepta `session` | Pasar `{ user, accessToken: token }`. Si existe esa sesión, usa JWT en vez de la cuenta demo. |
| `frontend/src/services/api.js` | `apiRequest` y `apiBlobRequest` envían `Authorization` si reciben `{ token }`; lanzan `ApiError` | Reutilizar estas funciones y manejar `error.status`/`error.code`. No duplicar el cliente HTTP. |
| `frontend/src/features/subscriptions/PlansPage.jsx` | Consulta el catálogo Free; botones y texto de contratación siguen pendientes | Ajustar el texto al registro Free real; no presentar pagos como operativos. |
| `frontend/src/styles/theme.css` y CSS de cada feature | Estilos separados por tema y módulo | Cambiar colores y composición sin modificar las respuestas de API. |

## Recorrido real que debe funcionar

1. `POST /api/auth/register` con `{ name, email, password }` crea un usuario `client` y su suscripción Free; responde el **usuario** en `data`, sin iniciar sesión.
2. `POST /api/auth/login` con `{ email, password }` responde `{ data: { token, expiresAt, user } }`.
3. Una petición privada envía `Authorization: Bearer <token>`. `GET /api/auth/me` responde `{ data: user }` y permite comprobar la sesión vigente.
4. `StoragePage` recibe `session={{ user, accessToken: token }}`. Su cliente ya incluye el JWT en listado, subida y descarga. El usuario solo ve sus propias referencias, aunque el WebP físico se comparta por deduplicación.
5. `POST /api/auth/logout` con el JWT responde `{ data: { loggedOut: true } }`; después debe limpiarse el estado de sesión del frontend. Ese token deja de ser válido.

El backend **no** entrega `accessToken` ni `expiresIn`: entrega `token` y `expiresAt`. El frontend hace la adaptación de nombre al pasar la prop de Storage. No se envía `userId` como prueba de identidad. La API responde `{ data: ... }` en éxito o `{ error: { code, message } }` en fallo; `apiRequest()` ya devuelve el contenido de `data`.

## Estados y límites a representar

- Ante `401` de una ruta privada, limpiar la sesión y ofrecer el login. Una cuenta desactivada responde `403 ACCOUNT_DISABLED`; intentos repetidos pueden responder `429 TOO_MANY_ATTEMPTS`.
- El token dura hasta `expiresAt` (por defecto una hora). No existe renovación automática. La política de persistencia del token entre recargas debe acordarse con el equipo antes de implementarla; no guardar la contraseña.
- `npm run dev` deja la demo apagada por defecto. `npm run dev:demo` prepara dos cuentas locales y permite mostrar Storage desde el navegador **sin** usar login JWT. Mantener esa diferencia visible cuando se pruebe la interfaz.
- `GET /api/plans` muestra el catálogo actual (solo Free). `GET /api/subscriptions/me` exige autenticación pero todavía responde `501`; no basar en él una tarjeta de “mi plan”.
- Verificación/recuperación de correo, pagos, borrado de archivos y panel administrativo visual siguen pendientes. No habilitar controles que aparenten completar esas operaciones.

## Comprobación antes de entregar el frontend

Con PostgreSQL del proyecto activo, ejecutar `npm run db:migrate` y `npm run dev`. Probar desde el navegador: registro → login → galería vacía → subida JPG/PNG/WebP → listado y descarga WebP → logout → acceso privado rechazado. Entrar con una segunda cuenta y verificar que no aparece la imagen de la primera. Ejecutar `npm run check` y `npm run test:storage`; esta última suite usa una base temporal y prueba el recorrido real con PostgreSQL.
