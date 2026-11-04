# SDK de SmartStorage para Python y tienda de demostración

`smartstorage/` es el SDK (Python 3.9 o superior, solo biblioteca estándar). `tienda/` es **Pulso**, una tienda deportiva ficticia que guarda y optimiza las fotos de sus productos en SmartStorage a través del SDK. Referencia completa de las claves de API: [docs/sdk.md](../docs/sdk.md).

## Requisitos

1. SmartStorage en marcha: `npm run dev` y `npm run worker:images` desde la raíz del repositorio.
2. Una cuenta con plan **Estándar o superior** y una clave creada en **Desarrolladores → Claves de API**.

## Usar el SDK

```python
from smartstorage import SmartStorageClient

client = SmartStorageClient(api_key="ss_...")           # o SmartStorageClient.from_env()
job = client.upload_image("foto.jpg")                   # espera a que se publique
client.download_image_to(job["imageId"], "foto.webp")
print(client.quota()["plan"]["name"])
for imagen in client.images():
    print(imagen["originalName"], imagen["optimizedSizeBytes"])
```

| Método | Descripción |
| --- | --- |
| `quota()`, `summary()` | Cuota del plan; ahorro de la cuenta |
| `list_images(limit, cursor, folder_id, trash)`, `images()` | Una página, o todas con un generador |
| `upload_image(imagen, filename, folder_id, wait, timeout, idempotency_key)` | Ruta o `bytes`. Reintenta errores de red y 5xx con la misma `Idempotency-Key` |
| `get_job(id)`, `wait_for_job(id, timeout)` | Estado del proceso; lanza `JOB_FAILED` o `JOB_TIMEOUT` |
| `download_image(id)`, `download_image_to(id, ruta)` | WebP como `bytes` o en un archivo |
| `list_albums()`, `create_album(nombre)`, `move_image(id, folder_id)` | Álbumes |
| `trash_image(id)`, `restore_image(id)`, `delete_image(id)` | Papelera y borrado definitivo |

Los errores llegan como `SmartStorageError`, con `status`, `code` y `details`.

## Tienda de demostración

Desde esta carpeta, en PowerShell:

```powershell
$env:SMARTSTORAGE_API_KEY = 'ss_...'
# Opcional si la API no está en el puerto 3000:
# $env:SMARTSTORAGE_URL = 'http://127.0.0.1:3000/api'
python -m tienda.sembrar     # sube las 8 fotos de semillas/ al álbum «Tienda Pulso»
python -m tienda             # abre http://127.0.0.1:8080
```

- **Portada y categorías:** las fotos se descargan de SmartStorage con el SDK y se sirven en WebP.
- **Ficha de producto:** muestra el formato y el tamaño originales frente al WebP servido.
- **Agregar un producto** (`/admin`): la foto se sube con el SDK y el producto aparece al terminar la optimización.
- La bolsa es solo de demostración: no hay compras ni pagos reales.

`tienda/catalogo.json` se genera al sembrar y no se versiona. Para empezar de cero, bórralo y vuelve a sembrar.

## Pruebas

```powershell
python -m unittest discover -s tests -v
```

Usan un servidor HTTP simulado: no necesitan la API ni la base de datos. La integración real del flujo de claves se prueba en `backend/tests/api-keys-sdk.integration.test.js`.
