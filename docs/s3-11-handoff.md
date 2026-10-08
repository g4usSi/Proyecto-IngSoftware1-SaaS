# Entrega S3-08 y backend S3-11 — 07/10/2026

## Integración y autoría

Base: tema-y-flujo-git @ `6c2665b56bb091b2c8b58d5d3d727dd9f21a184a`.
Rama incorporada: feature/pagos-planes @ `891113935a385af8db5c525352c1b7d5ecfcce7d`;
el aporte funcional de Elden es `5372a98dae8da359d5676fdf72e67cb2f4d9f4b2`.
Se resolvieron README/.gitignore conservando el worker y la documentación histórica.

Las correcciones solicitadas por Geovanny se implementaron en
codex/integrar-cuotas-s3-11 y se integran a tema-y-flujo-git. La rama original de
Elden se conserva; la evidencia no le atribuye estas correcciones nuevas como
una segunda entrega suya. El producto frontend y las credenciales no se modifican.

## Alcance implementado

- S3-08: día de admisión fijo en Guatemala, suscripciones ya iniciadas, capacidad
  y ambos límites diarios independientes, bloqueo/idempotencia con client externo,
  rollback, confirmación y liberación repetidas sin consumo duplicado.
- S3-11 backend: cuotas compartidas entre POST /files y POST /jobs; reserva y
  admisión atómicas; entrega recuperable a Redis; publicación privada de imagen,
  confirmación de cuota y estado published en la misma transacción.
- POST /jobs devuelve 202 y admite Idempotency-Key UUID. GET /quotas/me informa
  plan, usado, reservado, disponible y consumo diario. DELETE /files/:fileId
  elimina la referencia propia y libera capacidad sin devolver consumo diario.
- Recuperación de caída antes/después de COMMIT, expiración y fallos terminales;
  deduplicación privada y limpieza durable del último objeto borrado.

La migración 005 de Elden mantiene su contenido publicado. La nueva 006 añade
el día reservado, vincula imágenes/reservas, traslada las referencias históricas
sin duplicar eventos y conserva el consumo de imágenes ya borradas. Su ejecución
y repetición se probaron sobre un esquema anterior. No se migró la base de
desarrollo durante esta validación.

## Evidencia técnica

Comandos ejecutados el 07/10/2026 desde la raíz:

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/0'
npm run test:storage
npm run check
Remove-Item Env:TEST_REDIS_URL
```

Resultado: **102 aprobadas, 0 fallos, 0 omisiones**. PostgreSQL 17.11 y Redis
7.4.11 reales. La suite creó/eliminó su base temporal y colas Redis aleatorias;
no vació Redis ni alteró bases existentes. Sintaxis backend y build frontend
aprobados. Registro reproducible: [resultado](evidencias/2026-10-07-s3-08-s3-11/resultado.json).

Pruebas de referencia: backend/tests/quotas.test.js y
backend/tests/async-quota.integration.test.js. Las caídas terminan un consumidor
real justo antes/después del COMMIT y recuperan una imagen con un consumo.
No acreditan un apagón, despliegue, SMTP real ni aceptación de otro integrante.

## Puesta en marcha y frontend pendiente

Alegría debe incorporar tema-y-flujo-git en su rama, instalar con npm ci, detener
API/workers, ejecutar npm run db:migrate y arrancar API + npm run worker:images
con el mismo backend/.env/STORAGE_ROOT. Redis debe estar activo. Ver
[operación](worker-cuotas.md) y [contrato OpenAPI](contracts/jobs.openapi.json).

Se sustituyó la guía anterior por [contratos pendientes de Alegría](frontend-auth-jobs-handoff.md):
admisión asíncrona, cuotas reales, borrado y sus escenarios de interfaz. Se
retiraron de la guía las tareas ya implementadas; no se eliminó ni editó su UI.

S3-08 satisface el cierre de su módulo. S3-11 conserva pendiente el acoplamiento
frontend y la regresión conjunta de ese recorrido. Se mantienen las fechas del
plan: revisión del 08/10 y entrega del 09/10. El pull posterior de cuentas de
Andy y pagos/álbumes no forman parte de esta incorporación.
