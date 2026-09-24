# Verificación de Storage — 23 de septiembre de 2026

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
