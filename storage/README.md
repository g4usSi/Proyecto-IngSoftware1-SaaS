# Archivos privados de SmartStorage

Los WebP definitivos se guardan aquí: `<prefijo SHA-256>/<hash del original>.webp`.
`.tmp/` contiene originales y salidas de conversión solo mientras se procesa una subida.
Los archivos generados están excluidos de Git. No publicar esta carpeta como contenido estático.

PostgreSQL es la única fuente de metadatos: propietario, nombre, hash original,
tamaño original y clave relativa del WebP. El tamaño optimizado se consulta con `stat`.
No hay un JSON paralelo. Para respaldar la biblioteca se necesitan **la base de datos y esta carpeta**.

El valor predeterminado de `STORAGE_ROOT` apunta aquí, independientemente del directorio
desde el que se arranque Node. Una ruta personalizada relativa también parte de la raíz del proyecto.
