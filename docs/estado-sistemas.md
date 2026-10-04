# Estado de sistemas — primera versión v0.1.0

Corte del 01/10/2026 desde `7c7f397d6eb8278dc7339d605205222086a1e45c`, conservando los cambios de `main`. El alcance del 30% es la propuesta funcional del equipo descrita en [avance-30](avance-30.md), no una rúbrica calculada contando tarjetas. `v0.1.0` identifica este primer avance; `v1.0.0` se reserva para el alcance final aceptado.

## Sistemas listos para este corte

| Sistema / tareas | Estado y alcance comprobado | Evidencia |
| --- | --- | --- |
| Base y esquema — S2-01 | Listo: esqueleto, migraciones y compilación | Migraciones sobre PostgreSQL temporal; `npm run check` |
| Usuarios — S2-02, S2-03 | Listo: registro, scrypt, login JWT, protección y aislamiento | Pruebas backend e integración real; registro/login en navegador |
| Free y cuotas — S2-04 a S2-06 | Listo: catálogo, asignación atómica de Free, capacidad y límites diarios del flujo síncrono | PostgreSQL: límites exactos, concurrencia y cambio de día |
| Storage — S2-07 a S2-10 | Listo: JPG/PNG/WebP estáticos hasta 25 MB, SHA-256, conversión, deduplicación global, galería y descarga privadas | Pruebas con dos cuentas, disco real, rollback y reinicio de API |
| Interfaz — S2-11, S2-12 | Lista: formularios, errores y recorrido real conectado | 10 escenarios Edge con API y PostgreSQL; capturas móvil/escritorio |
| Ahorro administrativo — S2-13 | Listo en API: bytes originales lógicos menos WebP físicos únicos; permisos y aumento de tamaño | Pruebas HTTP/SQL/disco; caso 38 B → 44 B. Panel visual pendiente del 80% |
| Aceptación — S2-15 | Lista para el recorrido definido | 44/44 pruebas backend y 10/10 escenarios históricos; ver [resultado](evidencias/2026-09-30/resultado.json) y [comandos](aceptacion-30.md) |
| Sesiones — S3-03 | Listas: revocación y logout integrados; expiración probada en backend | Logout/relogin en navegador. Vencimiento por tiempo en navegador sin ejercitar |

Revisión de compañero: el usuario informa el 01/10/2026 que Alegría revisa cada módulo cuando integra su frontend. Esta declaración cubre los módulos ya integrados arriba; no se extiende al nuevo worker. Es revisión reportada, no un review formal registrado en GitHub. Las pruebas de publicación se registran en el PR con su fecha y resultado; no confundirlas con la evidencia histórica.

## Pendientes que se conservan

- S2-14: Trello declara requisitos/diagramas terminados por el equipo; el Excel los mantiene en revisión. Conservar ambas declaraciones hasta localizar y conciliar los diagramas. Esta matriz documenta el estado técnico, pero no sustituye esos entregables.
- S2-16: el PR acredita publicación e integración al fusionarse. La constancia de presentación académica permanece pendiente y atrasada con su fecha original.
- 50% (09/10): correo, recuperación/cambio de contraseña, admisión asíncrona y reservas, recuperación completa, borrado, álbumes y sus pantallas/regresión. El worker parcial `e590ae8` queda fuera de esta versión.
- No se acredita despliegue, ejecución de Docker, caída abrupta del sistema ni aceptación final del proyecto.

## Cómo reportar un sistema listo

El [acuerdo de cierre por módulo del 03/10/2026](criterios-cierre-modulos.md)
separa la entrega individual del acoplamiento posterior de Alegría. Una tarjeta
Hecha acredita la parte del responsable; la integración y la aceptación del
recorrido completo se informan en sus propias tareas.

1. Referenciar el ID del Excel/Trello, alcance y criterio de aceptación; conservar dueño y fecha del plan.
2. Registrar commit o PR publicado, comando/escenario, fecha y resultado. Indicar pruebas omitidas y limitaciones.
3. Registrar el contrato que consumen los demás módulos y los resultados de pruebas propias. La revisión de compañero se registra al realizar la revisión conjunta o la integración, indicando quién y cómo; una declaración no se convierte en aprobación formal.
4. Con la parte del responsable completa, pruebas propias aprobadas y contrato compatible, marcar `Hecha` en Excel y mover la tarjeta a `Hecho`, con evidencia y límites en el bloque de sincronización. No esperar frontend, revisión/acoplamiento de Alegría ni integración en `main`. Defectos que incumplen el criterio propio sí impiden el cierre. S3-09/S3-10 acreditan acoplamiento y S3-11 revisión/regresión conjunta.
5. Para tareas parciales, mantener `Parcial` / `En progreso` y enumerar qué falta. Para entregas académicas, exigir constancia de entrega antes del cierre.

Formato de evidencia: `SmartStorage:S2-09 | Hecha | alcance: deduplicación global privada | pruebas: PostgreSQL y navegador, fecha/resultados | revisión: Alegría, reportada por usuario 01/10 | publicación: PR/commit | límites: sin worker asíncrono`.

Ejemplo de módulo cerrado sin frontend: `SmartStorage:S3-01 | Hecha como backend
de Andy | publicación: feature/usuarios-login, a8dd16b | pruebas: 8/8 con
BD/correo simulados, 03/10 | contrato: docs/auth-frontend.md | límites: SMTP
real/PostgreSQL no verificados por el asistente | acoplamiento: S3-09 pendiente`.

El archivo canónico de Drive y Trello se concilian con [Sincroniza SmartStorage](sincronizacion-smartstorage.md). El Gantt guardado en Git es histórico; no sustituye al Excel canónico. Se conserva también el Gantt original de `main` del 23/09 para evitar perder esa versión al integrar.

## Validación del corte el 01/10/2026

`npm run check` aprobado; `npm run test:storage`: 44/44, cero omisiones; `npm run test:browser`: 10/10 en Edge con PostgreSQL real. Docker confirmado: `smartstorage-postgres-1`, imagen `postgres:17`, estado healthy, PostgreSQL 17.11 en localhost:5433. Las dos suites se repitieron después de verificar el contenedor. Base temporal creada y eliminada por ejecución, conservando las bases existentes. Ver [resultado nuevo](evidencias/2026-10-01/resultado.json), iniciado 15:45 UTC. Redis y el worker no forman parte de este corte ni de esta validación.
