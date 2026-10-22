# Matriz de permisos de la API (S4-05)

Verificada de forma automática por `backend/tests/permissions-matrix.integration.test.js`,
que recorre cada ruta sin sesión, con token inválido, como cliente y como administrador.

Convenciones: base `/api`; sin sesión o con token inválido o revocado: `401`; cuenta desactivada: `403 ACCOUNT_DISABLED`;
cliente en ruta de administrador: `403`; recurso de otra cuenta: `404` (no se revela que existe).

| Ruta | Público | Cliente | Administrador | Notas |
| --- | :-: | :-: | :-: | --- |
| `GET /health`, `GET /ready` | Sí | Sí | Sí | |
| `GET /plans` | Sí | Sí | Sí | Catálogo en USD |
| `POST /auth/register`, `login`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password` | Sí | Sí | Sí | Respuestas neutrales; el login se bloquea tras 5 fallos |
| `POST /auth/logout`, `POST /auth/change-password` | No | Sí | Sí | Propia cuenta |
| `GET /auth/me`, `PATCH /auth/me` | No | Sí | Sí | Solo el nombre es editable; correo, rol y estado se ignoran |
| `GET /files`, `GET /files/summary`, `POST /files`, `GET /files/:id/download`, `PATCH /files/:id`, `POST /files/:id/trash`, `POST /files/:id/restore`, `DELETE /files/:id` | No | Sí, solo lo propio | Sí, solo lo propio | El administrador no ve archivos ajenos |
| `GET/POST/PATCH/DELETE /albums` | No | Sí, solo lo propio | Sí, solo lo propio | |
| `GET /jobs`, `GET /jobs/:id`, `POST /jobs` | No | Sí, solo lo propio | Sí, solo lo propio | La cola global está en `/admin/jobs` |
| `GET /quotas/me` | No | Sí | Sí | Plan vigente, capacidad y consumo |
| `GET /subscriptions/me`, `POST /subscriptions/checkout`, `renew`, `change-plan` | No | Sí | Sí | Precios del servidor; `Idempotency-Key` obligatoria al pagar |
| `GET /payments`, `GET /payments/receipts`, `GET /payments/:id/receipt` | No | Sí, solo lo propio | Sí, solo lo propio | Recibo solo de pagos aprobados |
| `GET /admin/summary`, `/admin/subscriptions`, `/admin/usage` | No | No (403) | Sí | Solo lectura |
| `GET /admin/jobs` | No | No (403) | Sí | Cola global de procesamiento |
| `GET /admin/storage/stats` | No | No (403) | Sí | Ahorro global |
| `GET /admin/users`, `GET /admin/users/:id` | No | No (403) | Sí | Nunca devuelven hashes de contraseña |
| `PATCH /admin/users/:id/status` | No | No (403) | Sí | Un administrador no puede desactivarse a sí mismo |
| `GET /admin/audit-events` | No | No (403) | Sí | Bitácora de autenticación y cuentas |

## Reglas transversales

- El rol se lee de la base de datos en cada petición; un token no puede declarar su propio rol.
- Una cuenta desactivada pierde el acceso con la sesión abierta (`403 ACCOUNT_DISABLED`) y no puede iniciar sesión (mismo código); al reactivarla, su token vuelve a funcionar si no ha vencido.
- Las respuestas administrativas llevan `Cache-Control: private, no-store`.
- Correo del perfil: **decisión S4-05**: el correo no es editable desde `PATCH /auth/me`. Cambiarlo exigiría reverificarlo y queda fuera del alcance del 80 %.
