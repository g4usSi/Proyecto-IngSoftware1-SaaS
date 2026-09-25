# Procesamiento asíncrono pendiente

Storage ya convierte imágenes con Sharp dentro de la solicitud HTTP. No hay trabajadores ni tareas asíncronas. Redis y BullMQ quedan para un siguiente hito junto con reintentos, recuperación y límites de concurrencia de trabajos.

Flujo acordado: validar subida → calcular SHA-256 de los bytes originales → consultar deduplicación global → reutilizar objeto existente o generar WebP → confirmar referencia privada del usuario → eliminar temporal original. Aplicar unicidad y transacciones para resolver subidas concurrentes del mismo contenido. Un fallo no debe dejar una referencia de archivo disponible ni eliminar objetos compartidos en uso.

El almacenamiento permanente conserva únicamente WebP. Guardar `original_size_bytes` como metadato del objeto compartido; obtener el tamaño WebP con `stat` al consultar métricas. El administrador consultará una única métrica de ahorro de disco, sin persistir porcentajes, bytes ahorrados ni históricos. Contar cada objeto físico una vez al calcular ahorro por optimización. Reutilizar un objeto físico nunca otorga acceso a las referencias de otros usuarios.

Los WebP definitivos están en `storage/<prefijo>/<hash>.webp` y los temporales en `storage/.tmp/`, en la raíz del proyecto. No montar `express.static` sobre esa carpeta. Ver [guía de Storage](../../../docs/storage.md).
