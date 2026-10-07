# SmartStorage

Base del proyecto de Ingeniería de Software I: almacenamiento de imágenes con deduplicación global y conversión a WebP.

**Estado: autenticación, Storage e interfaz integrados.** El registro asigna el plan Free y, tras iniciar sesión, un token JWT permite subir y descargar imágenes. La sesión del navegador vive en memoria: al recargar hay que iniciar sesión de nuevo.

## Qué funciona

- Aplicación React con navegación y estilos basados en el HTML de mockups del equipo.
- Servidor Express con comprobación de estado, disponibilidad de PostgreSQL y consulta del catálogo.
- Esquema inicial, plan Free y ejecución de migraciones con historial.
- Separación por módulos y capas, cliente HTTP común y respuestas de error uniformes.
- Subida de imágenes estáticas JPG/PNG/WebP de hasta 25 MB y conversión a WebP calidad 80.
- Listado paginado, descarga del propietario, cuotas transaccionales y deduplicación entre cuentas.
- Metadatos en PostgreSQL, archivos privados en `storage/` y ahorro calculado para administrador.
- Herramienta de demostración local por API con dos cuentas reservadas; la interfaz requiere sesión real.
- Registro, login, cierre de sesión y acceso privado mediante JWT; cada cuenta nueva recibe Free.
- Verificación de correo, recuperación de contraseña y consulta privada de procesos.
- Admisión asíncrona `POST /api/jobs`, worker Redis/BullMQ, publicación privada y recuperación.
- Cuotas compartidas entre ambas rutas, consulta `GET /api/quotas/me` y borrado privado que conserva el consumo diario.

La interfaz incluye subida asíncrona y cuotas reales, álbumes, movimiento de imágenes, papelera/restauración y borrado definitivo confirmado. También incorpora el cambio de contraseña y las correcciones de recuperación de Andy. La [guía vigente para Alegría](docs/frontend-auth-jobs-handoff.md) reúne los contratos y las tareas de acabado visual y revisión que faltan. Los pagos siguen pendientes. Este estado corresponde al trabajo de `tema-y-flujo-git`; no acredita publicación en `main`.

## Arranque rápido

Requisitos: **Node.js 24, npm 11 o superior, PostgreSQL 17/18 y Redis**. Para los comandos siguientes, abrir Docker Desktop y usar PowerShell desde la raíz del repositorio. Docker ejecuta PostgreSQL/Redis; Node ejecuta la API, el frontend y el worker. Trabajar sobre `tema-y-flujo-git`, conservando cualquier cambio local antes de cambiar de rama.

### 1. Preparar dependencias y configuración

La primera vez, o después de recibir cambios en dependencias:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Editar `backend/.env` antes de continuar:

| Variable | Configuración local |
| --- | --- |
| `DATABASE_URL` | El ejemplo ya coincide con Compose: PostgreSQL en `localhost:5433`, base/usuario `smartstorage`. |
| `JWT_SECRET` | Reemplazar el ejemplo por un secreto propio de al menos 32 caracteres; el ejemplo incluye un comando para generarlo. |
| `REDIS_URL` | `redis://127.0.0.1:6379/0`. |
| `STORAGE_ROOT` | `./storage`; API y worker deben compartir esta ubicación y la misma base de datos. |
| `FRONTEND_URL` | `http://localhost:5173`, para los enlaces de verificación y recuperación. |
| `SMTP_*` | Configurar las cinco variables para enviar correo. En desarrollo, si todas están vacías, los enlaces aparecen en la terminal de la API. |

No sobrescribir un `.env` existente. `npm ci` instala ambos módulos; no hace falta instalar dentro de cada carpeta. Usar `npm.cmd` si PowerShell bloquea `npm.ps1`. En macOS/Linux, copiar el ejemplo con el comando equivalente sólo si el destino no existe.

### 2. Levantar servicios y aplicar migraciones

Con la API y el worker detenidos:

```powershell
docker compose --profile worker up -d --wait postgres redis
npm run db:migrate
```

Compose espera a que los servicios estén listos. PostgreSQL se expone en **5433** y Redis en **6379**, sólo en localhost. La migración nueva es `007_albums_and_trash.sql`; el comando aplica todas las pendientes y conserva el historial. No modificar migraciones ya aplicadas.

### 3. Ejecutar la aplicación en dos terminales

**Terminal 1 — API y frontend**, desde la raíz:

```powershell
npm run dev
```

**Terminal 2 — procesamiento de imágenes**, también desde la raíz:

```powershell
npm run worker:images
```

Mantener ambas abiertas. `npm run dev` no inicia el worker: sin él las subidas admitidas quedan pendientes de procesamiento. El frontend ya utiliza `POST /api/jobs`; aparecerán en la biblioteca cuando se publiquen.

- Portada: <http://127.0.0.1:5173/>
- Panel: <http://127.0.0.1:5173/app>
- Estado del servidor: <http://127.0.0.1:3000/api/health>
- Disponibilidad de PostgreSQL: <http://127.0.0.1:3000/api/ready>
- Catálogo real: <http://127.0.0.1:3000/api/plans>

`/api/health` confirma que la API funciona; `/api/ready` devuelve `503` hasta configurar una conexión PostgreSQL válida. Storage y el catálogo requieren además ejecutar migraciones.

Crear una cuenta, abrir su enlace de verificación y luego iniciar sesión. Sin SMTP configurado en desarrollo, copiar el enlace que imprime la terminal 1. La sesión vive en memoria: al recargar hay que iniciar sesión otra vez; los trabajos ya admitidos permanecen en el servidor.

### Uso diario y cierre

En los siguientes arranques, levantar PostgreSQL/Redis con el comando del paso 2 y abrir las dos terminales del paso 3. Repetir `npm ci` cuando cambien dependencias y `npm run db:migrate` cuando lleguen migraciones nuevas, siempre con API/worker detenidos.

Para detener la aplicación, pulsar **Ctrl+C en ambas terminales**. Para detener también PostgreSQL/Redis conservando sus datos:

```powershell
docker compose --profile worker stop postgres redis
```

La demo es una herramienta separada: `npm run dev:demo` prepara dos identidades para pruebas de Storage por API y activa `X-Storage-Demo-User`. No crea sesiones JWT ni permite entrar al panel sin login. Ver [límites de la demo](docs/storage.md).

### Base de datos instalada localmente

Crear una base de desarrollo vacía, por ejemplo con la utilidad `createdb` de PostgreSQL:

```powershell
createdb -h 127.0.0.1 -p 5432 -U postgres smartstorage
```

Editar `DATABASE_URL` en `backend/.env` usando el usuario, contraseña y puerto de esa instalación. Codificar los caracteres especiales de la contraseña para URL. Ejecutar Redis localmente o mantener sólo ese servicio de Compose, y ajustar `REDIS_URL` si cambia su dirección. Después ejecutar `npm run db:migrate` y los comandos de las dos terminales. No apuntar las migraciones a una base ajena o de producción.

La aplicación no crea ni modifica bases automáticamente al arrancar. Una segunda ejecución de migraciones omite las ya aplicadas. No editar una migración aplicada: añadir otra numerada.

### Comandos del equipo

| Comando | Uso |
| --- | --- |
| `npm run dev` | API y frontend juntos; Ctrl+C termina ambos |
| `npm run dev:api` | Solo API |
| `npm run dev:web` | Solo interfaz |
| `npm run dev:demo` | Preparar cuentas para pruebas de la API demo; el panel web requiere sesión JWT |
| `npm run check` | Sintaxis backend y compilación frontend |
| `npm test` | Contratos/configuración/demo; añadir `TEST_DATABASE_URL` para incluir Storage con BD real |
| `npm run test:storage` | Ejecutar todas las pruebas, incluida la integración de Auth y Storage, con PostgreSQL local en 5433; crea y elimina una base temporal propia |
| `npm run test:organization-browser` | Recorrido actual en Edge/Chromium: cuentas, subida asíncrona, cuotas, álbumes, papelera, contraseña y móvil, con API/PostgreSQL/Sharp reales y base temporal |
| `npm run test:browser` | Recorrido histórico del 30%, anterior a verificación obligatoria y subidas asíncronas; para la interfaz actual usar `test:organization-browser` |
| `npm run test:frontend` | Regresiones de sesión, formularios, arrastre y procesos con API simulada; usa Edge en Windows o `E2E_BROWSER_CHANNEL`, sin tocar la BD |
| `npm run worker:images` | BullMQ/Sharp, publicación privada y recuperación automática; requiere Redis y todas las migraciones hasta 007; ver [cuotas](docs/worker-cuotas.md) |
| `npm run worker:recover` | Un barrido de recuperación/limpieza; conserva UUID e intentos de PostgreSQL |
| `npm run build` | Compilación de React en `frontend/dist` |
| `npm run db:migrate` | Aplicar migraciones a la BD configurada |
| `npm run db:seed:demo` | Preparar las dos cuentas locales sin activar la demostración |

Para verificar la versión actual, con PostgreSQL y Redis locales activos:

```powershell
npm run check
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'
npm run test:storage
Remove-Item Env:TEST_REDIS_URL
npm run test:frontend
npm run test:organization-browser
```

Los supervisores de Storage y navegador requieren PostgreSQL local en **5433** y un usuario que pueda crear bases temporales; no migran la base del equipo. Sin `TEST_REDIS_URL`, las pruebas de Redis se omiten. La prueba de frontend usa una API simulada; el recorrido de organización usa API/PostgreSQL/Sharp reales con entrega controlada al procesador y correo capturado, sin envío SMTP externo. En Windows usan Edge por defecto; en otros sistemas se necesita Chromium de Playwright (`npx playwright install chromium`).

El frontend usa el proxy `/api` de Vite hacia `127.0.0.1:3000`. Si cambia el puerto del backend, actualizar `API_PROXY_TARGET` en `frontend/.env` y reiniciar Vite. `frontend/dist` es solo la interfaz: el despliegue deberá proporcionar la API y configurar `/api` en el servidor frontal.

La [guía de Alegría](docs/frontend-auth-jobs-handoff.md) distingue lo implementado, los contratos que debe conservar y sus tareas pendientes. El detalle adicional está en [autenticación](docs/auth-frontend.md), [API](docs/api.md), [OpenAPI de trabajos/cuotas/borrado](docs/contracts/jobs.openapi.json) y [evidencia de organización](docs/organizacion-frontend.md).

## Organización

```text
frontend/src/
  app/                     Navegación, estructura visual y portada
  styles/                  Tema, reglas globales y componentes compartidos
  components/              Componentes compartidos
  features/                auth, storage, subscriptions; estilos propios por módulo
  services/                Cliente HTTP
backend/
  src/
    config/                Entorno y PostgreSQL
    middleware/            Autenticación y errores
    modules/               auth, storage, quotas, subscriptions
    workers/               Conversión, reconciliación y limpieza de trabajos
  migrations/              Esquema y datos iniciales versionados
  scripts/                 Migraciones y comprobación de sintaxis
  tests/                   Pruebas HTTP/configuración
storage/                   WebP privados y .tmp/; datos ignorados por Git
docs/                      Decisiones, contratos y alcance del avance
```

Cada módulo del backend sigue rutas → controladores → servicios → repositorios. Los controladores hablan HTTP; los servicios implementan reglas de negocio; los repositorios acceden a PostgreSQL. Todos usan el mismo `Pool`.

## Decisiones confirmadas

- Deduplicación **global** mediante SHA-256 del original.
- Una imagen lógica por cuenta referencia un objeto físico compartido.
- Solo se conserva el **WebP definitivo**; el original se elimina tras el procesamiento.
- Solo se persiste el tamaño original como métrica; el tamaño WebP se consulta en disco y el ahorro se calcula para el administrador.
- Almacenamiento privado: conocer un hash no concede acceso a una imagen.
- Free: 2 GB lógicos, máximo 10 subidas y 200 MB diarios. Los precios definitivos de planes pagados siguen pendientes.

Ver [guía de Storage y demostración](docs/storage.md), [decisiones y cálculo del ahorro](docs/decisiones.md), [contratos de API](docs/api.md), [tareas del avance del 30 %](docs/avance-30.md) y [verificaciones realizadas](docs/verificacion.md).

## Para trabajar en equipo

Para conciliar el Excel de Drive, GitHub y Trello, escribe **`Sincroniza SmartStorage`**
en Codex abierto en este proyecto. Consulta las reglas en
[sincronización de SmartStorage](docs/sincronizacion-smartstorage.md).
Es un comando del asistente a pedido; no programa ejecuciones automáticas.

Andy mantiene autenticación y sus correcciones ya están incorporadas. Geovanny mantiene Storage, álbumes y workers; Elden, cuotas/planes; Diego Alegría, presentación visual e integración del frontend. Continuar desde la base compartida de `tema-y-flujo-git` y acordar la revisión antes de integrar a `main`.

Crear ramas por tarea, mantener las migraciones coordinadas y revisar al menos con un compañero antes de integrar a `main`. No subir `.env`, imágenes de usuarios, contraseñas o `node_modules`. El archivo `package-lock.json` se versiona para instalar las mismas dependencias con `npm ci`.

Seguir la [guía de Git del equipo](docs/flujo-git.md) para abrir ramas, recibir cambios y preparar un pull request. Alegría puede modificar los colores en `frontend/src/styles/theme.css`; la [guía de estilos](docs/estilos.md) explica la separación entre tema, componentes y pantallas.

Redis está disponible mediante `docker compose --profile worker up -d postgres redis`. El [worker y las cuotas compartidas](docs/worker-cuotas.md) admiten `POST /api/jobs`, publican referencias privadas y recuperan interrupciones. Arranca el consumidor con `npm run worker:images`; la API y el worker deben compartir PostgreSQL y almacenamiento.

Alegría puede continuar con la [lista vigente de tareas del frontend](docs/frontend-auth-jobs-handoff.md#tareas-pendientes-de-alegría). Subida asíncrona, cuotas, álbumes, papelera y cambio de contraseña ya están conectados; queda el acabado visual y la revisión de su integración.

## Primera versión funcional: v0.1.0 (30%)

El corte histórico v0.1.0 contiene registro, acceso, Free y Storage síncrono. Consultar [sistemas listos y cómo reportarlos](docs/estado-sistemas.md) y [aceptación reproducible](docs/aceptacion-30.md). Los cambios posteriores del worker y cuotas se desarrollan en `tema-y-flujo-git`. La entrega académica se acredita por separado.
