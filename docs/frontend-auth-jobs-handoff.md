# Traspaso a Alegría: contratos y trabajo pendiente del frontend

## Correcciones de la entrega del frontend

Revisión posterior al commit `4ba7663` de `feature/ui-tema`:

- Registro y login tienen estados separados; el enlace posterior al registro vuelve al formulario.
- Reenvío reinicia su estado al cambiar de correo; verificación y restablecimiento reinician al cambiar de token.
- El formulario usa un solo control para mostrar contraseña en Edge, campos de confirmación diferenciados y avisos ocultos fuera del recorrido de teclado.
- Todas las rutas `/app/*` requieren sesión. Sin ella se muestra «Página no disponible» y se vuelve a `/` a los tres segundos. El frontend ya no ofrece acceso demo; la API demo sigue disponible para pruebas explícitas.
- El layout recibe archivos soltados en cualquier parte, incluida la zona de subida. Cancela el aviso al soltar, salir, perder foco o pulsar Escape. La cola conserva una sola subida por entrada.
- Los procesos siguen consultándose aunque no cambien; reintentan errores temporales y cancelan peticiones al salir.
- `GET /api/files` agrega `unavailableItems`: permite mostrar las imágenes sanas y enumerar las faltantes sin borrar registros. Ver el [contrato actualizado](api.md). Los faltantes cuentan para cuota, pero se excluyen del ahorro mostrado.

Validación reproducible: `npm run check`, `npm run test:frontend` (API simulada, sin correo/BD) y `npm run test:storage` (BD temporal aislada). Las capturas de frontend se guardan en `output/playwright/frontend-regression`, fuera de Git. La prueba de navegador usa Edge en Windows; se puede seleccionar otro navegador instalado con `E2E_BROWSER_CHANNEL`.

La sesión continúa en memoria: al recargar se pierde y se aplica el aviso de acceso. Los archivos físicos ausentes necesitan restauración desde una copia; estas correcciones no recrean su contenido.

## Auditoría anterior de ramas

**Snapshot de ramas consultado:** 05/10/2026, `origin/tema-y-flujo-git` en `8d60ba3` · **Alcance:** ramas remotas, contratos backend y trabajo pendiente del frontend.

Trae los cambios de `tema-y-flujo-git` a tu rama de frontend antes de empezar. Esa rama reúne Auth, Storage y el worker. Desde la raíz del proyecto ejecuta `npm ci`; no agregues paquetes manualmente en el frontend. Las dependencias SMTP son solo del backend. No copies `SMTP_*`, `DATABASE_URL` ni `JWT_SECRET` al frontend.

Contratos completos: [Auth](auth-frontend.md), [API](api.md), [estados de trabajos](contracts/job-states.json), [OpenAPI de trabajos](contracts/jobs.openapi.json) y [traspaso S3-05](s3-05-handoff.md).

## Ramas remotas y equipo comprobados

Se ejecutó `git fetch origin` el 05/10/2026 y se compararon las ramas remotas. Solo `tema-y-flujo-git` está en el corte actual del 05/10; las demás referencias están en commits del 04/10 o anteriores. No aparecieron commits nuevos de Andy con las correcciones pendientes de S3-02.

| Rama remota | HEAD observado | Qué significa para Alegría |
| --- | --- | --- |
| `origin/tema-y-flujo-git` | `8d60ba3` | Base compartida actual. Incluye worker/contratos S3-04/S3-05, Auth de Andy, dependencias y esta guía. |
| `origin/feature/usuarios-login` | `fccb279` | Tiene los commits de Andy `687f79b` (recuperación) y `a8dd16b` (verificación), ya incorporados a `tema-y-flujo-git` en `5c2b1aa`. No tiene las dos correcciones pendientes de S3-02. |
| `origin/feature/storage-subida` | `b07d370` | Sin commits funcionales exclusivos respecto de `origin/main`; su entrega de Storage ya forma parte de la base compartida. |
| `origin/feature/pagos-planes` | `3874f4c` | Sin commits funcionales exclusivos respecto de `origin/main`; no hay una implementación nueva de suscripciones o pagos para integrar. |
| `origin/feature/ui-tema` | `3874f4c` | Apunta al mismo commit que `feature/pagos-planes`; no contiene cambios de UI posteriores. Los commits previos de Alegría (`d332bdd`, `9c29060`) forman parte del frontend existente. |
| `origin/docs` | `704a43e` | Rama documental anterior; no aporta contratos nuevos de API para este frontend. |
| `origin/codex/release-30-v0-1-0` | `e6c4cac` | Rama de publicación anterior; no añade contratos de frontend posteriores al corte del 30%. |
| `origin/main` | `22c1ef1` | Corte v0.1.0 del 30%; no usarlo como base de esta integración porque carece de los cambios recientes de `tema-y-flujo-git`. |

El historial Git de las ramas consultadas muestra commits de Geovanny, Andy (`LanyXD`) y Diego/Alegría (`diegojao`). No aparecen commits de Elden en esas referencias, aunque `docs/flujo-git.md` le asigna suscripciones y cuotas. Esto comprueba autores Git, no miembros actuales ni trabajo local aún no publicado.

## Contratos disponibles para consumir

| Área | Contrato actual | Qué puede agregar Alegría |
| --- | --- | --- |
| Cuenta | `POST /api/auth/register` crea usuario cliente y Free; responde `emailVerified: false` y no inicia sesión. `POST /api/auth/login`, `GET /api/auth/me` y `POST /api/auth/logout` usan JWT; el campo se llama `token`. | Corregir el aviso tras registro para pedir verificación; mantener sesión solo después de un login correcto y enviar Bearer a rutas privadas. |
| Verificación y recuperación | `POST /api/auth/verify-email` recibe `{ token }` (24 h); `POST /api/auth/resend-verification` recibe `{ email }`; `POST /api/auth/forgot-password` recibe `{ email }`; `POST /api/auth/reset-password` recibe `{ token, password }` (1 h). | Agregar las vistas descritas abajo y el aviso `EMAIL_NOT_VERIFIED`. Los errores son `{ error: { code, message } }`; `apiRequest()` entrega directamente el contenido de `data`. |
| Storage síncrono | `POST /api/files` recibe `multipart/form-data` con `file`; `GET /api/files?limit=20&cursor=...` lista; `GET /api/files/:fileId/download` entrega un WebP autenticado. La carga responde cuando termina. | Conservar subida, galería y descarga actuales. No cambiar a trabajos asíncronos antes de S3-11. |
| Trabajos asíncronos | `GET /api/jobs` y `GET /api/jobs/:jobId` son privados y consultables; estados `queued`, `processing`, `converted`, `published`, `failed`. | Agregar una vista/lista de estado con polling cancelable; solo `published` con `available` permite refrescar galería y descargar. |
| Catálogo | `GET /api/plans` devuelve planes activos desde PostgreSQL. El seed actual publica únicamente Free; cantidades `BIGINT`/precios `NUMERIC` pueden venir como strings. | Mantener pagos como “Próximamente”; no inventar alta/cambio de plan. `GET /api/subscriptions/me` todavía responde `501 SUBSCRIPTIONS_NOT_IMPLEMENTED`. |
| Administración y demo | `GET /api/admin/storage/stats` requiere rol `admin`; `/api/dev/storage-demo` es opt-in y solo local. La demo no habilita Auth ni trabajos. | No mostrar métricas globales a cuentas cliente ni usar identidad demo como sesión real. |

## Límites que siguen pendientes

- `POST /api/jobs` está reservado y responde `503 ASYNC_UPLOAD_NOT_READY`; todavía no admite archivos ni crea trabajos desde la UI. `converted` es un WebP temporal, no una imagen publicada.
- S3-08 (reserva/liquidación real de cuotas de Elden) y el acoplamiento S3-11 (petición HTTP → cola → publicación/deduplicación) siguen pendientes. El puerto en `docs/worker-cuotas.md` es interno; no es una API que el navegador deba llamar.
- Borrado de imágenes S3-06 y álbumes/mover imágenes S3-07 no están entregados. No habilitar botones que aparenten realizarlos.
- La lista de planes contiene tarjetas de pago de muestra, pero no hay pagos ni endpoint personal operativo; conserva el aviso de “Próximamente”.
- S3-02 tiene dos defectos en la rama integrada: el consumo del token y el cambio de contraseña no son atómicos, y un error SMTP puede revelar si existe una cuenta. Andy hará un segundo pull con las correcciones; no diseñes la pantalla para distinguir esos casos.

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
