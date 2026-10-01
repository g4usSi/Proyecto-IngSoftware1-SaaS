# Aceptación del flujo integrado del 30%

## Prioridad y alcance

Consulta de Trello y del Excel canónico realizada el **30/09/2026**, zona `America/Guatemala`. Las tareas S2-07 a S2-10 de Geovanny figuraban implementadas y verificadas, con cierre pendiente por revisión/integración. La carencia técnica explícita de [S2-15](https://trello.com/c/UQg8fGsE) era el recorrido documentado en navegador. Este trabajo atiende esa carencia antes de ampliar Storage para el 50%.

El plan mantiene la entrega del 50% el **09/10/2026**. La siguiente implementación prioritaria de Geovanny es [S3-04: Redis, BullMQ y worker Sharp](https://trello.com/c/nVmEkUYG), con fin el 02/10; después S3-05, recuperación/reintentos (04/10), S3-06, borrado (05/10), y S3-07, álbumes (06/10). El worker debe coordinarse con las cuotas de S3-08 de Elden. Este corte no implementa esas funciones ni cambia fechas o responsables.

## Ejecutar la aceptación

Desde la raíz, con Node 24, dependencias instaladas y PostgreSQL local en el puerto 5433:

```powershell
npm ci
npx playwright install chromium
npm run test:storage
npm run test:browser
```

El instalador de Chromium se ejecuta una vez por equipo. Si Windows ya tiene Edge, puede usarse en su lugar:

```powershell
$env:E2E_BROWSER_CHANNEL = 'msedge'
npm run test:browser
Remove-Item Env:E2E_BROWSER_CHANNEL
```

`DATABASE_URL` se toma de `backend/.env` o del entorno. El supervisor solo admite localhost:5433, fuera de producción, y requiere permiso `CREATEDB`. Crea una base `smartstorage_codex_check_<aleatorio>`, aplica las migraciones allí y la elimina al salir. No ejecuta migraciones en la base indicada por el usuario. Los WebP de la prueba usan un directorio temporal propio que también se elimina.

La API y Vite arrancan en puertos locales disponibles; el script abre navegadores aislados y genera imágenes sintéticas. Las contraseñas y el secreto JWT son aleatorios por ejecución. No se habilita la demo ni se envían correos. Los límites y los roles se alteran únicamente en la base temporal para verificar restricciones y estadísticas.

## Qué se verifica

| Caso | Evidencia esperada |
| --- | --- |
| Registro con validación visible | Campos vacíos muestran error; A recibe una única suscripción Free real: 2 GB, 10 subidas, 200 MB diarios |
| Cuenta independiente B | Correo duplicado devuelve 409 y error de campo; otro correo crea un cliente con Free |
| Carga múltiple de A | PNG y JPG llegan desde el selector de archivos a WebP, miniaturas, galería y descarga decodificable |
| Privacidad y deduplicación | B no ve A y obtiene 404 al pedir su descarga; el mismo PNG en B reutiliza bytes físicos: tres imágenes, dos objetos |
| Errores y cuotas | Archivo falso y límite diario real muestran errores y no crean referencias |
| Ahorro administrativo | Cliente recibe 403; admin obtiene originales lógicos menos bytes WebP únicos leídos del disco |
| Reinicio de API | Galería y descarga conservan datos; recargar el navegador exige iniciar sesión de nuevo según el contrato actual |
| Logout y login incorrecto | El menú revoca el JWT, su reutilización da 401; contraseña incorrecta muestra error; login válido recupera la galería |
| Conversión que aumenta el tamaño | WebP de 38 B pasa a 44 B; resumen y análisis muestran 6 B adicionales y 16% más, sin anunciar ahorro ficticio |
| Ejecución de interfaz | Sin excepciones JavaScript; capturas de escritorio y vista móvil de 390 px |

Registro, carga, navegación, errores y logout se ejercitan desde la interfaz. Aislamiento de descargas, comprobación física, cuotas y ahorro administrativo añaden verificaciones HTTP/SQL; no existe todavía un panel administrativo visual.

## Resultado del 30/09/2026

Base de código: `b22e809` más los cambios locales de esta tarea. Node 24.14.0, PostgreSQL 18 y Edge mediante Playwright 1.62.1. Se usó una instancia PostgreSQL temporal porque el servicio habitual no estaba activo.

- `npm run check`: aprobado.
- `npm run test:storage`: **44/44**, sin omisiones.
- `npm run test:browser`: **10/10 escenarios**, contra API y PostgreSQL reales.
- Se reprodujo y corrigió el ahorro incorrecto al crecer un WebP. Las barras de formatos ahora comparten una escala que incluye el mayor tamaño; el ranking solo incluye imágenes que reducen su peso.

Cada ejecución guarda `resultado.json`, capturas y descargas sintéticas en `tmp/acceptance-browser/<ejecución>/`. El JSON incluye fechas UTC y SHA-256 de los archivos de prueba, el lockfile y las pantallas corregidas. El directorio `tmp/` está ignorado por Git. Las evidencias seleccionadas de este corte están en [evidencias/2026-09-30](evidencias/2026-09-30/resultado.json).

S2-15 queda **verificada localmente** para este recorrido. [S2-16](https://trello.com/c/lT1Q1CPK) conserva pendientes la revisión de un compañero, integración y constancia de entrega. No se modificaron Trello ni el Excel remoto en esta ejecución de desarrollo.

No se han probado recuperación tras caída de PostgreSQL/equipo, worker asíncrono, correo, recuperación de contraseña, álbumes, borrado, pagos ni todos los navegadores. Reiniciar la API conservando PostgreSQL disponible no equivale a probar una caída abrupta del sistema.

## Primer corte v0.1.0 — 01/10/2026

La aceptación anterior conserva su fecha histórica. El usuario confirmó que Alegría revisa los módulos al integrar el frontend. Esta revisión se registra como reportada por el usuario, sin atribuir una aprobación formal de GitHub. El primer corte se propone a `main` mediante PR; consultar [estado y criterios de cierre](estado-sistemas.md) para distinguir desarrollo listo, publicación y entrega académica. S2-16 mantiene pendiente la constancia de presentación; su fecha no se reprograma.
