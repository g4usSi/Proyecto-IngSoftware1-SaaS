# SmartStorage

Base del proyecto de Ingeniería de Software I: almacenamiento de imágenes con deduplicación global y conversión a WebP.

**Estado: avance funcional del 80 %, en `tema-y-flujo-git`.** La última versión etiquetada en `main` es `v0.2.0` (50 %). Estado detallado y pendientes: [estado de sistemas](docs/estado-sistemas.md). La sesión del navegador vive en memoria: al recargar hay que iniciar sesión de nuevo.

## Qué funciona

- **Cuentas:** registro con plan Free, verificación de correo, inicio y cierre de sesión con JWT, recuperación y cambio de contraseña, perfil y roles de cliente y administrador.
- **Imágenes:** JPG, PNG y WebP estáticos de hasta 25 MB, conversión asíncrona a WebP con Redis, BullMQ y Sharp, recuperación tras interrupciones, deduplicación global por SHA-256 y descarga privada.
- **Organización:** álbumes, movimiento de imágenes, papelera, restauración y borrado definitivo.
- **Cuotas:** capacidad y límites diarios por plan, con reservas transaccionales compartidas entre ambas rutas de subida.
- **Planes y pagos simulados:** catálogo en USD, contratación, renovación y cambio de plan con tarjetas de prueba, historial y facturas PDF, descargables y enviadas por correo.
- **Consumo y ahorro:** espacio lógico frente a físico, ahorro acumulado e imágenes duplicadas.
- **Administración:** métricas globales, usuarios, suscripciones, consumo por cuenta, cola de procesamiento y bitácora.
- **Interfaz:** React con tema claro y oscuro, adaptable a móvil y con estados de carga.

Pendiente: SDK y claves de API, HTTPS y despliegue público, y medición de rendimiento y disponibilidad. Enterprise publica una tarifa por GB-mes adicional que no se mide ni se cobra.

## Arranque rápido

Requisitos: **Node.js 24, npm 11 o superior, PostgreSQL 17/18 y Redis**. Para los comandos siguientes, abrir Docker Desktop y usar PowerShell desde la raíz del repositorio. Docker ejecuta PostgreSQL/Redis; Node ejecuta la API, el frontend y el worker. El desarrollo compartido está en `tema-y-flujo-git`; conservar cualquier cambio local antes de cambiar de rama.

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
| `SMTP_*` | Configurar las cinco variables para enviar correo con Brevo: verificación, recuperación y facturas de pago. En desarrollo, si todas están vacías, los enlaces aparecen en la terminal de la API y las facturas no se envían. |

No sobrescribir un `.env` existente. `npm ci` instala ambos módulos; no hace falta instalar dentro de cada carpeta. Usar `npm.cmd` si PowerShell bloquea `npm.ps1`. En macOS/Linux, copiar el ejemplo con el comando equivalente sólo si el destino no existe.

### 2. Levantar servicios y aplicar migraciones

Con la API y el worker detenidos:

```powershell
docker compose --profile worker up -d --wait postgres redis
npm run db:migrate
```

Compose espera a que los servicios estén listos. PostgreSQL se expone en **5433** y Redis en **6379**, sólo en localhost. El comando aplica todas las migraciones pendientes, hasta `014_auth_events.sql`, y conserva el historial. No modificar migraciones ya aplicadas.

### 3. Ejecutar la aplicación en dos terminales

**Terminal 1 — API y frontend**, desde la raíz:

```powershell
npm run dev
```

**Terminal 2 — procesamiento de imágenes**, también desde la raíz:

```powershell
npm run worker:images
```

Mantener ambas abiertas. `npm run dev` no inicia el worker: sin él las subidas admitidas quedan pendientes de procesamiento y aparecen en la biblioteca cuando se publican.

- Portada: <http://127.0.0.1:5173/>
- Panel: <http://127.0.0.1:5173/app>
- Planes y pagos: <http://127.0.0.1:5173/app/plans> y <http://127.0.0.1:5173/app/payments>
- Administración, con rol `admin`: <http://127.0.0.1:5173/app/admin>
- Estado del servidor: <http://127.0.0.1:3000/api/health>
- Disponibilidad de PostgreSQL: <http://127.0.0.1:3000/api/ready>
- Catálogo real: <http://127.0.0.1:3000/api/plans>

`/api/health` confirma que la API funciona; `/api/ready` devuelve `503` hasta configurar una conexión PostgreSQL válida. Storage y el catálogo requieren además ejecutar migraciones.

Crear una cuenta, abrir su enlace de verificación y luego iniciar sesión. Sin SMTP configurado en desarrollo, copiar el enlace que imprime la terminal 1. La sesión vive en memoria: al recargar hay que iniciar sesión otra vez; los trabajos ya admitidos permanecen en el servidor.

El registro siempre crea clientes. Para probar la administración, promover una cuenta existente en la base: `UPDATE users SET role = 'admin' WHERE email = 'correo@dominio.com';` y volver a iniciar sesión. Pagos simulados: `4242424242424242` aprueba, `4000000000000002` rechaza y `4000000000000119` da error. Con SMTP configurado, cada pago aprobado envía un correo real al de la cuenta.

Los álbumes se guardan en PostgreSQL, incluidos los vacíos: cerrar el navegador, la API o el worker no los elimina. En Álbumes se muestra la cuenta actual; si falla la consulta, usar **Actualizar álbumes** o **Reintentar**. Una lista que no pudo cargarse se muestra como error, no como una cuenta sin álbumes.

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
| `npm run test:frontend` | Regresiones de sesión, formularios, arrastre, procesos, planes, pagos, perfil y administración con API simulada; usa Edge en Windows o `E2E_BROWSER_CHANNEL`, sin tocar la BD |
| `npm run worker:images` | BullMQ/Sharp, publicación privada y recuperación automática; requiere Redis y todas las migraciones; ver [cuotas](docs/worker-cuotas.md) |
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

Los supervisores de Storage y navegador requieren PostgreSQL local en **5433** y un usuario que pueda crear bases temporales; no migran la base del equipo. Sin `TEST_REDIS_URL`, las pruebas de Redis se omiten. La prueba de frontend usa una API simulada; el recorrido de organización usa API/PostgreSQL/Sharp reales con entrega controlada al procesador y correo capturado. Ninguna prueba envía correo real, aunque `backend/.env` tenga credenciales SMTP. En Windows usan Edge por defecto; en otros sistemas se necesita Chromium de Playwright (`npx playwright install chromium`).

El frontend usa el proxy `/api` de Vite hacia `127.0.0.1:3000`. Si cambia el puerto del backend, actualizar `API_PROXY_TARGET` en `frontend/.env` y reiniciar Vite. `frontend/dist` es solo la interfaz: el despliegue deberá proporcionar la API y configurar `/api` en el servidor frontal.

## Organización

```text
frontend/src/
  app/                     Navegación, estructura visual y portada
  styles/                  Tema, reglas globales y componentes compartidos
  components/              Componentes compartidos
  features/                admin, auth, storage, subscriptions; estilos propios por módulo
  services/                Cliente HTTP
backend/
  src/
    config/                Entorno y PostgreSQL
    middleware/            Autenticación y errores
    modules/               admin, audit, auth, quotas, storage, subscriptions, users
    workers/               Conversión, reconciliación y limpieza de trabajos
  assets/                  Logo PNG para correos
  migrations/              Esquema y datos iniciales versionados
  scripts/                 Migraciones y comprobación de sintaxis
  tests/                   Pruebas HTTP/configuración
storage/                   WebP privados y .tmp/; datos ignorados por Git
docs/                      Contratos, decisiones, guías y historial por responsable
```

Cada módulo del backend sigue rutas → controladores → servicios → repositorios. Los controladores hablan HTTP; los servicios implementan reglas de negocio; los repositorios acceden a PostgreSQL. Todos usan el mismo `Pool`.

## Decisiones confirmadas

- Deduplicación **global** mediante SHA-256 del original.
- Una imagen lógica por cuenta referencia un objeto físico compartido.
- Solo se conserva el **WebP definitivo**; el original se elimina tras el procesamiento.
- Solo se persiste el tamaño original como métrica; el tamaño WebP se consulta en disco y el ahorro se calcula al consultarlo.
- Almacenamiento privado: conocer un hash no concede acceso a una imagen.
- Free: 2 GB lógicos, máximo 10 subidas y 200 MB diarios. El catálogo incluye también Estándar, Pro y Enterprise; consultar [precios, vigencia y cuotas](docs/planes-pagados-s4-01.md).

## Documentación

| Documento | Contenido |
| --- | --- |
| [Estado de sistemas](docs/estado-sistemas.md) | Avance, última verificación, pendientes y cómo reportar |
| [API](docs/api.md) | Referencia de todas las rutas |
| [Contratos del frontend](docs/frontend-80-contratos.md) | Formatos y reglas para las pantallas |
| [Autenticación](docs/auth-frontend.md) y [permisos](docs/permisos-api.md) | Cuentas, errores y matriz de acceso |
| [Storage](docs/storage.md) y [worker y cuotas](docs/worker-cuotas.md) | Almacenamiento, cola, recuperación y cuotas |
| [Catálogo de planes](docs/planes-pagados-s4-01.md) | Precios, vigencia y Enterprise |
| [Decisiones](docs/decisiones.md) | Acuerdos del equipo y cálculo del ahorro |
| [Estilos](docs/estilos.md) | Tema, colores y componentes |
| [Flujo de Git](docs/flujo-git.md) | Ramas y pull requests |
| [Sincronización](docs/sincronizacion-smartstorage.md) | Excel de Drive, GitHub y Trello |
| Historial: [Geovanny](docs/historial/geovanny.md), [Elden](docs/historial/elden.md), [Andy](docs/historial/andy.md), [Alegría](docs/historial/alegria.md) | Entregas pasadas y su evidencia |

## Para trabajar en equipo

Para conciliar el Excel de Drive, GitHub y Trello, escribe **`Sincroniza SmartStorage`**
en Codex abierto en este proyecto. Consulta las reglas en
[sincronización de SmartStorage](docs/sincronizacion-smartstorage.md).
Es un comando del asistente a pedido; no programa ejecuciones automáticas.

Andy mantiene usuarios, perfil, administración y permisos; Geovanny, Storage, cuotas, workers e integración; Elden, pagos y suscripciones; Diego Alegría, todo el frontend. Continuar desde la base compartida de `tema-y-flujo-git` y acordar la revisión antes de integrar a `main`.

Crear ramas por tarea, mantener las migraciones coordinadas y revisar al menos con un compañero antes de integrar a `main`. No subir `.env`, imágenes de usuarios, contraseñas o `node_modules`. El archivo `package-lock.json` se versiona para instalar las mismas dependencias con `npm ci`.

Seguir la [guía de Git del equipo](docs/flujo-git.md) para abrir ramas, recibir cambios y preparar un pull request. Alegría puede modificar los colores en `frontend/src/styles/theme.css`; la [guía de estilos](docs/estilos.md) explica la separación entre tema, componentes y pantallas.
