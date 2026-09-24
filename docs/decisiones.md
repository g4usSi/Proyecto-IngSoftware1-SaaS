# Decisiones de SmartStorage

Este archivo registra las aclaraciones directas del equipo del 21 y 23 de septiembre de 2026. Prevalecen sobre el contexto heredado de otra IA y los ejemplos del mockup. Los PDF originales no se han modificado.

## Base y alcance de esta entrega

- Se construye desde cero. El ZIP de autenticación anterior no se usa ni se considera código verificado.
- Sobre el esqueleto ejecutable se implementa Storage para el primer avance. El 30 % completo depende también de la integración de autenticación y suscripciones.
- React + Vite, JavaScript con módulos ES, Node.js + Express, PostgreSQL y acceso SQL con `pg`.
- Un repositorio, dos paquetes npm: `frontend` y `backend`. Capas dentro de cada módulo: rutas → controladores → servicios → repositorios.
- La conversión Sharp inicial es síncrona. Cola Redis + BullMQ, worker y recuperación completa tras interrupciones quedan para el siguiente hito.
- El HTML de mockups es referencia visual. Sus datos, mensajes, botones y afirmaciones no se consideran funciones implementadas.

## Almacenamiento aprobado

1. Calcular SHA-256 sobre los bytes originales recibidos, antes de convertirlos.
2. Deduplicar globalmente por ese hash. Archivos visualmente parecidos con bytes diferentes son archivos distintos.
3. Un registro `images` representa una imagen en la cuenta de un usuario; `stored_objects` representa el archivo físico compartido. Dos cuentas pueden referenciar el mismo objeto sin acceder a los registros privados de la otra.
4. Conservar únicamente la versión WebP definitiva. El archivo original solo puede existir transitoriamente mientras se procesa. Borrarlo al terminar y limpiar temporales al fallar o expirar un trabajo.
5. Persistir `original_size_bytes` una vez por objeto original único. El tamaño original no cambia entre archivos de contenido idéntico.
6. Obtener el tamaño físico del WebP con `stat`; calcular el ahorro cuando el administrador lo consulta. No guardar porcentajes, totales de ahorro ni contadores duplicados.
7. Descargar únicamente WebP; ofrecer la descarga original dejaría de ser coherente con esta decisión.
8. La clave del objeto será `<primeros-2-caracteres-del-hash>/<hash-original>.webp`, relativa a `STORAGE_ROOT`. No publicar esa carpeta con `express.static`.
9. `STORAGE_ROOT` apunta por defecto a `storage/` en la raíz del proyecto. PostgreSQL es la única fuente de metadatos; no se mantiene un JSON paralelo.
10. Aceptar imágenes estáticas JPG, PNG y WebP, hasta 25,000,000 bytes. Rechazar animaciones explícitamente, sin quedarse solo con el primer fotograma.
11. Convertir a WebP con calidad 80, sin redimensionar; aplicar la orientación de la fotografía y eliminar EXIF/GPS. Es compresión con pérdida autorizada. Las dimensiones resultantes se intercambian cuando la orientación exige una rotación de 90°.
12. Modo demo local, desactivado por defecto, con dos cuentas seleccionadas explícitamente. No sustituye ni modifica el contrato de autenticación de Andy.

## Única métrica persistida y cálculo de ahorro

Para un conjunto consistente de imágenes cuyo objeto esté listo:

- `B` = suma de tamaños originales de las imágenes lógicas actualmente referenciadas, incluyendo repeticiones entre cuentas.
- `U` = suma de tamaños originales de los objetos únicos referenciados.
- `P` = suma de bytes de los WebP únicos referenciados, medida en disco.
- Ahorro total global = `B - P`.
- Porcentaje global = `100 * (B - P) / B`, si `B > 0`; con biblioteca vacía se informa 0.

Si se necesita explicar el resultado, `B - U` corresponde a deduplicación y `U - P` a conversión. Son cálculos, no nuevas métricas persistidas. Ejemplo: dos cuentas suben el mismo original de 1 MB y el único WebP ocupa 0.4 MB: `B=2`, `U=1`, `P=0.4`, ahorro global 1.6 MB (80 %).

No prometer un porcentaje fijo ni ocultar resultados negativos: algunos originales pequeños pueden producir un WebP más grande. Un archivo ausente en disco es un error de integridad, no 0 bytes ahorrados. El hash del original NO se compara con el hash del WebP: la transformación cambia el contenido.

Esta métrica describe el ahorro de la biblioteca actual frente a guardar cada subida original por separado; no es un ahorro histórico acumulado de imágenes eliminadas. Los temporales y archivos huérfanos también ocupan disco mientras existen, pero deben medirse aparte al hablar del consumo total de infraestructura.

## Convenciones iniciales para integrar módulos

- API bajo `/api`, JSON en camelCase; SQL en inglés y snake_case. Mapeo con los diagramas: `usuario` → `users`, `imagen` → `images`, `objeto_almacenado` → `stored_objects`, `album` → `folders`.
- Identificadores de usuario e imagen: UUID. Roles: `client` y `admin`.
- Contrato de autenticación previsto: Bearer JWT; `requireAuth` verificará firma, expiración y estado de la cuenta antes de asignar `req.user = { id, email, role }`. La revocación/cierre de sesión se implementará antes de considerar completo el módulo.
- La deduplicación no concede autorización. Las descargas y borrados se resuelven por el ID de imagen y su propietario autenticado, aunque físicamente el objeto sea compartido.
- Referencias derivadas de `images`, sin contador redundante. La eliminación del último enlace y la creación concurrente deben serializarse bloqueando el objeto en una transacción; la FK sola no coordina operaciones en disco.
- Capacidad del plan: contabilizar bytes originales por referencia lógica. Storage valida capacidad, número de subidas y bytes diarios dentro de la transacción, serializando por usuario. El día se calcula en `America/Guatemala`. Estos valores se derivan de `images`; no son nuevas métricas persistidas.
- No se implementa borrado todavía. Antes de añadirlo, Elden y Geovanny deberán acordar un historial de consumo u otro mecanismo que impida recuperar cuota diaria eliminando imágenes.
- Los planes usan bytes decimales: 1 GB = 1,000,000,000 bytes. El plan Free aplica ambos límites diarios, 10 subidas y 200 MB.
- Solo se precarga Free. Los precios pagados se decidirán antes de cargar Estándar, Pro y Enterprise.

## Cambios pendientes en documentación académica

- Cambiar RF-03 de Storage de deduplicación por cuenta a global.
- Cambiar RF-04 y RF-08: no conservar ni descargar el original.
- Ajustar mockups y requisitos de métricas: ahorro calculado para administrador; retirar métricas persistidas o promesas de descarga original.
- Actualizar modelo relacional y diagramas al esquema incremental implementado. Tokens, pagos, trabajos y consumo diario resistente al borrado aún requieren sus propias migraciones.

## Referencias técnicas verificadas

- [Guía de Vite](https://vite.dev/guide/)
- [Instalación de Express](https://expressjs.com/en/starter/installing/)
- [Recepción multipart con Multer](https://expressjs.com/en/resources/middleware/multer/)
- [Salida WebP con Sharp](https://sharp.pixelplumbing.com/api-output/#webp)
