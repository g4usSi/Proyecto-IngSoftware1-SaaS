# Segunda versión v0.2.0 — avance funcional del 50%

Corte del 09/10/2026 desde `tema-y-flujo-git` @ `3720ea9f9779d6ee466fd0074b7fbf580b6cb0b5`. `v0.2.0` identifica la segunda versión del proyecto; `v1.0.0` sigue reservado al alcance final. El 50% es el alcance acordado para este hito, no un porcentaje calculado contando tarjetas.

## Novedades respecto de v0.1.0

- **Andy — cuentas:** verificación y reenvío de correo, recuperación con token temporal de un uso y consumo atómico; cambio autenticado de contraseña; respuestas neutrales ante recuperación y fallo del correo. Sesiones privadas, revocación/logout y contratos de autenticación integrados.
- **Geovanny — procesamiento:** admisión asíncrona con UUID/idempotencia, Redis/BullMQ y worker Sharp; estados persistentes, reintentos, reconciliación y recuperación tras interrupción. Publicación privada de WebP y limpieza de temporales/objetos huérfanos.
- **Elden y acoplamiento compartido — cuotas:** reservas transaccionales, capacidad y dos límites diarios independientes; confirmación/liberación sin duplicar consumo; día de admisión en Guatemala y cuotas compartidas entre las rutas síncrona/asíncrona.
- **Organización:** crear, renombrar y eliminar álbumes; mover imágenes sin duplicarlas; papelera, restauración y purga confirmada. Borrar un álbum conserva sus imágenes; borrar una referencia conserva objetos usados por otras cuentas y el consumo diario.
- **Alegría y frontend integrado:** pantallas de cuentas/contraseña, procesos, álbumes y papelera; medidores de capacidad, subidas y bytes diarios con reservas/avisos; plan real y acceso de promoción. Mejoras de vista previa, propiedades, nombres largos, scroll y fondo de autenticación.
- **Correcciones finales:** carga de álbumes con timeout/reintento, recuperación al volver a la pestaña/conexión y conservación de la última lista ante error; persistencia comprobada después de recargar, cerrar navegador y reiniciar API/conexiones.
- **Operación:** migraciones incrementales hasta `007_albums_and_trash.sql`, contratos API/OpenAPI, instrucciones de Docker/API/frontend/worker y suites reproducibles. Credenciales SMTP se configuran localmente y no se versionan.

## Aceptación y cierre del hito

S3-01 a S3-10 cumplen el alcance funcional de sus módulos. El usuario confirmó el 09/10 que el equipo realizó la reunión, ejecutó la aplicación y terminó las correcciones: S3-11 está cerrada por esa revisión conjunta reportada. No se atribuye un review formal de GitHub a la reunión.

S3-12 está **lista para entregar**, pendiente de presentar/enviar al curso y registrar fecha/constancia. Publicar esta release en `main` completa el corte técnico y no acredita esa entrega académica. Los pendientes anteriores S2 y las tareas EX se conservan. Pagos, renovación y panel administrativo completo corresponden al siguiente avance del 80%.

## Recorrido de demo

1. Registrar/verificar una cuenta, iniciar sesión y comprobar plan Free/cuotas.
2. Subir una imagen, observar admisión/procesamiento y descargar el WebP publicado.
3. Crear un álbum, mover y renombrar; recargar y volver a iniciar sesión para comprobar persistencia.
4. Enviar imagen a papelera, restaurar y purgar con confirmación; explicar capacidad frente a consumo diario.
5. Mostrar recuperación/cambio de contraseña, logout y privacidad usando otra cuenta.

## Validación de la release

La validación del 09/10 se registra en [resultado de v0.2.0](evidencias/2026-10-09-v0.2.0/resultado.json). Comandos: `npm run check`, `npm run test:storage` con `TEST_REDIS_URL`, `npm run test:frontend` y `npm run test:organization-browser`.

La suite backend utiliza PostgreSQL y Redis reales y bases/colas temporales. La suite frontend utiliza API simulada. El recorrido de organización utiliza Edge, HTTP/PostgreSQL/Sharp reales, entrega al consumidor en memoria y correo capturado: no prueba SMTP externo. Las pruebas no acreditan despliegue ni apagón del equipo. No se migró ni modificó la base de datos de desarrollo del equipo.

## Instalación de esta versión

Seguir [README](../README.md): Node 24, `npm ci`, configuración local `backend/.env`, PostgreSQL/Redis activos, `npm run db:migrate` con API/worker detenidos; después abrir API/frontend y worker en dos terminales. La configuración y los datos privados no se incluyen en Git.
