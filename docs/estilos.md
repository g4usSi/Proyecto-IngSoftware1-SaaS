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
| `frontend/src/features/subscriptions/subscriptions.css` | Catálogo y pantallas de planes/pagos |
| `frontend/src/styles/index.css` | Orden de importación; lo carga `main.jsx` una sola vez |

Cada archivo incluye sus propias reglas adaptables (`@media`). Los componentes compartidos se importan antes que las pantallas; no duplicar sus reglas en los módulos.

## Cambiar la paleta

Editar las variables de `theme.css`. Las principales son:

```css
:root {
  --color-primary: #fb7a3c;
  --color-primary-hover: #ff9563;
  --color-secondary: #8b5cf6;
  --color-ink: #171325;
  --color-dark: #0e0b18;
  --color-paper: #fdf3ea;
  --color-text-muted: #71697b;
  --color-border: #e9e3ec;
}
```

Los tonos secundarios y transparencias también están centralizados, con nombres como `--color-sidebar-active-start`, `--color-auth-notice-surface` o `--color-illustration-sky`. Conservan los valores originales y se ajustan explícitamente: cambiar el acento principal no recalcula automáticamente todos sus tonos ni el color de una ilustración.

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

Esta separación conserva la apariencia inicial; no implementa autenticación, carga ni pagos.
