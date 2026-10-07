# Alegría: contratos nuevos y trabajo pendiente del frontend

Actualizado el **07/10/2026** para `tema-y-flujo-git`. Esta entrega modifica backend, pruebas y documentación. El producto frontend se conserva.

Se retiraron las tareas ya entregadas de registro/login, verificación/reenvío, recuperación, protección de rutas, recepción global de archivos, galería y consulta de procesos. El trabajo pendiente es conectar **admisión asíncrona, cuotas reales y borrado**.

## Preparación

Traer `tema-y-flujo-git` a la rama de frontend. Desde la raíz:

```powershell
npm ci
docker compose --profile worker up -d postgres redis
npm run db:migrate
npm run dev
# Otra terminal, mismo backend/.env y STORAGE_ROOT:
npm run worker:images
```

Las migraciones se aplican con API/workers detenidos, antes de arrancar la nueva versión. Las dependencias siguen instalándose con `npm ci`. Credenciales SMTP, PostgreSQL y JWT permanecen sólo en backend/.env.

## 1. Cambiar la admisión de subidas a trabajos

| Contrato | Detalle |
| --- | --- |
| `POST /api/jobs` | Bearer JWT; `multipart/form-data`, un archivo `file`, `folderId` opcional. |
| `Idempotency-Key` | Cabecera opcional con UUID. Crear una clave por intento lógico y conservarla al repetir una petición cuyo resultado se perdió. Mismos archivo/nombre/carpeta y clave devuelven el mismo trabajo; otros datos: `409 IDEMPOTENCY_CONFLICT`. |
| Respuesta | `202`, `{ data: job }`; `Location: /api/jobs/:jobId`. El formato de job coincide con GET. |
| `GET /api/jobs/:jobId` | Consultar el UUID recibido, respetando `nextPollAfterMs`. |
| `GET /api/jobs` | Recuperar procesos al volver a la vista; paginación existente. |

`202` acredita admisión y reserva. El archivo estará disponible cuando el estado sea `published`, `available=true` e `imageId` esté presente. Un envío perdido a Redis también conserva el trabajo admitido; el worker lo recupera. Evitar repetir la carga con una clave distinta por un fallo de red.

Ejemplo de cliente a agregar en jobs.api.js, reutilizando apiRequest:

```js
export async function submitImageJob(file, { token, idempotencyKey, folderId, signal }) {
  const body = new FormData();
  body.set('file', file, file.name);
  if (folderId) body.set('folderId', folderId);
  return apiRequest('/jobs', {
    method: 'POST', token, body, signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
```

Cambios pendientes en la cola de library.jsx:

- Registrar el jobId de la respuesta y representar en cola/procesando/publicando sin agregar una imagen ficticia a la galería.
- Mantener la clave de idempotencia y el UUID al consultar o repetir la misma petición.
- Reutilizar el polling cancelable ya entregado en JobsPage; detenerlo en `published`/`failed`.
- Al publicarse, refrescar galería y cuotas. Descargar mediante `/api/files/:imageId/download` con JWT.
- Actualizar el texto de galería vacía de JobsPage que todavía indica que el procesamiento en segundo plano no está activo.
- Un reintento voluntario de un trabajo `failed` crea una clave nueva y una admisión nueva. El backend ya agotó sus reintentos automáticos.

El endpoint síncrono `POST /api/files` sigue disponible para compatibilidad y comparte todas las cuotas. La UI debe usar un solo endpoint por entrada de la cola.

Errores inmediatos: `401` sesión inválida; `403 ACCOUNT_DISABLED`, `NO_ACTIVE_SUBSCRIPTION` o `CAPACITY_EXCEEDED`; `429 DAILY_UPLOAD_LIMIT_EXCEEDED` o `DAILY_BYTES_LIMIT_EXCEEDED`; `400` multipart/UUID/tamaño vacío inválidos; `413 FILE_TOO_LARGE`; `409 IDEMPOTENCY_CONFLICT`. El contenido de imagen lo valida el worker: puede terminar `failed` con `INVALID_IMAGE`, `UNSUPPORTED_IMAGE`, `ANIMATED_IMAGE_NOT_SUPPORTED`, `IMAGE_DIMENSIONS_EXCEEDED`, `JOB_EXPIRED` u otros códigos seguros. Un `errorCode` en estado `queued` puede ser transitorio.

## 2. Mostrar cuotas del servidor

Nuevo **`GET /api/quotas/me`**, JWT obligatorio:

```json
{
  "data": {
    "plan": { "code": "free", "name": "Free" },
    "capacityBytes": "2000000000",
    "usedBytes": "100000",
    "reservedBytes": "200000",
    "availableBytes": "1999700000",
    "daily": {
      "date": "2026-10-07",
      "uploadLimit": 10,
      "uploadsUsed": "1",
      "uploadsReserved": "1",
      "bytesLimit": "200000000",
      "bytesUsed": "100000",
      "bytesReserved": "200000"
    }
  }
}
```

Bytes y contadores consumidos viajan como strings decimales; límites diarios pueden ser `null` para ilimitado. `usedBytes` incluye todas las referencias propias, también aquellas cuyo archivo físico falta. `reservedBytes` incluye trabajos pendientes de todos los días. Los contadores diarios usan el día de **admisión en America/Guatemala**; confirmar después de medianoche conserva ese día.

Agregar una función de consulta autorizada y usarla en la tarjeta de almacenamiento, indicadores y límite de subidas. La galería paginada sirve para ahorro de los archivos cargados; su subtotal no representa la cuota completa. Refrescar cuotas al admitir, publicar, fallar/liberar o borrar; cancelar las consultas al cerrar sesión.

## 3. Agregar borrado de imagen propia

**`DELETE /api/files/:fileId`**, JWT. Respuesta `200`:

```json
{ "data": { "deleted": true, "imageId": "UUID" } }
```

- Agregar la función autorizada y el control con confirmación antes de borrar.
- Tras éxito, retirar la referencia de galería/caché de miniaturas y refrescar cuotas.
- Recurso ajeno, inexistente o borrado anteriormente: `404 FILE_NOT_FOUND`.
- Borrar libera capacidad; el consumo diario queda registrado. El servidor conserva el archivo mientras otras referencias lo utilicen.
- Un proceso publicado cuya imagen se borró conserva `status: published`, pero devuelve `available=false`, `imageId=null` y `downloadUrl=null`; ocultar su descarga.

## Comprobación incremental de la UI

1. Subir dos imágenes y observar los UUID reales hasta publicación y descarga.
2. Repetir una petición con la misma clave: un trabajo y un consumo. Cambiar el contenido con esa clave: 409.
3. Consumir el último cupo; otra admisión se rechaza y el indicador incluye pendientes.
4. Borrar una imagen: baja la capacidad utilizada y se conserva el contador diario.
5. Cerrar sesión durante polling: cancelar solicitudes y aplicar el acceso protegido existente.
6. Probar fallos de worker/Redis, recarga de vista y archivo inválido sin duplicar admisiones.

## Alcance restante

Álbumes/mover imágenes, pagos y `GET /api/subscriptions/me` siguen pendientes; este último conserva `501`. La consulta de cuotas ya entrega el plan activo. Las correcciones posteriores de Andy en su rama de cuentas no se incorporan por esta integración de cuotas: evaluar ese pull por separado. No exponer operaciones internas reserve/confirm/release al navegador.

Referencias: [API](api.md), [OpenAPI de trabajos](contracts/jobs.openapi.json), [cuotas](cuotas-asincronas.md), [operación del worker](worker-cuotas.md).
