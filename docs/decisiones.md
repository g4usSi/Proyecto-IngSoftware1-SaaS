# Decisiones de SmartStorage

Aclaraciones directas del equipo. Prevalecen sobre el contexto heredado y los ejemplos del mockup. Los PDF originales no se han modificado.

## Factura por correo del 30/10/2026

Solicitud de Geovanny: el comprobante de pago se presenta como factura de tienda, con logo, y se envía al correo de la cuenta por el SMTP de Andy (Brevo). Sigue siendo un pago simulado sin validez fiscal, sin NIT de emisor ni numeración fiscal. El número `SS-XXXXXXXX` deriva de la referencia del pago, sin migración nueva. El envío no bloquea el pago: si falla, se registra en el log y la factura sigue disponible en el historial. Las rutas conservan `receipt` y los botones de la interfaz dicen «Recibo» para no invalidar las capturas del manual antes de la entrega.

## Catálogo y cuotas del 14/10/2026

Acuerdo de Geovanny para S4-01: USD; Estándar US$8/mes con 25 GB y 500 MB diarios;
Pro US$15/mes con 100 GB sin límite diario; Enterprise US$40/mes con 200 GB incluidos,
sin límite diario, más US$0.20 por GB-mes adicional ponderado por tiempo.
Free mantiene 2 GB, diez subidas y 200 MB diarios. Vigencia pagada: mes calendario;
Free sin vencimiento periódico. La migración 009 y el
[contrato del catálogo](planes-pagados-s4-01.md) sustituyen la matriz provisional
en GTQ y los 500 GB de Enterprise de la 008. El cargo variable se publica, pero no
se mide ni se cobra.

## Organización incorporada el 07/10/2026

Papelera manual como protección frente a borrados accidentales. Conserva la referencia y el espacio consumido hasta su eliminación definitiva; no reembolsa el consumo diario. Restaurar no crea una nueva subida. Eliminar un álbum conserva sus imágenes y deja sin álbum sus trabajos pendientes. No hay caducidad ni vaciado automático. Ver [API](api.md#álbumes-movimiento-y-papelera).

## Base del proyecto (21 y 23 de septiembre de 2026)

- Se construye desde cero. El ZIP de autenticación anterior no se usa ni se considera código verificado.
- React + Vite, JavaScript con módulos ES, Node.js + Express, PostgreSQL y acceso SQL con `pg`.
- Un repositorio, dos paquetes npm: `frontend` y `backend`. Capas dentro de cada módulo: rutas → controladores → servicios → repositorios.
- La conversión Sharp empezó siendo síncrona; desde el 50 % la interfaz usa la cola Redis + BullMQ con worker y recuperación tras interrupciones.
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
- Contrato de autenticación: Bearer JWT; `requireAuth` verifica firma, expiración, revocación y estado de la cuenta antes de asignar `req.user = { id, email, role }`.
- La deduplicación no concede autorización. Las descargas y borrados se resuelven por el ID de imagen y su propietario autenticado, aunque físicamente el objeto sea compartido.
- Referencias derivadas de `images`, sin contador redundante. La eliminación del último enlace y la creación concurrente deben serializarse bloqueando el objeto en una transacción; la FK sola no coordina operaciones en disco.
- Capacidad del plan: contabilizar bytes originales por referencia lógica y sumar reservas pendientes. Storage y worker validan capacidad, número de subidas y bytes diarios con la misma conexión y bloqueo por usuario. El día de admisión se calcula en `America/Guatemala`; el consumo se conserva en reservas confirmadas y su agregado diario.
- Actualización del 07/10/2026: el borrado libera capacidad y conserva el consumo diario. Sólo elimina físicamente el último objeto sin referencias, mediante una tarea durable y bloqueo por hash. El lifecycle del worker confirma imagen, reserva y consumo en un único COMMIT.
- Los planes usan bytes decimales: 1 GB = 1,000,000,000 bytes. El plan Free aplica ambos límites diarios, 10 subidas y 200 MB.
- La migración 002 precargó Free. S4-01 añadió Estándar, Pro y Enterprise mediante la migración 008; la matriz y su estado de aprobación están en [catálogo y cuotas](planes-pagados-s4-01.md). Esta actualización sustituye la restricción inicial de precargar únicamente Free.
- `standard` / Estándar es el nombre canónico del nivel que la propuesta académica llamaba Básico. Los clientes deben usar `code` o `id`, nunca el nombre comercial como identificador.
- Un límite diario `NULL` significa sin límite. La capacidad y el máximo por archivo continúan aplicándose, también a Pro y Enterprise. Las condiciones personalizadas de Enterprise requieren un acuerdo específico; no se deducen de `NULL`.

## Referencias técnicas verificadas

- [Guía de Vite](https://vite.dev/guide/)
- [Instalación de Express](https://expressjs.com/en/starter/installing/)
- [Recepción multipart con Multer](https://expressjs.com/en/resources/middleware/multer/)
- [Salida WebP con Sharp](https://sharp.pixelplumbing.com/api-output/#webp)
