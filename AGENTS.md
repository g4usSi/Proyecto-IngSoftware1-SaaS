# SmartStorage — guía del equipo y de sus agentes

Proyecto de Ingeniería de Software I (URL): almacenamiento de imágenes como
servicio con conversión a WebP, deduplicación global por SHA-256, cuotas por
plan y suscripciones con pago simulado. Este archivo resume cómo trabajamos.
Aplica a cada integrante y a cualquier agente de IA (Codex, Claude, Copilot…)
que abra el repositorio. Comunicarse en español.

## Equipo, ramas y tareas del cierre del 100 %

| Persona | Módulo | Rama de trabajo | Tarjetas de Trello |
| --- | --- | --- | --- |
| Geovanny | Storage, cuotas, workers, SDK, coordinación e integración | `tema-y-flujo-git` | S5-03, EX02 |
| Elden | Pagos y suscripciones (backend) | `feature/pagos-planes` | S5-02 · issues #9, #11 |
| Andy | Usuarios, perfil, administración y permisos (backend) | `feature/usuarios-login` | S5-01 · issues #8, #11 |
| Diego Alegría | Todo el frontend, manual de usuario y tienda Pulso | `feature/ui-tema` | S5-04 · issues #8, #12, #13 |
| Equipo | Pruebas integrales, entorno de demo, ensayo y entrega | — | S5-05 a S5-08 · issue #10 |

Las tarjetas explican qué hacer, qué endpoints usar y cuándo una tarea está
terminada: [tablero SmartStorage](https://trello.com/b/uOpp9rO7/smartstorage-proyecto-ing-software-i).

Fechas: el 80 % se presentó el 31/10 (`v0.3.0` en `main`). Cierre del 100 %: revisiones y pulido de
issues del equipo hasta el **viernes 06/11**; entrega final el **miércoles 11/11/2026**. La demostración corre en la PC de
Geovanny y se expone con un túnel gratuito de Cloudflare.
Estado técnico e issues pendientes: `docs/estado-sistemas.md`.

La demostración del SDK es la tienda **Pulso**, en Python, en `sdk-python/tienda/`. Quien trabaje en
su interfaz debe leer antes [`sdk-python/tienda/AGENTS.md`](sdk-python/tienda/AGENTS.md).

## Flujo de ramas

- `tema-y-flujo-git` es la rama base compartida (“rama padre”). `main` guarda
  releases del curso (v0.1.0 = 30 %, v0.2.0 = 50 %, v0.3.0 = 80 %; v1.0.0 = 100 %).
- Cada quien trabaja en su rama. **Nadie integra a `tema-y-flujo-git` ni a
  `main`**: Geovanny integra cuando el módulo está terminado y probado.
- Traer cambios de la base a tu rama con frecuencia (`git merge
  origin/tema-y-flujo-git`) para evitar conflictos al final.
- Para probar con el backend de otro compañero, hacer merge de su rama **en tu
  propia rama**, nunca en la base.
- Sin `push --force`, `reset --hard` ni reescritura de historia compartida.
- Commits pequeños y descriptivos (`feat:`, `fix:`, `docs:`, `test:`), con el ID
  de la tarjeta cuando aplique, por ejemplo `feat(S4-02): checkout simulado`.

## Reglas técnicas que no se negocian

- **Migraciones:** nunca editar una migración publicada; agregar una nueva y
  numerada. La última es `016_api_keys.sql`; la siguiente libre es `017_*`.
  Avisar en el grupo antes de crear otra.
- **Capas del backend:** rutas → controladores → servicios → repositorios. SQL
  solo en repositorios.
- **Contrato de la API:** base `/api`; éxito `{ "data": ... }`; error
  `{ "error": { "code", "message" } }`. Sin sesión: 401. Sin permiso: 403.
  Recurso ajeno: 404. Documentar cada endpoint nuevo en `docs/api.md` (pagos)
  o en `docs/auth-frontend.md` (usuarios).
- **Precios y planes:** se resuelven en el servidor, nunca desde la interfaz.
  Catálogo aprobado en USD: Free US$0 (2 GB, 10 cargas y 200 MB diarios),
  Estándar US$8 (25 GB, 500 MB diarios), Pro US$15 (100 GB), Enterprise US$40
  (200 GB incluidos; US$0.20 por GB-mes adicional publicado, sin medir ni
  cobrar). No volver a quetzales.
- **Cuotas:** la capacidad cuenta originales lógicos (incluida la papelera) más
  reservas pendientes; el día de consumo se calcula en `America/Guatemala`;
  orden de bloqueo trabajo → usuario → objeto; operaciones idempotentes.
- **Privacidad:** solo el propietario accede a sus imágenes; conocer un hash
  no concede acceso. Nunca publicar `storage/` como contenido estático.
- **Secretos:** no subir `.env`, contraseñas, tokens, enlaces de recuperación,
  dumps de la base ni datos de usuarios. No copiarlos en documentos o capturas.
- **Correo:** `backend/.env` puede tener credenciales reales de Brevo. Las pruebas
  nunca envían correo (`no-real-smtp.js`); al ejecutar la app, cada pago aprobado
  y cada registro sí envían uno real, así que evita correos ficticios con SMTP activo.
- **Datos locales:** no usar `docker compose down -v` ni borrar volúmenes.
  Cambiar de rama no revierte el esquema: antes de migrar, respaldar con
  `pg_dump` y guardar el respaldo fuera del repositorio.

## Ejecutar y probar

Requisitos: Node.js 24, npm 11, Docker Desktop. Desde la raíz:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
docker compose --profile worker up -d --wait postgres redis
npm run db:migrate          # con API y worker detenidos
npm run dev                 # terminal 1: API :3000 + frontend :5173
npm run worker:images       # terminal 2: procesamiento de imágenes
```

Antes de pedir revisión de tu rama:

```powershell
npm run check
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'; npm run test:storage
npm run test:frontend       # si tocaste la interfaz
```

Detalle en `README.md`, `docs/api.md`, `docs/auth-frontend.md`,
`docs/frontend-80-contratos.md`, `docs/sdk.md`, `sdk-python/README.md`, `docs/storage.md`,
`docs/worker-cuotas.md` y `docs/flujo-git.md`. `docs/historial/` guarda el registro de entregas pasadas por
responsable: es historia, no contrato vigente, y no se usa para decidir cómo funciona
el sistema.

## Definición de terminado

Una tarjeta pasa a **Hecho** cuando: (1) el alcance de la tarjeta funciona en tu
rama publicada; (2) hay pruebas que pasan y anotaste en la tarjeta el commit y
el resultado; (3) los endpoints o pantallas nuevos están documentados. No hace
falta esperar a `main` ni a la integración del frontend para cerrar el backend.
Un defecto propio sí impide el cierre.

## Instrucciones para agentes de IA

1. Leer este archivo y `README.md`; después, la tarjeta de Trello o el issue de la tarea. Si la
   carpeta tiene su propio `AGENTS.md` (por ejemplo `sdk-python/tienda/`), leerlo también.
2. Ejecutar `git status` y confirmar la rama antes de editar. Conservar los
   cambios locales de la persona; no descartar trabajo ajeno.
3. Trabajar solo dentro del alcance de la tarea pedida y del módulo de su
   responsable. No modificar módulos de otros integrantes sin acuerdo.
4. No hacer merge a `tema-y-flujo-git` o `main`, push, force push, borrar ramas,
   ni editar migraciones publicadas sin una instrucción explícita.
5. Al terminar, dejar un resumen: rama y commit, archivos tocados, comandos de
   prueba con su resultado, endpoints nuevos y pendientes.
6. Distinguir lo probado de verdad (PostgreSQL/Redis reales) de lo simulado,
   y no afirmar que algo funciona sin haberlo ejecutado.
7. `Sincroniza SmartStorage` es un comando reservado a Geovanny para conciliar
   GitHub, Trello y el Excel de Drive según `docs/sincronizacion-smartstorage.md`;
   no ejecutarlo por iniciativa propia.
