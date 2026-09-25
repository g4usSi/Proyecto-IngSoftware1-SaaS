# Storage: entrega inicial de Geovanny

## Alcance implementado

Subida individual → validación de imagen estática → SHA-256 del original → WebP calidad 80 → referencia privada en PostgreSQL → listado y descarga. La conversión termina antes del `201`; no se anuncia una cola ni progreso porcentual ficticio.

- Formatos de entrada: JPG, PNG y WebP. Máximo 25,000,000 bytes (25 MB decimales).
- Límite de decodificación: 40 millones de píxeles, para acotar memoria durante esta conversión síncrona. El rechazo se comunica antes de crear una referencia.
- Se conserva el tamaño en píxeles, aplicando la orientación. Se eliminan EXIF/GPS.
- Una animación se rechaza con un error; no se destruyen silenciosamente sus fotogramas.
- El original se elimina tras el procesamiento. Solo permanece el WebP.
- Deduplicación global de **bytes originales idénticos**, no de imágenes visualmente parecidas.
- Listado paginado y descargas por ID de imagen y propietario, sin exponer hashes ni rutas físicas.
- Borrado, álbumes en la interfaz, cola y panel administrativo visual quedan fuera de este corte.

## Datos y archivos

```text
Proyecto _IngSoftware1/
  storage/
    README.md
    .tmp/                    Originales y resultados en curso
    ab/
      ab…hash-original.webp  Objeto físico definitivo
```

`STORAGE_ROOT=./storage` se resuelve desde la raíz del repositorio, incluso al ejecutar Node desde `backend/`. Los datos generados están excluidos de Git. No colocar aquí archivos que se quieran publicar con un servidor estático.

PostgreSQL conserva dos conceptos separados:

| Tabla | Responsabilidad |
| --- | --- |
| `stored_objects` | Hash del original, tamaño original, clave relativa WebP, estado y fechas. Una fila por original único global. |
| `images` | ID privado, propietario, nombre recibido, carpeta opcional y referencia al objeto. Cada subida aceptada crea una referencia. |

El tamaño WebP se lee del archivo con `stat`. No se guarda otra copia de metadatos en JSON, ni porcentajes o contadores de ahorro. Respaldar PostgreSQL **y** `storage/` como una biblioteca coordinada.

Ejemplo: A sube `foto.jpg` y B sube los mismos bytes con otro nombre. Existen dos filas `images` y una fila `stored_objects`, con un solo WebP. A no puede descargar la fila de B aun conociendo su ID.

## Demostración local y autenticación real

Con Docker Desktop instalado y en ejecución, desde la raíz:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
docker compose up -d postgres
npm run db:migrate
npm run dev:demo
```

Abrir `http://localhost:5173/app/storage`. Seleccionar explícitamente Demo Storage A. Cargar una imagen, comprobar sus dos tamaños y descargar el WebP. Cambiar a Demo Storage B: la lista debe estar vacía inicialmente. Subir el mismo archivo y comprobar que hay un solo WebP físico. Volver a A conserva su registro.

`dev:demo` prepara las cuentas de forma idempotente; no borra archivos ni reinicia cuotas. Las cuentas tienen plan Free y no tienen contraseña de login. La variable `STORAGE_DEMO_ENABLED=true` solo se pasa al proceso hijo; no se escribe en `.env`. Al volver a `npm run dev`, la demo está desactivada por defecto.

El modo demo admite únicamente las dos identidades reservadas, peticiones locales y orígenes locales. La configuración rechaza activarlo en producción o escuchar en interfaces públicas. No usarlo para un despliegue accesible a otros equipos.

`requireAuth` verifica JWT, expiración, revocación y estado del usuario, y establece `req.user = { id, email, role }`. El frontend podrá pasar una sesión con `accessToken` al componente de Storage cuando Alegría conecte el login; mientras tanto, la demo permite probar la biblioteca en el navegador.

## Cuotas y concurrencia

Storage consulta la suscripción activa y vigente, y exige usuario y plan activos. Usa la capacidad lógica documentada: suma de tamaños originales por referencia, aunque el archivo ya exista físicamente. Free aplica 2 GB, 10 subidas y 200 MB diarios; el día comienza a medianoche de Guatemala.

Cada subida bloquea primero el usuario y después el hash del objeto dentro de una transacción. Así dos solicitudes simultáneas no pueden saltarse una cuota ni crear dos objetos físicos para el mismo original. El WebP se publica completo y la referencia se confirma junto con sus metadatos. Los temporales se limpian también en los errores controlados.

Las cuotas se derivan de las imágenes actuales porque el borrado todavía responde `501`. Antes de implementarlo, coordinar con Elden un registro de consumo que sobreviva al borrado; de lo contrario se podría reiniciar el límite diario eliminando imágenes.

Un proceso terminado abruptamente o una pérdida de conexión en el instante del `COMMIT` requiere reconciliar disco y PostgreSQL. No borrar automáticamente un WebP cuyo resultado transaccional es incierto: puede estar referenciado. La recuperación completa y limpieza de huérfanos tras un cierre forzado pertenecen al siguiente hito. La limpieza de temporales no garantiza borrado físico seguro del medio.

## Ahorro administrativo

`GET /api/admin/storage/stats` requiere un usuario autenticado con rol `admin`. Las dos cuentas demo son clientes. No se añade aún el panel visual.

Suma tamaños originales por referencia (`B`), por objeto único (`U`) y bytes físicos únicos (`P`). Devuelve `B - P` y su porcentaje; `B - U` y `U - P` permiten explicar deduplicación y conversión. El resultado puede ser negativo para originales que se expandan al convertir. Un archivo ausente devuelve un error de integridad, nunca un ahorro inventado.

## Pruebas

```powershell
npm run check
npm test
```

La suite de Storage requiere además `TEST_DATABASE_URL` explícita hacia una base **de pruebas**. Nunca toma automáticamente `DATABASE_URL`. Crea y elimina esquemas temporales de nombre aleatorio y archivos temporales propios; el usuario de pruebas necesita permiso para crear esquemas.

Si PostgreSQL del `compose.yaml` está en ejecución en `localhost:5433`, basta con `npm run test:storage`: el comando crea una base temporal de nombre aleatorio con la conexión local de `backend/.env`, ejecuta la suite completa y elimina esa base. No requiere que la terminal encuentre el ejecutable `docker`.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://usuario:clave@127.0.0.1:puerto/base_de_pruebas'
npm test
Remove-Item Env:TEST_DATABASE_URL
```

Incluye autenticación real con PostgreSQL, asignación Free, subida con JWT, conversión, EXIF, permisos entre cuentas, deduplicación concurrente, cuotas, paginación, formatos inválidos, rollback y persistencia al reiniciar la aplicación. No equivale a probar recuperación tras una caída del equipo.

## Edición e integración

- **Andy:** mantener el contrato `req.user`; las identidades demo no se convierten en credenciales reales.
- **Elden:** la asignación Free ya ocurre de forma atómica durante el registro; coordinar la estrategia de bloqueo al modificar planes/suscripciones y el consumo diario antes del borrado.
- **Alegría:** componentes en `frontend/src/features/storage/`; reglas locales en `storage.css`, colores en `styles/theme.css`. El cliente de API recibe credenciales; no persiste tokens ni decide identidad.
- **Geovanny:** servicio, repositorio y manejo de archivos en `backend/src/modules/storage/`. Nuevas migraciones se añaden; no editar las ya aplicadas.
