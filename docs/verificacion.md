# Verificación de SmartStorage

## Flujo integrado — 30 de septiembre de 2026

Verificación local sobre `b22e809` y los cambios de esta tarea:

- Backend con PostgreSQL 18 temporal: `npm run test:storage`, **44/44 pruebas aprobadas**, ninguna omitida.
- Interfaz real en Edge con Playwright: `npm run test:browser`, **10/10 escenarios aprobados**, incluidos registro, Free, carga múltiple, galería, descarga WebP, aislamiento/deduplicación entre cuentas, errores de cuota, reinicio de API y logout revocable.
- `npm run check`: sintaxis backend y compilación frontend aprobadas.
- Se reprodujo una conversión de 38 B a 44 B que se mostraba como «0 B menos». Resumen y análisis ahora muestran 6 B adicionales y 16% más. La prueba incluye este caso.
- Capturas de escritorio y móvil, sin excepciones JavaScript observadas. Datos sintéticos, base y almacenamiento temporales; ninguna base existente del equipo se modificó.

Ver [alcance, comandos y evidencia de S2-15](aceptacion-30.md). Esta prueba sí utiliza login JWT desde la interfaz, a diferencia de la verificación histórica de abajo. La revisión de compañero, integración en `main` y entrega académica de S2-16 siguen sin acreditarse en este trabajo. El 50% aún requiere worker, recuperación, borrado, álbumes y los flujos de cuenta pendientes.

## Verificación histórica de Storage — 25 de septiembre de 2026

Comprobaciones realizadas sobre esta entrega:

- `npm run check`: sintaxis del backend y compilación de React completadas.
- `npm test` con `TEST_DATABASE_URL` explícita: **21 pruebas aprobadas, ninguna omitida**, usando PostgreSQL 18 temporal en localhost. Sin esa variable se ejecutan 10 pruebas de contratos/configuración/demo y se omiten 11 de integración Storage.
- `npm install`: auditoría sin vulnerabilidades reportadas al instalar.
- Migraciones 001, 002 y 003 aplicadas en esa instancia; repetirlas no altera las ya aplicadas. El seed demo se ejecutó dos veces conservando solo dos cuentas.
- Conversión real: bytes WebP decodificables, orientación aplicada, EXIF eliminado, tamaño optimizado medido en disco y nombre Unicode conservado.
- Deduplicación concurrente entre dos cuentas: un objeto físico y dos referencias privadas; originales de codificación diferente se distinguen aunque tengan el mismo aspecto.
- Permisos: listado aislado, descarga ajena rechazada, carpeta ajena rechazada y ninguna ruta estática de objetos.
- Cuotas: capacidad y bytes diarios aceptan la frontera exacta; dos subidas simultáneas de hashes distintos no pueden eludir el límite de cantidad.
- Validaciones y limpieza: archivo vacío/falso/truncado, WebP animado y APNG animado; exactamente 25,000,000 bytes se admiten y un byte adicional se rechaza.
- Fallo transaccional provocado mediante un trigger de pruebas: no deja objetos nuevos sin referencia ni borra el objeto de otra cuenta. Los dos mensajes de error interno de esa prueba son esperados.
- Listado por cursor conserva microsegundos y no salta referencias por inserciones nuevas. Datos y descargas permanecen disponibles tras reiniciar la aplicación.
- Ahorro administrativo: consulta bytes físicos con `stat`, incluye duplicados lógicos, permite porcentajes negativos y reporta error si falta el archivo.
- Demo: apagada no concede identidad; encendida requiere selección explícita de una de las cuentas reservadas y rechaza hosts externos/configuración de producción.
- Navegador: selector vacío inicialmente, subida real en A, biblioteca vacía al cambiar a B, segunda subida del mismo original y descarga WebP. Verificación SQL posterior: dos referencias, un objeto físico de 1,716 bytes. Sin errores de consola observados.

Las pruebas usan esquemas y archivos temporales propios. No se modificaron bases preexistentes del equipo ni se cambiaron sus credenciales. Docker Compose no se ejecutó porque Docker no está instalado en este entorno; el entorno acordado para el proyecto sigue siendo PostgreSQL de Compose en el puerto 5433.

Estas comprobaciones validan Storage con autenticación inyectada de pruebas y el modo demo local. No verifican login real, pagos, Docker, borrado ni recuperación tras una caída abrupta del equipo. La integración del recorrido completo del 30 % sigue dependiendo del trabajo de Andy y Elden. Ver [guía de Storage](storage.md).
