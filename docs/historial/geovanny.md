# Historial de Geovanny: Storage, workers, cuotas, integración y cortes

Registro de entregas pasadas. No describe el comportamiento actual: para eso usar
[Storage](../storage.md), [worker y cuotas](../worker-cuotas.md) y [API](../api.md).
Consolida los antiguos `avance-30`, `aceptacion-30`, `verificacion`, `avance-50`,
`organizacion-frontend`, `s3-05-handoff`, `s3-11-handoff` y `cuotas-cambio-plan-s4-08`,
cuyo texto completo sigue en el historial de Git.

## Avance del 30 % y corte v0.1.0

**Alcance propuesto por el equipo** (el enunciado no detallaba una rúbrica): registrarse, iniciar sesión, recibir Free, cargar una imagen, verla en la galería y descargar su WebP; una subida idéntica reutiliza el objeto físico y el administrador consulta el ahorro. Decidir conservar solo WebP obligó a incluir una conversión funcional desde este avance.

| Integrante | Entrega |
| --- | --- |
| Andy | Registro, login, hash seguro, JWT y middleware |
| Geovanny | Validación JPG/PNG/WebP y 25 MB, SHA-256, WebP, deduplicación global, listado y descarga |
| Elden | Catálogo, asignación Free transaccional y límites |
| Diego Alegría | Pantallas, navegación, mensajes y revisión visual |

### Verificaciones

- **25/09/2026, Storage aislado:** `npm test` con BD temporal, 21 aprobadas. Autenticación inyectada y demo local; no cubría login real, pagos, Docker, borrado ni caídas. Docker no estaba instalado en ese entorno.
- **30/09/2026, S2-15:** sobre `b22e809`, Node 24.14, PostgreSQL 18 y Edge: `test:storage` 44/44, `test:browser` 10/10, `check` aprobado. Se corrigió el ahorro incorrecto cuando un WebP crece (38 B → 44 B se mostraba como «0 B menos»). [Evidencia](../evidencias/2026-09-30/resultado.json).
- **01/10/2026, corte `v0.1.0`:** desde `7c7f397`, con PostgreSQL 17.11 en Docker: 44/44 y 10/10. Redis y el worker no formaban parte del corte. [Evidencia](../evidencias/2026-10-01/resultado.json).

### Estado registrado en ese corte

| Sistema | Tareas |
| --- | --- |
| Base y esquema | S2-01 |
| Usuarios | S2-02, S2-03 |
| Free y cuotas | S2-04 a S2-06 |
| Storage | S2-07 a S2-10 |
| Interfaz | S2-11, S2-12 |
| Ahorro administrativo, solo API | S2-13 |
| Aceptación | S2-15 |
| Sesiones | S3-03 |

Quedaron abiertos S2-14 (Trello y Excel discrepaban sobre requisitos y diagramas) y la constancia de presentación de S2-16. La revisión de Alegría se registró como reportada por el usuario el 01/10, no como review formal de GitHub. No se acreditó despliegue ni caída abrupta del sistema.

## Procesamiento asíncrono y recuperación (S3-04, S3-05)

Redis, BullMQ, worker Sharp, estados persistentes `queued → processing → converted → published | failed`, reintentos y reconciliación desde PostgreSQL. La evidencia del 04/10 usó dobles de cuotas: [resultado](../evidencias/2026-10-04-s3-05/resultado.json).

## Integración de cuotas S3-08 y backend S3-11 (07/10/2026)

Base `tema-y-flujo-git` @ `6c2665b`, incorporando `feature/pagos-planes` @ `8911139` (aporte funcional de Elden: `5372a98`). Las correcciones que pidió Geovanny se implementaron en `codex/integrar-cuotas-s3-11`; no se atribuyen a la rama de Elden.

- Cuotas compartidas entre `POST /files` y `POST /jobs`, admisión y reserva atómicas, entrega recuperable a Redis y publicación, confirmación y `published` en la misma transacción.
- La migración 006 fija `usage_date`, vincula publicaciones y traslada el historial sin duplicar eventos. Se probó su repetición sobre un esquema anterior.
- `test:storage` **102/102** con PostgreSQL 17.11 y Redis 7.4.11 reales, incluidas caídas de un consumidor antes y después del COMMIT. No acredita apagón, despliegue ni SMTP real. [Evidencia](../evidencias/2026-10-07-s3-08-s3-11/resultado.json).

## Organización de imágenes (S3-07, S3-09, S3-10)

**07/10/2026**, partiendo de `979c604` e incorporando a Andy (`96f743e`, `69c7486`, merge `f31d233`): álbumes, movimiento, papelera, restauración, borrado definitivo y cambio de contraseña en la interfaz. `test:storage` 123/123, `test:frontend` aprobado y `test:organization-browser` 11/11. [Evidencia](../evidencias/2026-10-07-organizacion/resultado.json).

**08/10/2026**, integración de UI y persistencia de álbumes: en el incidente reportado, los álbumes seguían en PostgreSQL y no se reprodujo su pérdida. Se corrigió una debilidad distinta: el listado podía esperar indefinidamente. Se agregó plazo de 15 s, actualización manual, recuperación al volver a la pestaña y conservación de la última lista confirmada. `test:frontend` 18 recorridos, `test:organization-browser` 12. [Evidencia](../evidencias/2026-10-08-ui-albumes/resultado.json).

## Corte v0.2.0 — 50 % (09/10/2026)

Desde `tema-y-flujo-git` @ `3720ea9`. Reunió cuentas (Andy), procesamiento (Geovanny), cuotas (Elden y acoplamiento compartido), organización e interfaz (Alegría). El usuario confirmó el 09/10 la reunión y las correcciones, con lo que S3-11 quedó cerrada; esa revisión conjunta no equivale a un review de GitHub. S3-12 quedó lista para entregar, sin constancia de presentación registrada. [Evidencia](../evidencias/2026-10-09-v0.2.0/resultado.json).

## Consultas administrativas y cuotas al cambiar de plan (S4-04, S4-08)

**S4-08, 22/10/2026**, sobre `feature/pagos-planes` @ `ebea53f`: 12 aprobadas y 1 `todo`; suite de backend 163 aprobadas (Node 24.22, PostgreSQL 16). La prueba de carrera se repitió 6 veces sin fallos. Hallazgos de ese momento:

1. El rechazo al bajar de plan no indicaba cuánto liberar. **Resuelto:** responde `details.bytesToFree`.
2. `feature/pagos-planes` usaba la migración 011, reservada para Andy. **Resuelto** al integrar; la siguiente libre es la 015.
3. Con un historial alterado, en el que la suscripción más reciente no está activa, la API responde `403 NO_ACTIVE_SUBSCRIPTION` en lugar de aplicar Free. **Sigue vigente**; en el flujo normal no ocurre.

## Cierre del backend del 80 %

`b2a955a` e integración por PR #5 (`bf0b86a`, 23/10/2026): 196/196 con PostgreSQL y Redis reales. Después se integró el PR #7 de Alegría (`627b3cb`).

## Ajustes de frontend y factura (30/10/2026)

- `e8cb7d0`: estados de carga, ventana de procesamiento del pago y correcciones de vistas. `test:storage` 196/196, `test:frontend` 24 recorridos, `test:organization-browser` 12, `check` aprobado.
- `a91b84f`: factura PDF con logo y envío por correo con Brevo. `test:storage` 202/202, `test:frontend` y `check` aprobados; `test:organization-browser` no se repitió. Se comprobó la autenticación contra Brevo y el mensaje completo con un SMTP local; **la entrega real a un buzón no se comprobó**.
