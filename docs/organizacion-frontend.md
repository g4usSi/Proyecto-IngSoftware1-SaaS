# Organización y subidas — traspaso a Alegría

La [guía vigente de Alegría](frontend-auth-jobs-handoff.md) concentra los contratos y su lista de tareas por implementar/revisar. Este documento conserva el alcance técnico y la evidencia de lo que ya se implementó.

Implementación del 07/10/2026 sobre `tema-y-flujo-git`, partiendo de `979c604` e incorporando los cambios de Andy `96f743e` y `69c7486`. Cubre S3-07, S3-09 y S3-10; la evidencia de pruebas conjuntas se registra por separado, sin equivaler a revisión del compañero ni entrega académica.

## Interfaz funcional

- **Subir / Procesos:** admisión asíncrona, clave estable por subida, seguimiento cancelable al salir de la sesión y recuperación de procesos al volver a entrar. La biblioteca sólo muestra imágenes publicadas. Las cuotas vienen del servidor, incluidas reservas y límites diarios.
- **Álbumes:** crear, seleccionar, renombrar y eliminar. En Mis imágenes o un álbum, usar el icono de carpeta para mover una imagen o dejarla sin álbum. Eliminar un álbum conserva las imágenes y los procesos pendientes, que quedan sin álbum.
- **Papelera:** enviar desde la galería, restaurar o eliminar definitivamente con confirmación. Sin caducidad automática en esta versión; ocupa capacidad hasta la eliminación definitiva. El límite diario de subidas no se devuelve al borrar. Las copias de otras cuentas permanecen intactas.
- **Cuenta → Cambiar contraseña:** formulario para el endpoint de Andy; valida contraseña actual y confirmación. Las sesiones existentes permanecen abiertas según su contrato.

Se conserva el tema claro/oscuro y la estructura del frontend. Los componentes y `organization.css` quedan separados para que Alegría ajuste la presentación sin cambiar los contratos.

## API de organización

Todas las rutas requieren identidad autenticada y responden con `{ data: ... }`.

| Ruta | Entrada / respuesta |
| --- | --- |
| `GET /api/albums` | `{ items: [{ id, name, createdAt, imageCount }] }`; contador de imágenes activas como string. |
| `POST /api/albums` | `{ name }` → `201 { album }`. |
| `PATCH /api/albums/:id` | `{ name }` → `{ album }`. |
| `DELETE /api/albums/:id` | `{ deleted: true, albumId }`; conserva imágenes. |
| `PATCH /api/files/:id` | `{ folderId: UUID o null }` → `{ imageId, folderId }`. |
| `GET /api/files?folderId=UUID` | Listado paginado del álbum; `folderId=none` selecciona imágenes sin álbum. |
| `GET /api/files?trash=true` | Papelera paginada; por defecto se listan sólo imágenes activas. |
| `POST /api/files/:id/trash` | `{ trashed: true, imageId, deletedAt }`. |
| `POST /api/files/:id/restore` | `{ restored: true, imageId }`. |
| `DELETE /api/files/:id` | Conserva el contrato anterior de borrado definitivo; la interfaz lo usa desde Papelera. |

Los DTO de imagen añaden `folderId` y `deletedAt`. Nombres de álbum de 1–120 caracteres sin espacios extremos; un nombre repetido responde `409 ALBUM_NAME_CONFLICT`. Operaciones sobre recursos ajenos o inexistentes responden `404`; mover una imagen en papelera responde `409 FILE_IN_TRASH`. Enviar/restaurar repetidamente es idempotente mientras exista la referencia. Los filtros por álbum ajeno o inexistente devuelven una lista vacía.

Una imagen en papelera no se descarga; su proceso histórico sigue `published`, pero devuelve `available=false` y `downloadUrl=null`. Restaurar recupera su álbum si todavía existe. Eliminar el álbum no cambia la clave original de idempotencia de una subida ya admitida.

## Preparación y comprobación

Con API y worker detenidos: `npm ci`, levantar PostgreSQL/Redis y ejecutar `npm run db:migrate`. Después: `npm run dev` y `npm run worker:images` en otra terminal. No hay dependencias nuevas para esta interfaz.

Comprobaciones: `npm run check`, `npm run test:storage`, `npm run test:frontend` y `npm run test:organization-browser`. Las pruebas con PostgreSQL crean y eliminan su propia base temporal local; no migran la base del equipo. El recorrido de organización usa API, PostgreSQL y Sharp reales con una entrega controlada al procesador; la suite backend cubre la cola Redis por separado.

La sesión sigue en memoria: tras recargar hay que iniciar sesión otra vez. Los procesos admitidos permanecen en el servidor. La publicación en Git no actualiza el seguimiento de Trello/Drive ni acredita integración en `main`.

## Verificación realizada

- `npm run check`: sintaxis backend y compilación aprobadas.
- `TEST_REDIS_URL=redis://127.0.0.1:6379/0 npm run test:storage` (variable de entorno equivalente en PowerShell): **123/123**, sin fallos ni omisiones, con PostgreSQL y Redis reales. Incluye las correcciones de Andy y nueve pruebas nuevas de álbumes/papelera.
- `npm run test:frontend`: aprobado en Edge; API controlada para pérdida de respuesta/reintento con el mismo UUID, cinco subidas concurrentes, cuota global y cancelación al perder sesión.
- `npm run test:organization-browser`: **11/11**, Edge con API/PostgreSQL/Sharp reales; dos cuentas, cuotas, deduplicación, álbumes, papelera/restauración/borrado, contraseña, móvil y logout/recarga. [Resultado y hashes del código probado](evidencias/2026-10-07-organizacion/resultado.json). La entrega al procesador y el correo están controlados en este recorrido; Redis queda comprobado por la suite backend y no se acredita envío SMTP externo.

Las bases temporales fueron eliminadas. Las capturas de escritorio/móvil están en `output/playwright/organization/2026-10-07T22-29-13-829Z-f55270/`. La integración de Andy está registrada en `f31d233`. La implementación y esta guía se entregan en `tema-y-flujo-git` para revisión; la integración en `main` y la entrega académica se acreditan por separado.

## Integración de UI y persistencia de álbumes — 08/10/2026

Se integró `349f581` de `feature/ui-tema` conservando la promoción de plan, las carpetas con arrastre y las correcciones de autenticación ya presentes en `tema-y-flujo-git`. El panel de cuotas distingue consumo confirmado y reservas, advierte sobre límites y muestra el plan de la cuenta en resumen y catálogo.

En el incidente reportado, los dos álbumes originales seguían presentes en PostgreSQL. No se reprodujo una eliminación al cerrar la aplicación, ni se modificaron los datos de la cuenta. Se corrigió una debilidad independiente del listado: podía quedar esperando indefinidamente. Ahora tiene un plazo de 15 segundos, actualización manual, recuperación al volver a la pestaña o recuperar conexión, identificación de la cuenta y mensajes distintos para error, carga y lista vacía. Una consulta fallida conserva la última lista confirmada.

Validación de esta integración:

- `npm run check`: sintaxis y compilación aprobadas.
- `npm run test:frontend`: **18 recorridos** aprobados con API simulada, incluidos consulta de álbumes fallida, tiempo de espera y reconexión.
- `npm run test:organization-browser`: **12 recorridos** aprobados con PostgreSQL real. El nuevo caso crea dos álbumes (uno vacío y otro con imagen), recarga, cierra el navegador, reinicia la instancia de API y sus conexiones, abre un navegador nuevo y confirma los mismos IDs, nombres, contenidos y descarga de miniatura. No reinicia el contenedor PostgreSQL ni acredita una prueba de corte eléctrico.

[Resultado y hashes de la prueba](evidencias/2026-10-08-ui-albumes/resultado.json). Capturas en `output/playwright/organization/2026-10-09T04-33-01-242Z-ad9b84/` (nombre en UTC; ejecución del 8 de octubre en Guatemala). La base temporal se eliminó al terminar; Redis y SMTP externos no forman parte de este recorrido.
