# Entrega a Alegría — estados y recuperación S3-05

Rama publicada: `tema-y-flujo-git`. Corte: 04/10/2026. No hace falta integrar `main` para consumir este módulo. Traer la rama/commits completos, incluyendo migraciones 004 y 005; copiar solo el router omite las dependencias de servicio y BD.

## Recursos listos

| Recurso | Uso |
| --- | --- |
| `GET /api/jobs?limit=20&cursor=...` | Lista privada de trabajos, `{ data: { items, nextCursor } }`. `limit` 1–100; cursor opaco. |
| `GET /api/jobs/:jobId` | Estado real persistido, `{ data: job }`. Ajeno/inexistente devuelve el mismo 404. |
| `frontend/src/features/storage/jobs.api.js` | `listImageJobs`, `getImageJob` y `JOB_STATUS_LABELS`. Reutiliza sesión y `apiRequest`. |
| `docs/contracts/jobs.openapi.json` | Contrato OpenAPI 3.1 del módulo para herramientas o generación de clientes. |
| `docs/contracts/job-states.json` | Ejemplos estáticos de todos los estados para desarrollar pantallas; **no son respuestas reales ni habilitan cargas**. |
| `frontend/src/features/storage/storage.api.js` | Carga síncrona actual (`uploadFile`), galería (`listFiles`) y descarga (`downloadFile`). |

Enviar `Authorization: Bearer <token>`; el campo de login es `token`. Los endpoints de trabajos exigen JWT real, no cabecera de demo. Las respuestas llevan `Cache-Control: private, no-store`. Nunca usar una ruta de disco ni el UUID de trabajo como enlace de descarga.

## Mostrar estados sin confundir conversión con disponibilidad

| Estado | Texto sugerido | Comportamiento |
| --- | --- | --- |
| `queued` | En cola | Consultar de nuevo según `nextPollAfterMs`. No enviar el archivo otra vez. |
| `processing` | Procesando | Mantener el mismo UUID aunque la página se recargue. |
| `converted` | Conversión terminada; publicación pendiente | No añadir a galería ni habilitar descarga. El WebP todavía es privado/temporal. |
| `published` | Disponible | Si `available` y `imageId` existen, refrescar galería y descargar con autenticación. Si la imagen fue borrada, `available=false`. |
| `failed` | No se pudo completar | Detener polling, mostrar mensaje según `errorCode`. El reintento automático ya terminó. |

Ejemplo de consumo dentro del ciclo de vida del componente:

```js
import { getImageJob, listImageJobs } from './features/storage/jobs.api.js';
const controller = new AbortController();
const options = { token: session.token, signal: controller.signal };
const page = await listImageJobs(options);
const job = await getImageJob(jobId, options);
// Programar una única consulta siguiente cuando job.nextPollAfterMs != null.
// Cancelar timer y controller.abort() al desmontar o cerrar sesión.
// Para recuperar la pantalla tras recargar, volver a listar; no re-subir.
```

Mensajes útiles: `JOB_EXPIRED` (venció el trabajo), `JOB_INPUT_MISSING` (original perdido), `JOB_INPUT_CHANGED` (entrada alterada), `JOB_RESULT_INVALID`/`JOB_RESULT_MISSING` (resultado no recuperable), `JOB_ATTEMPTS_EXHAUSTED` (se agotaron los intentos), `UNSUPPORTED_IMAGE`/`INVALID_IMAGE` (contenido inválido). Los fallos transitorios en `queued` pueden conservar un `errorCode`: usar el estado para decidir si terminó, no solo la presencia del código. No mostrar al cliente detalles internos de la infraestructura.

Errores HTTP: 400 UUID/paginación inválida; 401 sesión ausente/inválida; 403 `ACCOUNT_DISABLED`; 404 `JOB_NOT_FOUND`. Usar el formato común `{ error: { code, message } }`.

## Límite explícito para la integración

`POST /api/jobs` está reservado pero responde **503 `ASYNC_UPLOAD_NOT_READY`**, sin guardar archivos ni crear trabajos. La pantalla puede continuar usando `POST /api/files` (201 cuando la imagen está lista). No reemplazar esa carga por una llamada que simule éxito asíncrono.

En S3-11, Geovanny/Elden conectan admisión HTTP con `stage` y el adaptador real de reservas/publicación. Allí se fija también el contrato de solicitud asíncrona (multipart, idempotencia HTTP y respuesta 202); este corte no promete un POST funcional ni crea tareas desde la interfaz. Alegría puede integrar desde ahora consultas y estados, y desarrollar los estados visuales usando los ejemplos estáticos. Borrado y álbumes son S3-06/S3-07, no se declaran entregados aquí.

Para arrancar, ejecutar las migraciones y `npm run worker:images` junto al servidor. El worker reconcilia automáticamente al inicio y cada 30 segundos; `npm run worker:recover` hace un único barrido. [Implementación y contrato con Elden](worker-cuotas.md).

## Comprobación de integración posterior

Con el adaptador real: subir una imagen, conservar UUID entre recargas, mostrar cola/proceso, habilitar la descarga solo tras publicación y comprobar 404 desde otra cuenta. Interrumpir worker/Redis y reiniciarlos sin repetir la carga desde el navegador. Probar expiración, última cuota disponible y fallo de publicación con liberación coherente. Estas comprobaciones conjuntas pertenecen a S3-11; las pruebas propias de recuperación constan en la evidencia adjunta.
