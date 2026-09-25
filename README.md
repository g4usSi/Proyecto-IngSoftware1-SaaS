# SmartStorage

Base del proyecto de Ingeniería de Software I: almacenamiento de imágenes con deduplicación global y conversión a WebP.

**Estado: backend de autenticación y Storage integrados.** El registro asigna el plan Free y, tras iniciar sesión, un token JWT permite subir y descargar imágenes. La interfaz de login sigue pendiente de conectar por Alegría.

## Qué funciona

- Aplicación React con navegación y estilos basados en el HTML de mockups del equipo.
- Servidor Express con comprobación de estado, disponibilidad de PostgreSQL y consulta del catálogo.
- Esquema inicial, plan Free y ejecución de migraciones con historial.
- Separación por módulos y capas, cliente HTTP común y respuestas de error uniformes.
- Subida de imágenes estáticas JPG/PNG/WebP de hasta 25 MB y conversión a WebP calidad 80.
- Listado paginado, descarga del propietario, cuotas transaccionales y deduplicación entre cuentas.
- Metadatos en PostgreSQL, archivos privados en `storage/` y ahorro calculado para administrador.
- Demostración local opcional con dos cuentas y selector explícito en la biblioteca.
- Registro, login, cierre de sesión y acceso privado mediante JWT; cada cuenta nueva recibe Free.

La interfaz de registro/login, los pagos, el borrado y los workers **están pendientes**. El backend ya admite el recorrido real mediante API; la demostración sigue siendo una alternativa local para probar la biblioteca desde el navegador.

## Arranque rápido

Requisitos: Node.js 24 y npm 11. PostgreSQL 17 o 18 se necesita para Storage, migraciones y catálogo, pero la interfaz y `/api/health` pueden arrancar sin base de datos.

Desde la raíz:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
npm run dev
```

En macOS/Linux, copiar el ejemplo solo si aún no existe `.env`. Usar `npm.cmd` si la política local de PowerShell impide ejecutar `npm.ps1`.

- Interfaz: <http://localhost:5173>
- Estado del servidor: <http://127.0.0.1:3000/api/health>
- Disponibilidad de PostgreSQL: <http://127.0.0.1:3000/api/ready>
- Catálogo real: <http://127.0.0.1:3000/api/plans>

`/api/health` confirma que la API funciona; `/api/ready` devuelve `503` hasta configurar una conexión PostgreSQL válida. Storage y el catálogo requieren además ejecutar migraciones.

### Base de datos con Docker (opcional)

```powershell
docker compose up -d postgres
npm run db:migrate
npm run dev:demo
```

La configuración de ejemplo coincide con `compose.yaml`: puerto **5433** en el equipo para evitar el 5432 de una instalación existente, base/usuario `smartstorage` y contraseña de desarrollo `smartstorage_local`. El servicio se expone solo en localhost; esas credenciales son exclusivamente locales. Docker Desktop debe estar instalado y en ejecución para este camino. No se requiere Docker para Node o React.

`dev:demo` prepara dos cuentas locales y arranca API + frontend con la demostración habilitada **solo durante ese comando**. En Mi biblioteca, seleccionar Demo Storage A o B, subir una imagen y descargar su WebP. Repetir con la otra cuenta y el mismo archivo conserva una sola copia física. Las cuentas y sus imágenes persisten entre ejecuciones. `npm run dev` arranca con la demo desactivada por defecto. No hay contraseñas demo ni acceso al panel administrativo mediante esas cuentas.

Para usar el login real, configura un `JWT_SECRET` propio de al menos 32 caracteres en `backend/.env`. El ejemplo incluido debe reemplazarse antes de compartir o desplegar la aplicación. Sin ese valor, las rutas de autenticación protegidas devuelven `503`.

Al iniciar o reiniciar la API en modo demo, la terminal muestra la dirección de la API y el enlace directo al frontend: <http://127.0.0.1:5173/app/storage>. Vite también imprime su dirección cuando arranca.

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
| `npm run dev:demo` | Preparar dos cuentas y ejecutar la demostración local de Storage |
| `npm run check` | Sintaxis backend y compilación frontend |
| `npm test` | Contratos/configuración/demo; añadir `TEST_DATABASE_URL` para incluir Storage con BD real |
| `npm run test:storage` | Ejecutar todas las pruebas, incluida la integración de Auth y Storage, con PostgreSQL local en 5433; crea y elimina una base temporal propia |
| `npm run build` | Compilación de React en `frontend/dist` |
| `npm run db:migrate` | Aplicar migraciones a la BD configurada |
| `npm run db:seed:demo` | Preparar las dos cuentas locales sin activar la demostración |

El frontend usa el proxy `/api` de Vite hacia `127.0.0.1:3000`. Si cambia el puerto del backend, actualizar `API_PROXY_TARGET` en `frontend/.env` y reiniciar Vite. `frontend/dist` es solo la interfaz: el despliegue deberá proporcionar la API y configurar `/api` en el servidor frontal.

Para conectar el login real y adaptar las pantallas, comenzar por [el traspaso al frontend](docs/frontend-handoff.md). Los contratos detallados están en [autenticación](docs/auth-frontend.md) y [API](docs/api.md).

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
    workers/               Punto de extensión documentado
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

Andy puede iniciar el módulo `backend/src/modules/auth/` usando el contrato de `requireAuth`. Geovanny continúa Storage; Elden, planes/suscripciones; Diego, frontend e integración. Cada trabajo nuevo parte de esta base compartida.

Crear ramas por tarea, mantener las migraciones coordinadas y revisar al menos con un compañero antes de integrar a `main`. No subir `.env`, imágenes de usuarios, contraseñas o `node_modules`. El archivo `package-lock.json` se versiona para instalar las mismas dependencias con `npm ci`.

Seguir la [guía de Git del equipo](docs/flujo-git.md) para abrir ramas, recibir cambios y preparar un pull request. Alegría puede modificar los colores en `frontend/src/styles/theme.css`; la [guía de estilos](docs/estilos.md) explica la separación entre tema, componentes y pantallas.

Redis queda disponible mediante `docker compose --profile worker up -d`, pero todavía no hay worker ni colas implementadas.
