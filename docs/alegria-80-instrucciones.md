# Instrucciones para Alegría — cierre del 80 % (S4-06, S4-07, S4-09 y S4-10)

Guía de trabajo para el frontend. **Entrega del 80 %: sábado 31/10/2026.** Fechas internas (cierre 23:59, Guatemala):
S4-06 y S4-07 el **27/10**, regresión S4-09 el **29/10** (2 días antes de la entrega) y presentación S4-10 el **31/10**.
Se trabaja en **una sola rama: `frontend-80`**, que se unifica en `tema-y-flujo-git`. El backend del 80 % ya está **integrado en `tema-y-flujo-git`**
(PR #5 `integracion-80`, `bf0b86a`) y la suite completa pasa **196/196** con PostgreSQL y Redis reales.
Los endpoints exactos, con ejemplos de respuesta, están en [frontend-80-contratos.md](frontend-80-contratos.md);
esta guía dice **qué cambió, qué hay que construir y cómo trabajar**. Si algo difiere, manda el contrato de esa guía y
[api.md](api.md); los permisos están en [permisos-api.md](permisos-api.md).

## 1. Qué cambió en el backend (lo que afecta al frontend)

**Endpoints nuevos**

| Área | Endpoints |
| --- | --- |
| Suscripción | `GET /subscriptions/me`, `POST /subscriptions/checkout`, `POST /subscriptions/renew`, `POST /subscriptions/change-plan` |
| Pagos | `GET /payments` (historial), `GET /payments/:id/receipt` (PDF), `GET /payments/receipts` (PDF masivo) |
| Consumo y ahorro | `GET /files/summary` (lógico vs físico, ahorro) |
| Perfil | `PATCH /auth/me` (solo se edita el nombre) |
| Administración | `GET /admin/summary`, `/admin/subscriptions`, `/admin/usage`, `/admin/jobs`, `/admin/audit-events`, `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/status` |

**Cambios en contratos existentes**

- `GET /plans` publica **cuatro planes en USD** (`free`, `standard`, `pro`, `enterprise`). Ya no existen los precios en quetzales:
  ignora `monthlyPriceGtq`. Precios y bytes llegan como **strings** (`"8.00"`, `"25000000000"`).
- `GET /files` suma `hashPrefix`, `optimizedFormat` y `duplicate` en cada imagen (no existe el hash completo en la API).
- `GET /quotas/me` refleja el plan **vigente** según la suscripción; una suscripción de pago vencida vuelve a Free sin borrar imágenes.
- Una cuenta desactivada recibe `403 ACCOUNT_DISABLED` aunque tenga sesión abierta.
- Migraciones nuevas hasta la `014` (planes, pagos, bitácora). Hay que correr `npm run db:migrate` antes de probar.

**Lo que ya no sirve en el frontend**

- `frontend/src/features/subscriptions/plans.data.js` tiene precios en **Q** (Q35, Q100, Q300+) y marca los planes de pago como
  "Próximamente". Está obsoleto: los planes deben salir de `GET /plans`.
- `PlansPage.jsx` y `PlanPromotion.jsx` asumen que solo existe Free.

## 2. Preparar el entorno

```powershell
git switch tema-y-flujo-git
git pull --ff-only origin tema-y-flujo-git
git switch -c frontend-80                     # una sola rama para S4-06 y S4-07
npm ci
# Con API y worker detenidos, con PostgreSQL y Redis arriba (README, pasos 2 y 3):
npm run db:migrate
npm run dev                                   # API + frontend
npm run worker:images                         # en otra terminal
```

- **Cuenta administradora:** registra una cuenta normal, verifícala y promuévela en la base:
  `UPDATE users SET role='admin' WHERE email='tu@correo';` y vuelve a iniciar sesión.
- **Pagos simulados:** `4242424242424242` aprueba, `4000000000000002` rechaza, `4000000000000119` da error. Nunca pidas CVV ni
  muestres el número completo (solo `•••• cardLast4`).
- La rama de trabajo sale de **`tema-y-flujo-git`**, no de `main` (`main` sigue en la v0.2.0).

## 3. Qué construir

### S4-06 — Planes, contratación e historial de pagos

Archivos de partida: `features/subscriptions/PlansPage.jsx`, `plans.data.js`, `PlanPromotion.jsx`, `features/storage/QuotaSummary.jsx`.
Crea `features/subscriptions/subscriptions.api.js` con un cliente por endpoint, apoyado en `services/api.js` (ya envía el token y
emite el evento de 401).

- [ ] **Catálogo real:** `PlansPage` y la sección de planes de la landing leen `GET /plans`; precio en USD, capacidad, límite diario
  (`null` = sin límite) y Enterprise con "US$0.20 por GB-mes sobre 200 GB incluidos". Quita `plans.data.js` o déjalo solo como texto de marketing sin precios.
- [ ] **Plan activo:** `GET /subscriptions/me` para mostrar plan, inicio y vencimiento (`expiresAt: null` en Free). Resalta el plan actual y desactiva su botón.
- [ ] **Contratar:** formulario de tarjeta de prueba → `POST /subscriptions/checkout` con `Idempotency-Key` (UUID **por intento**; reutilízalo solo al reintentar el mismo intento).
  La API responde 201 aunque el pago sea rechazado: **decide el mensaje con `payment.status`** (`approved`, `rejected`, `error`).
- [ ] **Renovar:** botón visible solo si el plan no es Free (`400 SUBSCRIPTION_NOT_RENEWABLE` en Free) → `POST /subscriptions/renew`.
- [ ] **Cambiar de plan:** subir (con tarjeta) y bajar (sin cobro) → `POST /subscriptions/change-plan`.
  Si el servidor responde `409 PLAN_CAPACITY_EXCEEDED`, muestra "Libera al menos X" con `details.bytesToFree` formateado y bloquea la confirmación.
  La papelera cuenta como espacio usado.
- [ ] **Historial:** tabla con `GET /payments?page=&limit=` (fecha, plan, monto, estado, tarjeta, recibo) y paginación `{ page, limit, total, totalPages }`.
- [ ] **Recibos PDF:** descarga individual y masiva con `fetch` + cabecera `Authorization` + `blob` (un `<a href>` no envía el token).
  `409 RECEIPT_NOT_AVAILABLE` en pagos no aprobados y `404 NO_RECEIPTS` sin pagos: deshabilita el botón.
- [ ] **Refresco tras pagar:** vuelve a pedir `/subscriptions/me`, `/quotas/me` y `/payments`; actualiza la barra de uso del sidebar.
- [ ] **Ahorro y consumo (RF-STO-12 / RF-PAG-04):** `InsightsPage` y el resumen usan `GET /files/summary`
  (`logicalBytes` vs `physicalBytes`, `savedBytes`, `savedPercent`, `duplicateCount`). Si `unavailableObjectCount > 0` o `savedPercent` es `null`, muestra "no disponible", no un número inventado.
- [ ] **Galería (RF-STO-10):** muestra estado "duplicada" (`duplicate`) y la huella corta (`hashPrefix`) en el detalle.

### S4-07 — Administración, usuarios y perfil

Rutas nuevas bajo `/app` (agrégalas en `App.jsx` y en `titles`) y enlaces en `AppLayout`/`AccountMenu`.
El menú de administración solo se muestra si `session.user.role === 'admin'`; el servidor igual responde `403` a un cliente.

| Ruta sugerida | Endpoint | Contenido |
| --- | --- | --- |
| `/app/admin` | `GET /admin/summary`, `GET /admin/storage/stats` | Cuentas, suscripciones vigentes por plan, almacenamiento lógico/único/deduplicado, ahorro |
| `/app/admin/users` | `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/status` | Buscar, filtrar por estado, detalle, activar/desactivar (no a sí mismo) |
| `/app/admin/subscriptions` | `GET /admin/subscriptions` | Filtros por estado, plan y búsqueda; `current` |
| `/app/admin/usage` | `GET /admin/usage` | Usado, reservado, disponible y `usedPercent`; `plan: null` = "sin plan" |
| `/app/admin/jobs` | `GET /admin/jobs` | Cola global: estado, reintentos, usuario, `sharedObject` |
| `/app/admin/audit` | `GET /admin/audit-events` | Bitácora: inicio/cierre de sesión, fallos, cambios de contraseña y de estado de cuenta |
| `/app/profile` | `GET` y `PATCH /auth/me` | Editar solo el nombre; el correo es de solo lectura |

- [ ] Estados de **carga, vacío y error** en cada pantalla. **Nunca muestres ceros cuando la API falla:** muestra el error con "Volver a intentar".
- [ ] Respeta las **tres paginaciones distintas** (tabla en [frontend-80-contratos.md](frontend-80-contratos.md)): `page/pageSize`, `limit/offset` (con `total` como string) y `limit/cursor`.
- [ ] Muestra las unidades (bytes → GB con el formateador de `features/storage/format.js`) y las fechas en `America/Guatemala`.
- [ ] Probar el panel en **escritorio y móvil**.

### S4-09 — Regresión y revisión visual (con todo el equipo)

- [ ] Recorrer los flujos del 30 %, 50 % y 80 %: registro y verificación, login, subida asíncrona, álbumes, papelera, contratar, renovar, bajar de plan con consumo alto, historial, recibos, panel de administración.
- [ ] Revisión en tema claro y oscuro, escritorio y móvil.
- [ ] Anotar defectos con pasos, captura y pantalla; los de backend se avisan a Geovanny (planes/pagos: Elden; usuarios y permisos: Andy).

## 4. Reglas para toda pantalla

- `401` → cerrar sesión (ya lo hace `services/api.js` con el evento de 401). `403` en `/admin/*` → ocultar la opción; no es un error de red.
- Los bytes y los conteos grandes llegan como string: conviértelos con cuidado (`BigInt` o `Number` solo si caben).
- No guardes tokens ni datos de tarjeta en `localStorage`. No envíes precios desde la interfaz: los fija el servidor.
- Usa los estilos y componentes existentes ([estilos.md](estilos.md), `components/`, `styles/`) y respeta el tema claro/oscuro.

## 5. Cómo entregar

```powershell
git add frontend/src/features/subscriptions/ frontend/src/features/admin/ frontend/src/app/
git diff --cached
git commit -m "feat(S4-06): planes, contratación e historial de pagos"   # y luego otro commit para S4-07
git push -u origin frontend-80
```

Añade solo los archivos de tu tarea; no subas `.env` ni `node_modules`. Abre **un PR `frontend-80` → `tema-y-flujo-git`** y pide revisión a un compañero.
Antes de avisar que terminó, ejecuta y anota el resultado en la tarjeta de Trello (S4-06 / S4-07):

```powershell
npm run check            # sintaxis del backend y compilación del frontend
npm run test:frontend    # regresiones con API simulada (usa Edge en Windows)
```

Una tarea se considera **terminada** cuando el flujo funciona contra la API real (no solo con datos simulados), el PR está revisado y la tarjeta
tiene la evidencia (rama/commit, comandos y resultado, capturas). Las fechas ya están reprogramadas (ver arriba y las tarjetas de Trello).

## 6. S4-09 y S4-10 — regresión y constancia de entrega

**S4-09 (29/10, todo el equipo):** con `frontend-80` ya unificada en `tema-y-flujo-git`, Alegría recorre la interfaz integrada y cada integrante prueba su módulo.
Registrar en la tarjeta: rama y SHA, comandos ejecutados (`npm run check`, `npm run test:frontend`, `node --test`), resultados, defectos y capturas;
distinguir pruebas reales de simuladas. Los bloqueos se corrigen o se registran con evidencia.

**S4-10 (31/10, entrega):** corregir lo que dejó S4-09 y repetir esos casos; dejar una versión identificable (SHA o etiqueta), una demo reproducible y la
documentación coherente; cada integrante explica su módulo. **Registrar el enlace o la constancia de entrega** en la tarjeta; S4-10 se cierra después de presentar.

## 7. Manual de usuario (a cargo de Alegría)

Redactar `docs/manual-usuario.md` (o el formato que pida el curso), para el cliente y el administrador, con capturas reales de `frontend-80`:

- [ ] Registro, verificación de correo, inicio de sesión y recuperación de contraseña.
- [ ] Subir, ver, descargar, organizar en álbumes y mover a la papelera; consumo de espacio y ahorro.
- [ ] Planes: contratar con tarjeta de prueba, renovar, cambiar de plan, historial de pagos y recibos PDF.
- [ ] Perfil: editar el nombre.
- [ ] Administrador: panel, usuarios (activar/desactivar), suscripciones, consumo, trabajos y bitácora.
- [ ] Mensajes de error frecuentes (cuota excedida, pago rechazado, sesión vencida) y cómo resolverlos.

Fecha límite de borrador: **29/10**, para revisarlo en S4-09 y entregarlo con S4-10 el 31/10.
