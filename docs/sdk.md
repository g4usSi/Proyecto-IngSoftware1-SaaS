# SDK y claves de API

Responsable: Geovanny. Cubre CU-14 (subir o consultar imágenes mediante SDK) y RNF-STO-03 (claves mostradas una sola vez y guardadas como huella).

## Qué es

Hay dos clientes sin dependencias con los mismos métodos: **Python** en `sdk-python/` (el de la demostración, ver su [README](../sdk-python/README.md)) y **Node.js** en `sdk/`. Permite usar la biblioteca desde código: subir imágenes y esperar a que se publiquen, listarlas, descargarlas, organizarlas en álbumes y consultar la cuota y el ahorro. Se autentica con una **clave de API**, no con usuario y contraseña.

## Claves de API

- Se crean en la aplicación, en **Desarrolladores → Claves de API**, o con `POST /api/keys`.
- Requieren un plan vigente **Estándar, Pro o Enterprise**. Free no incluye el SDK, como prometía la propuesta del 28/08/2026. Si la cuenta vuelve a Free, sus claves quedan suspendidas (`403 PLAN_REQUIRED`) y vuelven a funcionar al contratar de nuevo.
- Formato: `ss_` seguido de 32 caracteres aleatorios (192 bits). La clave completa se muestra **una sola vez**, en la respuesta de creación.
- En la base se guardan solo su huella SHA-256 (`api_keys.key_hash`) y un prefijo de 11 caracteres para reconocerla. El listado nunca devuelve la clave completa.
- Hasta 5 claves activas por cuenta. Revocar una la desactiva de inmediato y no se puede deshacer.
- Se registra el último uso, como máximo una vez por minuto.

### Qué puede hacer una clave

| Permitido | Rechazado con `403 API_KEY_NOT_ALLOWED` |
| --- | --- |
| `/files` (listar, resumen, descargar, mover, papelera, borrar) | Pagos y suscripciones |
| `/albums` | Perfil, contraseña y cierre de sesión (`/auth/*`) |
| `/jobs` (subir y consultar procesos) | Administración (`/admin/*`) |
| `GET /quotas/me` | Gestión de claves (`/keys`) |

Una clave solo accede a los recursos de su propia cuenta, igual que la sesión: la imagen de otra cuenta responde `404`.

## Rutas de gestión

Requieren sesión iniciada (JWT); una clave de API no puede crear ni revocar claves.

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/api/keys` | `{ items, eligible, maxActive }`; `eligible` indica si el plan incluye el SDK |
| POST | `/api/keys` | `201 { key, secret }`; cuerpo `{ name }` opcional (1–60 caracteres) |
| DELETE | `/api/keys/:keyId` | `200`, la clave revocada |

Errores: `400 VALIDATION_ERROR` (nombre), `403 PLAN_REQUIRED`, `409 API_KEY_LIMIT`, `404 API_KEY_NOT_FOUND`. Con una clave: `401 API_KEY_INVALID` si no existe o fue revocada.

## Uso desde Python

```python
from smartstorage import SmartStorageClient

client = SmartStorageClient.from_env()                  # lee SMARTSTORAGE_API_KEY
job = client.upload_image("foto.jpg")                   # espera a que se publique
client.download_image_to(job["imageId"], "foto.webp")
```

La demostración principal es **Pulso**, una tienda deportiva ficticia en `sdk-python/tienda/`: sus fotos de producto se suben con el SDK, se optimizan a WebP y se sirven desde la biblioteca de la tienda. Pasos en el [README del SDK de Python](../sdk-python/README.md).

## Uso desde Node.js

```js
import { SmartStorageClient } from './sdk/src/index.js';

const client = new SmartStorageClient({ apiKey: process.env.SMARTSTORAGE_API_KEY });
const job = await client.uploadImage('foto.jpg');        // espera a que se publique
await client.downloadImageTo(job.imageId, 'foto.webp');
console.log(await client.quota());
```

| Método | Descripción |
| --- | --- |
| `quota()`, `summary()` | Cuota del plan; ahorro de la cuenta |
| `listImages({ limit, cursor, folderId, trash })` | Una página de imágenes |
| `images(options)` | Iterador asíncrono sobre todas las páginas |
| `uploadImage(input, { filename, folderId, wait, timeoutMs, idempotencyKey })` | `input`: ruta, `Buffer` o `Blob`. Reintenta errores de red y 5xx con la misma `Idempotency-Key`, sin duplicar la carga |
| `getJob(id)`, `waitForJob(id, { timeoutMs })` | Estado del proceso; lanza `JOB_FAILED` o `JOB_TIMEOUT` |
| `downloadImage(id)`, `downloadImageTo(id, ruta)` | WebP como `Buffer` o en un archivo |
| `listAlbums()`, `createAlbum(nombre)`, `moveImage(id, folderId)` | Álbumes |
| `trashImage(id)`, `restoreImage(id)`, `deleteImage(id)` | Papelera y borrado definitivo |

Los errores de la API llegan como `SmartStorageError`, con `status`, `code` y `details`.

## Demostración con Node.js

Con la aplicación en marcha (`npm run dev` y `npm run worker:images`) y una clave creada en una cuenta con plan Estándar o superior:

```powershell
$env:SMARTSTORAGE_API_KEY = 'ss_...'
node sdk/examples/demo.mjs C:\ruta\a\foto.jpg
```

El ejemplo muestra la cuota, sube la imagen y espera su publicación, compara el tamaño original con el WebP, descarga el resultado junto a la carpeta actual y muestra el ahorro de la cuenta.

## Pruebas

`sdk-python/tests/test_cliente.py` prueba el cliente de Python con un servidor simulado (`python -m unittest discover -s tests` desde `sdk-python`). `backend/tests/api-keys-sdk.integration.test.js` usa el SDK contra la API y PostgreSQL reales: requisito de plan, huella sin clave en claro, límite de claves, subida y descarga, álbumes, privacidad entre cuentas, rutas prohibidas, revocación y suspensión al bajar a Free. Corre con `npm run test:storage`.
