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

1. Referenciar el ID del Excel/Trello, alcance y criterio de aceptación; conservar dueño y fecha del plan.
2. Registrar commit o PR publicado, comando/escenario, fecha y resultado. Indicar pruebas omitidas y limitaciones.
3. Registrar quién revisó y cómo: review de GitHub o declaración del equipo con fecha. Una declaración no se convierte en aprobación formal.
4. Con alcance completo, pruebas y revisión, marcar `Hecha` en Excel y mover la tarjeta a `Hecho`, con evidencia en el bloque de sincronización. La integración en `main` se informa por separado y no condiciona el cierre de desarrollo.
5. Para tareas parciales, mantener `Parcial` / `En progreso` y enumerar qué falta. Para entregas académicas, exigir constancia de entrega antes del cierre.

Formato de evidencia: `SmartStorage:S2-09 | Hecha | alcance: deduplicación global privada | pruebas: PostgreSQL y navegador, fecha/resultados | revisión: Alegría, reportada por usuario 01/10 | publicación: PR/commit | límites: sin worker asíncrono`.

El archivo canónico de Drive y Trello se concilian con [Sincroniza SmartStorage](sincronizacion-smartstorage.md). El Gantt guardado en Git es histórico; no sustituye al Excel canónico. Se conserva también el Gantt original de `main` del 23/09 para evitar perder esa versión al integrar.
