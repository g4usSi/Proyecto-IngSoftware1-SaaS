# Alegría: contratos actuales y mantenimiento

Actualizado el **09/10/2026** para la segunda versión `v0.2.0`. La integración funcional de subidas, cuotas, álbumes, papelera y contraseña está implementada. El usuario confirmó que el equipo ejecutó la aplicación en la reunión y terminó las correcciones; S3-11 quedó cerrada en Excel/Trello. Las comprobaciones siguientes se conservan para mantenimiento y futuras regresiones, sin reabrir módulos terminados. La entrega académica S3-12 sigue pendiente. Se conservan responsables y fechas.

## Preparar el proyecto

Seguir el [arranque del README](../README.md#arranque-rápido): instalar desde la raíz, configurar `backend/.env`, levantar PostgreSQL/Redis y ejecutar `npm run db:migrate` con API/worker detenidos. Debe estar aplicada `007_albums_and_trash.sql`.

Mantener **dos terminales** desde la raíz: `npm run dev` y `npm run worker:images`. Comparten `backend/.env`, PostgreSQL y `STORAGE_ROOT`. `npm run dev` por sí solo no procesa las subidas. La verificación de correo es obligatoria para el login; sin SMTP en desarrollo, el enlace se imprime en la terminal de la API.

## Base ya implementada

| Flujo | Archivos principales en `frontend/src/` |
| --- | --- |
| Registro, login, verificación/reenvío, recuperación, rutas protegidas y logout | `features/auth/`, `app/App.jsx` |
| Subidas asíncronas, reintentos con UUID estable y seguimiento durante la sesión | `features/storage/library.jsx`, `jobs.api.js`, `UploadDropzone.jsx`, `JobsPage.jsx` |
| Cuota global, reservas y límites diarios reales | `features/storage/QuotaSummary.jsx`, `quota.css`, `app/AppLayout.jsx` |
| Crear/renombrar/eliminar álbumes y mover imágenes | `features/storage/AlbumsPage.jsx`, `FileActions.jsx`, `Gallery.jsx`, `storage.api.js` |
| Enviar a papelera, restaurar y eliminar definitivamente con confirmación | `features/storage/TrashPage.jsx`, `FileActions.jsx`, `components/ActionDialog.jsx` |
| Cambiar contraseña dentro de la sesión | `features/auth/ChangePasswordPage.jsx`, `security.css`, `app/AccountMenu.jsx` |

Las correcciones de Andy `96f743e` y `69c7486` están incorporadas mediante el merge `f31d233`. Los componentes nuevos tienen estilos básicos compatibles con el tema actual, preparados para que Alegría los ajuste.

Se incorporó `349f581` de `feature/ui-tema`: medidores de capacidad, subidas y bytes diarios, reservas diferenciadas, avisos de límite y plan activo obtenido del servidor. Se conservaron las mejoras posteriores de `tema-y-flujo-git` (promoción de plan, carpetas, arrastre y autenticación). En el resumen se mantiene un solo enlace principal de promoción; el panel de cuotas añade los datos del plan.

## Comprobaciones para futuras modificaciones

| Trabajo por implementar o revisar | Resultado esperado |
| --- | --- |
| **Acabado visual de álbumes y papelera** | Ajustar tarjetas, distribución, espaciado, iconos y jerarquía de acciones en `organization.css`, `AlbumsPage.jsx`, `TrashPage.jsx` y `FileActions.jsx`; conservar las operaciones reales y distinguir borrar álbum de borrar imagen. |
| **Revisión de subidas, procesos y cuotas** | El panel de cuotas de `349f581` ya está integrado. Revisar su coherencia con las etiquetas de procesos y errores; mantener visible cuándo una imagen sigue en proceso, cuándo puede descargarse y cuándo la admisión no pudo confirmarse. |
| **Integración visual de seguridad y confirmaciones** | Revisar el formulario de cambio de contraseña y los diálogos con el resto de la cuenta: foco, teclado, mensajes, botones y tema claro/oscuro. La confirmación del borrado definitivo debe permanecer. |
| **Revisión final tras sus ajustes** | Recorrer escritorio/móvil, nombres largos, estados vacíos y errores; comprobar navegación por teclado, contraste y ausencia de desbordamientos. Ejecutar las comprobaciones de abajo y registrar la revisión del compañero para S3-11. |

La base funcional de S3-09/S3-10 ya está conectada. Estas tareas corresponden a la presentación y revisión que quedaron a cargo de Alegría; no significan que falten los endpoints o sus clientes. La evidencia automatizada existente no sustituye su revisión del diseño ni la entrega académica.

## Contratos que debe conservar

Base `/api`. Rutas privadas con `Authorization: Bearer <token>`. Éxito JSON `{ data: ... }`; error `{ error: { code, message } }`. `apiRequest()` ya devuelve el contenido de `data`: reutilizar `services/api.js`, `storage.api.js`, `jobs.api.js` y `auth.api.js`.

### Subida y procesos

| Ruta | Entrada / respuesta |
| --- | --- |
| `POST /api/jobs` | `multipart/form-data`: un archivo `file`, `folderId` opcional. Cabecera `Idempotency-Key: UUID`. Responde `202 { data: job }` y `Location: /api/jobs/:id`. |
| `GET /api/jobs/:id` | Estado de un trabajo propio, con `id`, `status`, `available`, `imageId`, `downloadUrl`, `errorCode`, `nextPollAfterMs`, intentos y fechas. |
| `GET /api/jobs?limit=20&cursor=...` | `{ items: job[], nextCursor }`; omitir cursor en la primera página. |
| `GET /api/files/:id/download` | WebP privado; usar el ID de imagen, no el ID del trabajo. |

Estados: `queued → processing → converted → published`, o `failed`. **`202` sólo confirma admisión/reserva; `converted` todavía no habilita la descarga.** Mostrar una imagen disponible únicamente con `status === 'published' && available && imageId`.

La cola del frontend ya admite hasta tres envíos simultáneos y consulta los estados en `LibraryProvider`; `JobsPage` consume ese estado compartido. Conservar `nextPollAfterMs`, reintentos ante fallos temporales y cancelación al cerrar sesión. Cambiar de sección no debe interrumpir los procesos de la sesión. Tras recargar hay que iniciar sesión otra vez; los trabajos admitidos se consultan en el servidor.

Si se pierde la respuesta de admisión, consultar el mismo UUID y conservarlo al repetir el envío. Mismos archivo/nombre/álbum y clave recuperan el mismo trabajo; otros datos responden `409 IDEMPOTENCY_CONFLICT`. Un trabajo definitivamente fallido puede volver a subirse voluntariamente con una clave nueva. `POST /api/files` síncrono queda para compatibilidad; la cola web usa únicamente `/api/jobs`.

### Cuotas

`GET /api/quotas/me` devuelve:

| Campo | Significado |
| --- | --- |
| `plan.code`, `plan.name`, `capacityBytes` | Plan activo y capacidad. |
| `usedBytes`, `reservedBytes`, `availableBytes` | Espacio utilizado, reservado para procesos y disponible. |
| `daily.date`, `daily.uploadLimit`, `daily.bytesLimit` | Día de Guatemala y límites diarios; los límites pueden ser `null` (ilimitado). |
| `daily.uploadsUsed`, `daily.uploadsReserved`, `daily.bytesUsed`, `daily.bytesReserved` | Consumo confirmado y pendiente del día de admisión. |

Los bytes y contadores de consumo viajan como strings decimales. La cuota se consulta al servidor y no se calcula con la página de la galería. Refrescar al admitir, publicar, fallar, restaurar o borrar. La papelera conserva capacidad; eliminar definitivamente libera espacio **sin devolver consumo diario**. Si falla la consulta, mostrar el error o indicar que se conservan los últimos valores conocidos; no aparentar cuota cero.

### Álbumes, movimiento y papelera

| Ruta | Entrada / respuesta dentro de `data` |
| --- | --- |
| `GET /api/albums` | `{ items: [{ id, name, createdAt, imageCount }] }`; contador de imágenes activas como string. |
| `POST /api/albums` | `{ name }` → `201 { album }`. |
| `PATCH /api/albums/:id` | `{ name }` → `{ album }`. |
| `DELETE /api/albums/:id` | `{ deleted: true, albumId }`; conserva imágenes y deja sin álbum los procesos pendientes. |
| `PATCH /api/files/:id` | `{ folderId: UUID o null }` → `{ imageId, folderId }`; `null` significa sin álbum. |
| `GET /api/files` | `{ items, unavailableItems, nextCursor }`; admite `limit`, `cursor`, `folderId=UUID` o `folderId=none`, y `trash=true` o `false`. Por defecto sólo imágenes activas. |
| `POST /api/files/:id/trash` | `{ trashed: true, imageId, deletedAt }`. |
| `POST /api/files/:id/restore` | `{ restored: true, imageId }`. |
| `DELETE /api/files/:id` | `{ deleted: true, imageId }`; borrado definitivo. La UI lo ofrece desde Papelera con confirmación. |

Los DTO de imagen incluyen `folderId` y `deletedAt`. En álbumes, nombres de 1–120 caracteres tras recortar espacios; duplicados responden `409 ALBUM_NAME_CONFLICT`. Mover a un álbum ajeno/inexistente responde `404 FOLDER_NOT_FOUND`; actuar sobre un álbum ajeno/inexistente, `404 ALBUM_NOT_FOUND`. Filtrar por uno de esos álbumes devuelve una colección vacía sin revelar su existencia.

Conservar estas reglas al cambiar el diseño:

- Retirar imágenes y caché sólo tras una operación exitosa; ante fallo conservarlas y mostrar el error.
- En papelera no se puede descargar ni mover (`409 FILE_IN_TRASH` al mover); restaurar recupera el álbum si aún existe. No hay caducidad ni vaciado automático.
- El proceso de una imagen en papelera conserva `published` e `imageId`, pero tiene `available=false` y `downloadUrl=null`. Después del borrado definitivo, también queda `imageId=null`. Ocultar la descarga en ambos casos.
- Eliminar un álbum conserva sus imágenes, incluidas las de papelera. Eliminar una imagen no afecta las referencias de otras cuentas al mismo objeto físico.

### Cambio de contraseña y errores comunes

`POST /api/auth/change-password`, JWT y JSON `{ currentPassword, newPassword }` → `200 { data: { changed: true } }`. La confirmación sólo se valida en la interfaz. Contraseña actual incorrecta: **`400 INVALID_CURRENT_PASSWORD`**, conservando la sesión. Tras éxito limpiar los campos; las sesiones existentes continúan abiertas según el contrato de Andy. Detalle en [autenticación](auth-frontend.md).

Mantener el manejo común de `401` (limpiar sesión), `403` (cuenta/plan/capacidad), `429` (límite diario o intentos), `413 FILE_TOO_LARGE` y `404` (recurso no disponible). No confundir `failed` del worker con un fallo temporal al consultar su estado ni mostrar detalles internos del servidor.

## Comprobar antes de entregar sus ajustes

1. Registro/verificación → login → subida → proceso → galería y descarga. Repetir una admisión incierta con el mismo UUID, sin duplicarla.
2. Crear/renombrar álbum → mover imagen → enviar a papelera → restaurar → borrar álbum conservando su contenido → purgar con confirmación.
3. Verificar cuotas antes/después, rechazo por límite, recursos ajenos y persistencia de imágenes de la segunda cuenta.
4. Cambiar contraseña; probar errores y confirmación. Cerrar sesión durante consultas y volver a entrar tras recarga.
5. Repetir los controles principales en móvil y tema oscuro; ejecutar `npm run check`, `npm run test:frontend` y `npm run test:organization-browser`. Para backend completo, seguir [las pruebas con Redis del README](../README.md#comandos-del-equipo).

Evidencia de la implementación previa: **123/123 backend con PostgreSQL/Redis, frontend aprobado y 11/11 recorridos Edge**; no se reejecutó por esta actualización documental. Ver [resultado y alcance de la verificación](organizacion-frontend.md#verificación-realizada).

## Fuera de esta entrega

Pagos y `GET /api/subscriptions/me` continúan pendientes (este último responde `501`). El plan activo ya está disponible en `/api/quotas/me`. No habilitar contratación ni presentar un backend inexistente como operativo. Retención automática, vaciado masivo de papelera y otras ampliaciones requieren acordar alcance; no son tareas pendientes de esta tarjeta.

Referencias: [API](api.md), [OpenAPI de trabajos/cuotas](contracts/jobs.openapi.json), [cuotas](cuotas-asincronas.md), [worker](worker-cuotas.md) y [organización/verificaciones](organizacion-frontend.md).
