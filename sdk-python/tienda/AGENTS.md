# Tienda Pulso — guía para pulir el frontend

Contexto para Alegría y para cualquier agente de IA que trabaje en esta carpeta.
Las reglas generales del proyecto están en el [`AGENTS.md` de la raíz](../../AGENTS.md); este archivo
solo agrega lo propio de la tienda. Comunicarse en español.

- **Tarea:** [issue #13](https://github.com/g4usSi/Proyecto-IngSoftware1-SaaS/issues/13), tarjeta S5-04.
- **Fecha límite:** miércoles 05/11/2026; la entrega final del proyecto es el 06/11.
- **Rama:** partir de `tema-y-flujo-git` (commit `868fa2a` o posterior) y trabajar en `feature/ui-tema`
  o en una rama propia. No integrar a `tema-y-flujo-git` ni a `main`: Geovanny integra.

## Qué es

**Pulso** es una tienda deportiva **ficticia** que sirve para demostrar el SDK de Python de SmartStorage
en la exposición. Sus fotos de producto se suben con el SDK, SmartStorage las convierte a WebP y la
tienda las muestra desde la biblioteca privada de su cuenta. El estilo se inspira en tiendas de retail
como Nike (foto de producto protagonista, blanco y negro, titulares condensados), pero la marca es propia.

La tienda ya funciona de punta a punta. Lo que falta es **calidad visual para la demo**: fotos, estilo,
textos y revisión en móvil. No es un sistema de ventas: la bolsa solo cuenta artículos en el navegador
y no hay compras ni pagos.

## Dónde está cada cosa

| Archivo | Qué contiene | ¿Se toca? |
| --- | --- | --- |
| `estatico/tienda.css` | Todo el estilo. Tokens de color y tipografía en `:root` | **Sí**, aquí está la mayor parte del trabajo |
| `__main__.py` | Servidor HTTP y el HTML de cada página: `pagina()` (cabecera, pie, script de la bolsa), `inicio()`, `tarjeta()`, `detalle()`, `admin()` | Sí, para cambiar el marcado. No cambiar las rutas ni la lógica de `do_GET`/`do_POST` |
| `catalogo_base.json` | Los 8 productos de ejemplo: nombre, color, categoría, precio en US$, descripción y archivo de foto | Sí |
| `semillas/` | Fotos de esos productos (hoy son ilustraciones planas) | Sí, conviene reemplazarlas |
| `catalogo.py`, `sembrar.py` | Guardan el catálogo y suben las fotos con el SDK | No, salvo que sea necesario |
| `catalogo.json` | Se genera al sembrar; no se versiona | No editar a mano |
| `../smartstorage/` | El SDK | **No** |

Rutas de la tienda: `/` (portada y novedades), `/?cat=Running|Trail|Urbano`, `/producto/<slug>`,
`/admin` (agregar producto con foto) e `/img/<imageId>` (WebP servido desde SmartStorage).

## Cómo levantarla

Requisitos: SmartStorage en marcha (desde la raíz, `npm run dev` y `npm run worker:images`, ver el README
principal), Python 3.9 o superior (sin dependencias) y una cuenta con plan **Estándar o superior**.

1. En SmartStorage (`http://localhost:5173`), entra con esa cuenta y crea una clave en
   **Desarrolladores → Claves de API**. Se muestra una sola vez.
2. Desde la carpeta `sdk-python`, en PowerShell:

```powershell
$env:SMARTSTORAGE_API_KEY = 'ss_...'
python -m tienda.sembrar     # sube las fotos de semillas/ al álbum «Tienda Pulso»
python -m tienda             # http://127.0.0.1:8080
```

El servidor no recarga solo. **Si cambias el CSS**, basta con recargar el navegador. **Si cambias
`__main__.py`**, detén la tienda con Ctrl+C y vuelve a iniciarla. **Si cambias las fotos o
`catalogo_base.json`**, borra `catalogo.json` y vuelve a ejecutar `python -m tienda.sembrar`.

Variables opcionales: `SMARTSTORAGE_URL` (por defecto `http://127.0.0.1:3000/api`) y `TIENDA_PUERTO`
(por defecto `8080`).

## Qué pulir

1. **Fotos de producto.** Reemplazar las ilustraciones de `semillas/` por fotos propias o libres de
   derechos (Unsplash, Pexels), de zapatillas **sin logotipos visibles**: JPG o PNG, fondo claro, cuadradas,
   unos 1200 × 1200. Con fotos reales el ahorro de WebP que muestra la ficha es más creíble. Actualizar el
   campo `archivo` en `catalogo_base.json` si cambian los nombres.
2. **Estilo** en `tienda.css`. La portada es el único elemento llamativo; el resto debe ser sobrio.
   Revisar espaciados, la rejilla de productos, la ficha (galería de colores, tallas, botón) y el formulario
   de `/admin`.
3. **Móvil.** Hoy solo hay un punto de quiebre (`@media (max-width: 900px)`). Probar a 375 px: sin
   desplazamiento horizontal, menú usable, botones de al menos 44 px de alto.
4. **Textos** de `catalogo_base.json` y de las páginas: español neutro, frases cortas, precios en US$.
5. **Accesibilidad:** foco visible, `alt` descriptivo en cada foto, contraste suficiente y
   `prefers-reduced-motion` respetado (ya está para los botones).

## Límites

- **Sin marcas reales.** No usar nombres, logotipos, tipografías ni fotos de Nike, Adidas u otras marcas.
  Pulso es ficticia.
- **Sin dependencias ni compilación.** Nada de npm, React, Tailwind o frameworks: HTML generado en
  Python, un CSS y JavaScript mínimo en línea. Las fuentes se cargan de Google Fonts (hoy Barlow y
  Barlow Condensed).
- **Mantener la demostración del SDK.** La ficha debe seguir mostrando el formato y el tamaño originales
  frente al WebP servido (`.almacenamiento`), y `/admin` debe seguir subiendo la foto con el SDK. Es lo
  que se presenta.
- **Escapar siempre** lo que venga del catálogo o del formulario con `e(...)` (`html.escape`) al generar HTML.
- **Sin secretos.** No escribir la clave `ss_...` en archivos, commits ni capturas; solo en la variable
  de entorno.
- Las imágenes se piden a SmartStorage y se guardan en memoria (64 como máximo); no servirlas desde disco.

## Comprobar antes de entregar

```powershell
cd sdk-python
python -m unittest discover -s tests -v     # pruebas del SDK; deben seguir pasando
```

A mano: portada, las tres categorías, una ficha con otros colores, elegir talla y agregar a la bolsa,
y agregar un producto en `/admin` con una foto JPG. Revisar todo en escritorio y a 375 px.

Al terminar, comentar en el issue #13 con capturas de escritorio y móvil, sin la clave ni datos personales.
