# Objetivo propuesto para el primer avance funcional

El enunciado fija el 25 de septiembre de 2026 y no detalla una rúbrica funcional del 30 %. Este alcance es una propuesta del equipo. Tener este esqueleto no equivale a haber completado ese avance.

Actualización de Storage: se implementan subida, WebP real, deduplicación global, cuotas, listado y descarga, con metadatos en PostgreSQL y archivos en `storage/`. Puede verificarse con una demo local de dos cuentas. Esto cubre la parte de Geovanny; el recorrido de aceptación completo todavía necesita integrar el login de Andy y la asignación Free de Elden. Ver [guía de uso y límites](storage.md).

## Recorrido de aceptación

Un cliente se registra, inicia sesión, recibe un plan Free, carga una imagen, la encuentra en su galería y descarga su WebP. Otra subida idéntica reutiliza el objeto físico global. El administrador puede consultar ahorro calculado con tamaños originales y bytes WebP reales.

La decisión de conservar solo WebP obliga a incluir una primera conversión funcional antes de declarar lista la subida. Este ajuste sustituye la propuesta anterior de almacenar originales durante el primer avance. La cola y recuperación completa de trabajos pueden ampliarse en el siguiente hito, pero no debe anunciarse optimización asíncrona hasta que exista.

## Reparto propuesto

| Integrante | Entrega siguiente | Cómo se comprueba |
| --- | --- | --- |
| Andy | Registro, login, validaciones, hash seguro, JWT y middleware; coordinación con frontend | Correo duplicado rechazado, contraseña nunca expuesta, credenciales inválidas rechazadas, cuenta inactiva bloqueada y `/auth/me` protegido |
| Geovanny | Validación JPG/PNG/WebP y 25 MB, SHA-256, conversión WebP, deduplicación global, listado/descarga | Una sola copia física para contenido idéntico, permisos entre dos cuentas, persistencia tras reinicio y limpieza de temporales |
| Elden | Catálogo, asignación Free transaccional y límites | Nuevo cliente tiene una sola suscripción activa; cuota impide exceder capacidad o cualquiera de los límites diarios |
| Diego | Integración de pantallas, navegación, mensajes y revisión visual | Registro → login → galería → carga → descarga usa datos reales; errores de API se muestran sin simular éxito |

## Orden de integración

1. Acordar contrato de usuario y esquema inicial; implementar autenticación.
2. Asignar Free al registrar, dentro de la misma transacción.
3. Implementar subida y WebP con deduplicación, proteger consultas y descargas.
4. Conectar las pantallas, límites y cálculo de ahorro del administrador.
5. Verificar recorrido con dos cuentas, reiniciar y repetir consultas.

## Hitos siguientes

- Completar verificación de correo, recuperación/cambio de contraseña y sesiones revocables.
- Incorporar Redis + BullMQ + worker Sharp, reintentos y recuperación de trabajos.
- Borrado coordinado con referencias, álbumes y movimiento de imágenes.
- Pagos simulados, historial, renovación y reglas de cambio de plan.
- Panel de administrador y posterior demo SDK/API según el alcance final.

Cada tarea terminada necesita ejecución local y revisión de un compañero. El equipo deberá conciliar este reparto con su disponibilidad; esta lista no cambia automáticamente Trello ni asigna trabajo a otras personas.
