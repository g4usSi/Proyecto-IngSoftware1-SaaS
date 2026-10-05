# Traspaso a Alegría: Auth y estados de trabajos

**Base:** `tema-y-flujo-git` · **Fecha:** 05/10/2026 · **Alcance:** pantallas de verificación/recuperación de cuenta y consulta de trabajos de imagen.

Trae los cambios de `tema-y-flujo-git` a tu rama de frontend antes de empezar. Esa rama ya reúne Auth, Storage y el worker. Desde la raíz del proyecto ejecuta `npm ci`; no agregues paquetes manualmente en el frontend. Las dependencias SMTP son solo del backend. No copies `SMTP_*`, `DATABASE_URL` ni `JWT_SECRET` al frontend.

Contratos completos: [Auth](auth-frontend.md), [API](api.md), [estados de trabajos](contracts/job-states.json), [OpenAPI de trabajos](contracts/jobs.openapi.json) y [traspaso S3-05](s3-05-handoff.md).

## Auth: pantallas y recorrido

Agrega rutas públicas en `frontend/src/app/App.jsx` y usa el cliente existente `apiRequest()` de `frontend/src/services/api.js` y los estilos de `frontend/src/features/auth/auth.css`.

| Vista | Comportamiento |
| --- | --- |
| `/verify-email?token=...` | Lee el token de la URL y llama `POST /api/auth/verify-email` con `{ token }`. Ante éxito, confirma la verificación y ofrece ir al login. Ante `VERIFICATION_TOKEN_INVALID`, explica que el enlace venció o ya se usó y ofrece reenviar el correo. |
| `/forgot-password` | Solicita el correo y llama `POST /api/auth/forgot-password` con `{ email }`. Muestra siempre el mismo aviso neutral, exista o no la cuenta. |
| `/reset-password?token=...` | Pide una contraseña nueva y llama `POST /api/auth/reset-password` con `{ token, password }`. Aplica las reglas ya usadas en registro. Ante `RESET_TOKEN_INVALID`, informa que el enlace venció o ya se usó y ofrece volver a solicitarlo. |

En el login, agrega un enlace a `/forgot-password`. Si la API responde `403 EMAIL_NOT_VERIFIED`, conserva el correo ingresado y permite llamar `POST /api/auth/resend-verification` con `{ email }`. El endpoint responde neutralmente; confirma que, si la cuenta existe y no está verificada, se envió un enlace.

El registro devuelve `emailVerified: false` y no inicia sesión. Cambia el aviso actual de `AuthPage` —“Tu cuenta se creó. Inicia sesión para continuar.”— por una indicación para revisar el correo y verificarlo antes de iniciar sesión. No guardes sesión ni navegues al panel después del registro.

Tiempos y respuestas:

- Verificación: token de un uso, vence en 24 horas.
- Recuperación: token de un uso, vence en 1 hora.
- Éxito de verificación: `{ data: { verified: true } }`.
- Éxito de recuperación: `{ data: { reset: true } }`.
- Errores: `{ error: { code, message } }`; presenta `message` y usa `code` para elegir el estado de la pantalla.

La rama de Andy integrada en este corte aún tiene dos correcciones pendientes en S3-02: consumo de token/cambio de contraseña atómico y respuesta neutral cuando SMTP falla. Andy publicará esas correcciones en un segundo pull. Mantén el mensaje visual neutral y vuelve a traer la rama cuando estén disponibles.

## Trabajos de imagen: estados consultables

El cliente `frontend/src/features/storage/jobs.api.js` ya ofrece `listImageJobs`, `getImageJob` y etiquetas para los estados. Las rutas actuales exigen JWT real; usa la sesión existente y no la identidad de demo.

| Estado | Texto | Interacción |
| --- | --- | --- |
| `queued` | En cola | Consulta de nuevo según `nextPollAfterMs`. |
| `processing` | Procesando | Conserva el mismo ID del trabajo. |
| `converted` | Conversión terminada; publicación pendiente | No mostrar como imagen lista, no añadirla a la galería ni habilitar descarga. |
| `published` | Disponible | Si `available` e `imageId` están presentes, refresca la galería y permite descargar usando el endpoint autenticado. |
| `failed` | No se pudo completar | Detén las consultas y presenta un mensaje seguro basado en `errorCode`. |

Endpoints:

- `GET /api/jobs?limit=20&cursor=...` devuelve `{ data: { items, nextCursor } }`.
- `GET /api/jobs/:jobId` devuelve `{ data: job }`.
- `nextPollAfterMs` indica cuándo consultar de nuevo; es `null` en estados finales.
- Al desmontar la vista o cerrar sesión, cancela el temporizador y el `AbortController`.
- Para recuperar el estado tras recargar, vuelve a listar trabajos; no vuelvas a subir el archivo.

**Límite del contrato:** `POST /api/jobs` responde `503 ASYNC_UPLOAD_NOT_READY`. No conectes la pantalla de carga a esa ruta ni simules un éxito asíncrono. La carga vigente sigue siendo `uploadFile()` hacia `POST /api/files`, que responde cuando el WebP está listo. La admisión asíncrona se conectará en S3-11.

## Criterios de entrega del frontend

- Registro → revisar correo → verificar → login → galería.
- Login con correo no verificado permite reenviar el enlace sin perder el correo escrito.
- Solicitud de recuperación siempre muestra el aviso neutral; el enlace permite cambiar la contraseña una sola vez.
- Listado y detalle de trabajos muestran los estados reales; solo `published` habilita galería/descarga.
- `converted` no se presenta como disponible; `failed` no muestra detalles internos.
- La subida sigue usando la ruta síncrona existente hasta que S3-11 publique el contrato funcional.
- Conserva el login, logout, galería, subida y descarga del 30%; prueba las vistas en escritorio y móvil.
