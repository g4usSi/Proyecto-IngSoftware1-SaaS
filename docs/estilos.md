# Estilos y tema visual

Alegría coordina la presentación y los componentes compartidos. Cada módulo mantiene sus estilos específicos junto a sus pantallas. Cambiar colores no requiere tocar servicios, controladores, repositorios ni contratos de API.

## Dónde editar

| Archivo | Responsabilidad |
| --- | --- |
| `frontend/src/styles/theme.css` | Todos los colores de la interfaz y la familia tipográfica |
| `frontend/src/styles/base.css` | Normalización, tipografía general, foco y accesibilidad |
| `frontend/src/styles/components.css` | Logo, botones, paneles, estados vacíos, etiquetas y explicaciones compartidas |
| `frontend/src/app/layout.css` | Menú lateral, cabecera, pie de aplicación y página 404 |
| `frontend/src/app/landing.css` | Portada, ilustración conceptual y explicación del producto |
| `frontend/src/features/auth/auth.css` | Registro e inicio de sesión |
| `frontend/src/features/storage/storage.css` | Reglas exclusivas de Storage |
| `frontend/src/features/storage/organization.css`, `quota.css` | Álbumes, papelera y medidores de cuota |
| `frontend/src/features/subscriptions/subscriptions.css` | Catálogo y pantallas de planes/pagos |
| `frontend/src/features/admin/admin.css` | Panel de administración |
| `frontend/src/styles/index.css` | Orden de importación; lo carga `main.jsx` una sola vez |

Cada archivo incluye sus propias reglas adaptables (`@media`). Los componentes compartidos se importan antes que las pantallas; no duplicar sus reglas en los módulos.

## Estados de carga

Toda pantalla que consulta la API muestra un esqueleto con la forma del contenido final (`frontend/src/components/Skeletons.jsx`: `TableSkeleton`, `RowsSkeleton`, `DetailSkeleton`), nunca ceros ni un estado vacío mientras espera. Aparecen con 120 ms de retraso para no parpadear si la respuesta es rápida y anuncian la carga a lectores de pantalla. Si la consulta falla, se muestra el error con «Volver a intentar» y «No disponible» en las cifras.

Los flujos por pasos dentro de un diálogo usan `stepKey` de `ActionDialog`, que anima el cambio de contenido y mueve el foco a la acción del paso. El pago tiene una ventana de procesamiento propia, de 700 ms como mínimo, que no se puede cerrar hasta conocer el resultado.

## Cambiar la paleta

Solo se eligen a mano los colores base de `theme.css`, que siguen la [guía de marca](../frontend/src/assets/brand/GUIA-DE-USO.md):

```css
:root {
  --brand-orange: #fb7a3c; /* Acento y pieza inferior del símbolo */
  --brand-navy: #1b304a;   /* Pieza superior y fondos oscuros */
  --brand-ink: #171325;    /* Texto sobre fondo claro */
  --brand-paper: #fdf3ea;  /* Fondo claro cálido */
  --brand-white: #ffffff;
  --brand-muted: #5f6b7a;  /* Texto secundario */
  --color-status-online: #2f7d5b;
  --color-status-offline: #a16a33;
  --color-status-error: #c2413a;
}
```

Los demás tonos, como `--color-primary-hover` o `--color-sidebar-active-start`, se derivan con `color-mix`: al cambiar un color base cambian también sus variantes. El panel agrega sus propias variables `--app-*` en `app/layout.css`, con un juego para cada tema mediante `[data-theme="dark"]`.

En las reglas usar `var(--color-...)`. Agregar un nuevo color a `theme.css` antes de usarlo; evitar hexadecimales, RGB o colores literales en JSX o en los CSS de módulos. `transparent`, `currentColor` y `inherit` expresan comportamiento, no otra paleta.

El logo React ya usa el acento del tema. Dos recursos del navegador son independientes de la hoja CSS: `frontend/public/favicon.svg` y el `theme-color` de `frontend/index.html`. Si cambia la identidad de marca, actualizar esos recursos explícitamente: un SVG externo no hereda las variables de la página.

## Trabajar sin pisarse

- Andy y Alegría coordinan `AuthPage.jsx` y `auth.css`; Andy puede avanzar en el backend mientras Alegría ajusta presentación.
- Elden mantiene las reglas exclusivas de planes/pagos; Geovanny, las de Storage. Alegría puede cambiarlas en tareas de UI acordadas.
- Tema, componentes compartidos, `App.jsx` y `styles/index.css` se coordinan antes de editar simultáneamente.
- Usar selectores específicos (`.auth-*`, `.storage-*`, `.plan-*`) para cambios locales. Una regla global sobre `button`, `input` o `h1` afecta todo el producto.
- Si una pieza se usa en dos módulos, mover su presentación a `components.css`. Por ejemplo, `.feature-explainer` se comparte entre Storage y Planes.
- No es necesario tener tres ramas abiertas para un cambio de marca: una rama de UI se integra a `main` y las demás incorporan ese cambio.

## Comprobar un cambio visual

1. Ejecutar `npm run dev` y revisar portada, registro/login, biblioteca y planes.
2. Revisar un ancho de escritorio y uno de móvil, texto legible, foco de teclado y estados deshabilitados/error.
3. Ejecutar `npm run check` antes del pull request.
4. Adjuntar capturas del cambio y solicitar revisión del integrante que mantiene la pantalla.
