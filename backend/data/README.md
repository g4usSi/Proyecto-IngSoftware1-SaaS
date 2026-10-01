# Ubicación anterior del esqueleto

Storage ahora utiliza [`storage/`](../../storage/README.md) en la raíz del proyecto.
Esta carpeta antigua no se utiliza; se mantiene la exclusión de Git por compatibilidad.
Si tu `.env` aún indica `STORAGE_ROOT=./data/objects`, cámbialo a `STORAGE_ROOT=./storage`.
No muevas una biblioteca existente sin coordinar su copia y la configuración de la API.
