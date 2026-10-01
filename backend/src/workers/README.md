# Worker de conversión de imágenes

Storage conserva su conversión dentro de la solicitud HTTP. El nuevo proceso `npm run worker:images` ejecuta conversiones internas con Redis/BullMQ y persiste estados en PostgreSQL. La admisión pública asíncrona y la publicación del resultado dependen de integrar las reservas de cuotas S3-08 de Elden. Ver [contrato, alcance y pruebas](../../../docs/worker-cuotas.md).

`converted` es un resultado temporal privado, no una imagen publicada. El worker de este corte no crea filas en `images` ni `stored_objects` y no modifica cuotas. La recuperación integral de trabajos y temporales de S3-05 sigue pendiente.

Flujo acordado: validar subida → calcular SHA-256 de los bytes originales → consultar deduplicación global → reutilizar objeto existente o generar WebP → confirmar referencia privada del usuario → eliminar temporal original. Aplicar unicidad y transacciones para resolver subidas concurrentes del mismo contenido. Un fallo no debe dejar una referencia de archivo disponible ni eliminar objetos compartidos en uso.

El almacenamiento permanente conserva únicamente WebP. Guardar `original_size_bytes` como metadato del objeto compartido; obtener el tamaño WebP con `stat` al consultar métricas. El administrador consultará una única métrica de ahorro de disco, sin persistir porcentajes, bytes ahorrados ni históricos. Contar cada objeto físico una vez al calcular ahorro por optimización. Reutilizar un objeto físico nunca otorga acceso a las referencias de otros usuarios.

Los WebP definitivos están en `storage/<prefijo>/<hash>.webp` y los temporales en `storage/.tmp/`, en la raíz del proyecto. No montar `express.static` sobre esa carpeta. Ver [guía de Storage](../../../docs/storage.md).
