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

Pagos y álbumes siguen pendientes. Alegría debe conectar la admisión asíncrona, los indicadores de cuotas y el borrado a la interfaz: [guía de contratos pendientes](docs/frontend-auth-jobs-handoff.md). El frontend de esta entrega se conserva sin modificaciones.

## Arranque rápido

Requisitos: Node.js 24 y npm 11. PostgreSQL 17 o 18 se necesita para Storage, migraciones y catálogo, pero la interfaz y `/api/health` pueden arrancar sin base de datos.

Desde la raíz:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
npm run dev
```

Este único `npm ci` instala las dependencias del frontend y backend, incluidas BullMQ, ioredis y Nodemailer.

En macOS/Linux, copiar el ejemplo solo si aún no existe `.env`. Usar `npm.cmd` si la política local de PowerShell impide ejecutar `npm.ps1`.

- Portada: <http://127.0.0.1:5173/>
- Panel: <http://127.0.0.1:5173/app>
- Estado del servidor: <http://127.0.0.1:3000/api/health>
- Disponibilidad de PostgreSQL: <http://127.0.0.1:3000/api/ready>
- Catálogo real: <http://127.0.0.1:3000/api/plans>

`/api/health` confirma que la API funciona; `/api/ready` devuelve `503` hasta configurar una conexión PostgreSQL válida. Storage y el catálogo requieren además ejecutar migraciones.

### Base de datos con Docker (opcional)

```powershell
docker compose --profile worker up -d postgres redis
npm run db:migrate
npm run dev
# Otra terminal:
npm run worker:images
```

La configuración de ejemplo coincide con `compose.yaml`: puerto **5433** en el equipo para evitar el 5432 de una instalación existente, base/usuario `smartstorage` y contraseña de desarrollo `smartstorage_local`. El servicio se expone solo en localhost; esas credenciales son exclusivamente locales. Docker Desktop debe estar instalado y en ejecución para este camino. No se requiere Docker para Node o React.

Aplicar las migraciones con API/workers detenidos y luego iniciar ambos procesos. API y worker deben compartir PostgreSQL y `STORAGE_ROOT`. El frontend actual aún usa la subida síncrona; el nuevo contrato asíncrono ya se puede consumir desde la rama de Alegría.

`dev:demo` prepara dos identidades locales para pruebas de Storage por API y activa la cabecera `X-Storage-Demo-User` sólo durante ese comando. No crea sesiones JWT ni habilita el panel web sin login. Ver [límites de esa herramienta](docs/storage.md). `npm run dev` la mantiene desactivada.

Para usar el login real, configura un `JWT_SECRET` propio de al menos 32 caracteres en `backend/.env`. El ejemplo incluido debe reemplazarse antes de compartir o desplegar la aplicación. Sin ese valor, las rutas de autenticación protegidas devuelven `503`.

Al iniciar o reiniciar la API en desarrollo, la terminal muestra las direcciones de la API, la portada y el panel. En modo demo también muestra el enlace directo a la biblioteca: <http://127.0.0.1:5173/app/storage>. Vite imprime su dirección cuando arranca.

### Base de datos instalada localmente

Crear una base de desarrollo vacía, por ejemplo con la utilidad `createdb` de PostgreSQL:

```powershell
createdb -h 127.0.0.1 -p 5432 -U postgres smartstorage
```

Editar `DATABASE_URL` en `backend/.env` usando el usuario, contraseña y puerto de esa instalación. Codificar los caracteres especiales de la contraseña para URL. Después ejecutar `npm run db:migrate`. No apuntar las migraciones a una base ajena o de producción.

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
| `npm run test:browser` | Recorrido en navegador real, con PostgreSQL aislado y evidencia local; ver [instrucciones](docs/aceptacion-30.md) |
| `npm run test:frontend` | Regresiones de sesión, formularios, arrastre y procesos con API simulada; usa Edge en Windows o `E2E_BROWSER_CHANNEL`, sin tocar la BD |
| `npm run worker:images` | BullMQ/Sharp, publicación privada y recuperación automática; requiere Redis y todas las migraciones hasta 006; ver [cuotas](docs/worker-cuotas.md) |
| `npm run worker:recover` | Un barrido de recuperación/limpieza; conserva UUID e intentos de PostgreSQL |
| `npm run build` | Compilación de React en `frontend/dist` |
| `npm run db:migrate` | Aplicar migraciones a la BD configurada |
| `npm run db:seed:demo` | Preparar las dos cuentas locales sin activar la demostración |

El frontend usa el proxy `/api` de Vite hacia `127.0.0.1:3000`. Si cambia el puerto del backend, actualizar `API_PROXY_TARGET` en `frontend/.env` y reiniciar Vite. `frontend/dist` es solo la interfaz: el despliegue deberá proporcionar la API y configurar `/api` en el servidor frontal.

Los contratos del backend están en [autenticación](docs/auth-frontend.md), [API](docs/api.md) y [OpenAPI de trabajos/cuotas/borrado](docs/contracts/jobs.openapi.json). La [guía de Alegría](docs/frontend-auth-jobs-handoff.md) enumera sólo el trabajo pendiente.

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
    modules/               auth, storage, subscriptions
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

Andy continúa la verificación de correo y recuperación sobre el módulo de autenticación existente. Geovanny continúa Storage y workers; Elden, planes/suscripciones; Diego, frontend e integración. Cada trabajo nuevo parte de esta base compartida.

Crear ramas por tarea, mantener las migraciones coordinadas y revisar al menos con un compañero antes de integrar a `main`. No subir `.env`, imágenes de usuarios, contraseñas o `node_modules`. El archivo `package-lock.json` se versiona para instalar las mismas dependencias con `npm ci`.

Seguir la [guía de Git del equipo](docs/flujo-git.md) para abrir ramas, recibir cambios y preparar un pull request. Alegría puede modificar los colores en `frontend/src/styles/theme.css`; la [guía de estilos](docs/estilos.md) explica la separación entre tema, componentes y pantallas.

Redis está disponible mediante `docker compose --profile worker up -d postgres redis`. El [worker y las cuotas compartidas](docs/worker-cuotas.md) admiten `POST /api/jobs`, publican referencias privadas y recuperan interrupciones. Arranca el consumidor con `npm run worker:images`; la API y el worker deben compartir PostgreSQL y almacenamiento.

Alegría puede consultar la [guía de contratos pendientes del frontend](docs/frontend-auth-jobs-handoff.md). El frontend actual conserva su carga síncrona hasta que conecte el nuevo contrato.

## Primera versión funcional: v0.1.0 (30%)

El corte histórico v0.1.0 contiene registro, acceso, Free y Storage síncrono. Consultar [sistemas listos y cómo reportarlos](docs/estado-sistemas.md) y [aceptación reproducible](docs/aceptacion-30.md). Los cambios posteriores del worker y cuotas se desarrollan en `tema-y-flujo-git`. La entrega académica se acredita por separado.
