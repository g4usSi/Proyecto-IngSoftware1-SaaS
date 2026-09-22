# SmartStorage

Base del proyecto de Ingeniería de Software I: almacenamiento de imágenes con deduplicación global y conversión a WebP.

**Estado: esqueleto ejecutable.** Esta entrega prepara el trabajo del equipo; todavía no es el avance funcional del 30 %. Se parte de cero y no se reutiliza el ZIP de autenticación generado previamente.

## Qué funciona

- Aplicación React con navegación y estilos basados en el HTML de mockups del equipo.
- Servidor Express con comprobación de estado, disponibilidad de PostgreSQL y consulta del catálogo.
- Esquema inicial, plan Free y ejecución de migraciones con historial.
- Separación por módulos y capas, cliente HTTP común y respuestas de error uniformes.

Registro, login, sesiones, subida, conversión, deduplicación, pagos y workers **están pendientes**. Las rutas reservadas responden `501`; nunca autentican ni simulan una operación exitosa. Las vistas iniciales de la aplicación no contienen datos privados ni una sesión ficticia.

## Arranque rápido

Requisitos: Node.js 24 y npm 11. PostgreSQL 17 o 18 se necesita para migraciones y catálogo, pero la interfaz y `/api/health` pueden arrancar sin base de datos.

Desde la raíz:

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
npm run dev
```

En macOS/Linux, sustituir `Copy-Item ...` por `cp backend/.env.example backend/.env`. Usar `npm.cmd` si la política local de PowerShell impide ejecutar `npm.ps1`.

- Interfaz: <http://localhost:5173>
- Estado del servidor: <http://127.0.0.1:3000/api/health>
- Disponibilidad de PostgreSQL: <http://127.0.0.1:3000/api/ready>
- Catálogo real: <http://127.0.0.1:3000/api/plans>

`/api/health` confirma que la API funciona; `/api/ready` devuelve `503` hasta configurar una conexión PostgreSQL válida. El catálogo requiere además ejecutar migraciones. No hay credenciales de usuario de demostración.

### Base de datos con Docker (opcional)

```powershell
docker compose up -d postgres
npm run db:migrate
```

La configuración de ejemplo coincide con `compose.yaml`: puerto **5433** en el equipo para evitar el 5432 de una instalación existente, base/usuario `smartstorage` y contraseña de desarrollo `smartstorage_local`. El servicio se expone solo en localhost; esas credenciales son exclusivamente locales. No se requiere Docker para Node o React.

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
| `npm run check` | Sintaxis backend y compilación frontend |
| `npm test` | Pruebas HTTP de contratos y configuración, sin una BD real |
| `npm run build` | Compilación de React en `frontend/dist` |
| `npm run db:migrate` | Aplicar migraciones a la BD configurada |

El frontend usa el proxy `/api` de Vite hacia `127.0.0.1:3000`. Si cambia el puerto del backend, actualizar `API_PROXY_TARGET` en `frontend/.env` y reiniciar Vite. `frontend/dist` es solo la interfaz: el despliegue deberá proporcionar la API y configurar `/api` en el servidor frontal.

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
    middleware/            Autenticación pendiente, errores
    modules/               auth, storage, subscriptions
    workers/               Punto de extensión documentado
  migrations/              Esquema y datos iniciales versionados
  scripts/                 Migraciones y comprobación de sintaxis
  tests/                   Pruebas HTTP/configuración
  data/                    Archivos privados y temporales; ignorados por Git
docs/                      Decisiones, contratos y alcance del avance
```

Cada módulo del backend sigue rutas → controladores → servicios → repositorios. Los controladores hablan HTTP; los servicios implementarán reglas de negocio; los repositorios acceden a PostgreSQL. Todos usan el mismo `Pool`.

## Decisiones confirmadas

- Deduplicación **global** mediante SHA-256 del original.
- Una imagen lógica por cuenta referencia un objeto físico compartido.
- Solo se conserva el **WebP definitivo**; el original se elimina tras el procesamiento.
- Solo se persiste el tamaño original como métrica; el tamaño WebP se consulta en disco y el ahorro se calcula para el administrador.
- Almacenamiento privado: conocer un hash no concede acceso a una imagen.
- Free: 2 GB lógicos, máximo 10 subidas y 200 MB diarios. Los precios definitivos de planes pagados siguen pendientes.

Ver [decisiones y cálculo del ahorro](docs/decisiones.md), [contratos de API](docs/api.md), [tareas del avance del 30 %](docs/avance-30.md) y [verificaciones realizadas](docs/verificacion.md).

## Para trabajar en equipo

Andy puede iniciar el módulo `backend/src/modules/auth/` usando el contrato de `requireAuth`. Geovanny continúa Storage; Elden, planes/suscripciones; Diego, frontend e integración. Cada trabajo nuevo parte de esta base compartida.

Crear ramas por tarea, mantener las migraciones coordinadas y revisar al menos con un compañero antes de integrar a `main`. No subir `.env`, imágenes de usuarios, contraseñas o `node_modules`. El archivo `package-lock.json` se versiona para instalar las mismas dependencias con `npm ci`.

Seguir la [guía de Git del equipo](docs/flujo-git.md) para abrir ramas, recibir cambios y preparar un pull request. Alegría puede modificar los colores en `frontend/src/styles/theme.css`; la [guía de estilos](docs/estilos.md) explica la separación entre tema, componentes y pantallas.

Redis queda disponible mediante `docker compose --profile worker up -d`, pero todavía no hay worker ni colas implementadas.
