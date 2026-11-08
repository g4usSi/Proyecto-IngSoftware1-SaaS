# Estado de sistemas

Estado técnico del proyecto. El avance de cada tarjeta se lleva en Trello y en el Excel de Drive; este archivo no los reemplaza. El registro de cortes anteriores está en [historial](historial/geovanny.md).

## Cierre del 100 %, entrega el 11/11/2026

Los issues del equipo vencen el **domingo 08/11/2026** (milestone «Cierre de tareas del equipo»). Pendientes: #8 (evaluación de usabilidad), #10 (guion de Alegría) y #12 (manual de usuario).

Rama `tema-y-flujo-git`. `main` está en `v1.0.0`, la versión del 100 % (08/11/2026).

| Módulo | Responsable | Estado |
| --- | --- | --- |
| Storage, cuotas y worker | Geovanny | Implementado, con formato original y álbum en el detalle (RF-STO-11), descarga en el formato original y contenido repetido en el panel admin |
| SDK y claves de API | Geovanny | Implementado: SDK de Python con la tienda de demostración Pulso (`sdk-python/`), SDK de Node.js (`sdk/`), pantalla «Claves de API» y migración 016 |
| Pagos y suscripciones | Elden | Implementado, con factura por correo verificada en un buzón real |
| Usuarios, perfil, administración y permisos | Andy | Implementado |
| Frontend | Diego Alegría | Implementado |

**Requisitos al 03/11/2026:** de 58, 56 implementados, 1 parcial y 1 fuera del alcance acordado.

- Parcial: RNF-AUT-07, porque falta la evaluación con usuarios.
- Fuera de alcance: RNF-STO-02 (HTTPS), porque la docente aceptó la demostración local.
- Casos de uso: todos implementados. En CU-17, cancelar equivale a bajar a Free, y «cambiar método de pago» no aplica porque la tarjeta no se guarda.

**Última verificación (08/11/2026; rendimiento, Pulso y Brevo del 03/11):**

| Comando | Resultado |
| --- | --- |
| `npm run test:storage` con PostgreSQL y Redis reales | 206/206 |
| `npm run test:frontend` en Edge | 26 recorridos |
| Pruebas del SDK de Python (`sdk-python`) | 7/7 |
| Tienda Pulso con API, worker, Redis y PostgreSQL reales | 8 productos sembrados con el SDK y alta de una foto de 4,0 MB servida en WebP de 647 KB |
| `npm run check` | Aprobado |
| Recorrido real de pagos con Brevo | 21/21; las 3 facturas y la verificación llegaron a Gmail |
| `npm run bench` | Ver tabla siguiente |

**Rendimiento y disponibilidad** ([resultado](evidencias/2026-11-03-rendimiento/resultado.json); i7-1165G7, Node 24, PostgreSQL local):

| Requisito | Meta | Medido (p95) |
| --- | --- | --- |
| RNF-AUT-03 inicio de sesión | < 2 s | 41 ms |
| RNF-PAG-02 suscripción, pagos y consumo | < 2 s | 5 a 9 ms |
| RNF-STO-01 optimizar una imagen de 10,4 MB | < 10 s | 1,0 s |
| RNF-AUT-04, RNF-STO-05 y RNF-PAG-04 disponibilidad | 99 % y 99,9 % | 100 % de 6.868 sondeos en 10,4 minutos |

Es una medición local: no representa un servidor público ni un período largo, pero cubre el entorno en que se hará la demostración.

## Verificación del 06/11/2026

Cambios del cierre: correos de verificación y recuperación con logo incrustado y diseño común; factura PDF con resumen de capacidad, cargas diarias, vigencia e IVA del pago simulado. Sin cambios de endpoints ni migraciones.

- `npm run check`: aprobado (Node 24.14.0).
- Pruebas específicas de factura y verificación de correo: 13/13, sin SMTP real.
- `npm test`: 87 aprobadas, 0 fallos y 119 omitidas de 206, sin PostgreSQL/Redis reales.
- `npm run test:storage`: no pudo iniciarse; PostgreSQL local en 5433 rechazó la conexión. No se modificó la base del equipo. Los 205/205 del 03/11 son evidencia histórica.


## Lo que falta

Lo que depende del resto del equipo está en issues de GitHub:

| Issue | Tarea | Responsables |
| --- | --- | --- |
| #8 | Evaluación de usabilidad con usuarios (RNF-AUT-07) | Diego, Andy |
| #9 | Instalar y probar la demostración en un segundo equipo | Elden |
| #10 | Preparar y ensayar la exposición de cada módulo | Diego, Elden, Andy |
| #11 | Revisar los cambios del cierre en pagos y autenticación | Elden, Andy |
| #12 | Actualizar el manual de usuario con las claves de API y el SDK | Diego |
| #13 | Pulir la tienda de demostración Pulso (guía: [`sdk-python/tienda/AGENTS.md`](../sdk-python/tienda/AGENTS.md)) | Diego |

Además: constancias de entrega de S4-10 y S5-08. La documentación técnica del 100 % (`Documentacion Tecnica 100%.docx` y su PDF) está en la carpeta del curso, fuera del repositorio.

## Cómo reportar un sistema listo

Cada integrante termina su módulo de forma independiente (acuerdo del 03/10/2026). Una tarjeta pasa a Hecho cuando su parte está implementada, sus pruebas comprueban el comportamiento y su contrato permite acoplarla. No se espera a las pantallas, a otro integrante ni a `main`. Un defecto que incumple el criterio propio sí impide el cierre. La revisión conjunta se registra en las tareas de integración.

1. Referenciar el ID del Excel o Trello, el alcance y el criterio de aceptación; conservar dueño y fecha del plan.
2. Registrar commit o PR publicado, comando, fecha y resultado. Indicar pruebas omitidas y limitaciones.
3. Registrar el contrato que consumen los demás. Distinguir lo probado con servicios reales de lo simulado; una declaración no se convierte en aprobación formal.
4. Para tareas parciales, mantener `Parcial` / `En progreso` y enumerar qué falta. Para entregas académicas, exigir constancia antes del cierre.

Formato de evidencia: `SmartStorage:S2-09 | Hecha | alcance: deduplicación global privada | pruebas: PostgreSQL y navegador, fecha/resultados | revisión: quién y cómo | publicación: PR/commit | límites: …`.

El Excel de Drive y Trello se concilian con [Sincroniza SmartStorage](sincronizacion-smartstorage.md). El Gantt guardado en Git es histórico y no sustituye al Excel canónico.
