# Estado de sistemas

Estado técnico del proyecto. El avance de cada tarjeta se lleva en Trello y en el Excel de Drive; este archivo no los reemplaza. El registro de cortes anteriores está en [historial](historial/geovanny.md).

## Avance del 80 %, entrega el 31/10/2026

Rama `tema-y-flujo-git`. `main` sigue en `v0.2.0`, la versión del 50 %.

| Módulo | Responsable | Estado |
| --- | --- | --- |
| Storage, cuotas y worker | Geovanny | Implementado; el detalle de imagen es parcial (RF-STO-11) |
| Pagos y suscripciones | Elden | Implementado, con pago simulado y factura por correo |
| Usuarios, perfil, administración y permisos | Andy | Implementado |
| Frontend | Diego Alegría | Integrado con el PR #7 (`627b3cb`) y ajustes del 30/10 (`e8cb7d0`) |

**Requisitos al 30/10/2026:** de 58, 45 implementados, 5 parciales, 6 por validar y 2 pendientes.

**Última verificación:**

| Comando | Resultado | Commit |
| --- | --- | --- |
| `npm run test:storage` con PostgreSQL y Redis reales | 202/202 | `a91b84f` |
| `npm run test:frontend` (API simulada) | Aprobado, 24 recorridos | `a91b84f` |
| `npm run check` | Aprobado | `a91b84f` |
| `npm run test:organization-browser` | 12 recorridos | `e8cb7d0`; no se repitió después |

## Lo que falta o no está comprobado

- **Correo real por Brevo:** se comprobó la autenticación y el contenido con un SMTP local, pero no la llegada de una factura a un buzón.
- **HTTPS y despliegue público** (RNF-STO-02): la aplicación corre en local por HTTP. El enunciado pide demostrar despliegue en ambientes productivos; conviene confirmar el alcance con la docente.
- **SDK y claves de API** (CU-14, RNF-STO-03): pendientes.
- **Rendimiento y disponibilidad** (RNF-AUT-03, RNF-AUT-04, RNF-STO-01, RNF-STO-05, RNF-PAG-02, RNF-PAG-04): sin medición.
- **Enterprise:** la tarifa por GB-mes adicional se publica, pero no se mide ni se cobra.
- **Sin implementar:** cancelación manual y cambio de método de pago.
- **Entrega S4-10:** debe registrarse la constancia en su tarjeta.

## Cómo reportar un sistema listo

Cada integrante termina su módulo de forma independiente (acuerdo del 03/10/2026). Una tarjeta pasa a Hecho cuando su parte está implementada, sus pruebas comprueban el comportamiento y su contrato permite acoplarla. No se espera a las pantallas, a otro integrante ni a `main`. Un defecto que incumple el criterio propio sí impide el cierre. La revisión conjunta se registra en las tareas de integración.

1. Referenciar el ID del Excel o Trello, el alcance y el criterio de aceptación; conservar dueño y fecha del plan.
2. Registrar commit o PR publicado, comando, fecha y resultado. Indicar pruebas omitidas y limitaciones.
3. Registrar el contrato que consumen los demás. Distinguir lo probado con servicios reales de lo simulado; una declaración no se convierte en aprobación formal.
4. Para tareas parciales, mantener `Parcial` / `En progreso` y enumerar qué falta. Para entregas académicas, exigir constancia antes del cierre.

Formato de evidencia: `SmartStorage:S2-09 | Hecha | alcance: deduplicación global privada | pruebas: PostgreSQL y navegador, fecha/resultados | revisión: quién y cómo | publicación: PR/commit | límites: …`.

El Excel de Drive y Trello se concilian con [Sincroniza SmartStorage](sincronizacion-smartstorage.md). El Gantt guardado en Git es histórico y no sustituye al Excel canónico.
