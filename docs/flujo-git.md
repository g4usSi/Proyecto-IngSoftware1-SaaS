# Trabajo en equipo con Git

Una rama contiene el repositorio completo. La división por módulos se refleja en las carpetas y en el alcance de cada tarea; las capas (rutas, controladores, servicios y repositorios) trabajan juntas dentro de esa tarea.

## Ramas y responsables

`main` contiene el trabajo integrado y revisado. Usamos ramas temporales pequeñas; no hace falta una rama `develop` para este equipo. La rama existente `docs` se conserva para el trabajo documental que ya tenga el equipo.

| Integrante | Ejemplo de rama | Área principal |
| --- | --- | --- |
| Andy | `feature/usuarios-login` | `backend/src/modules/auth/`, middleware de autenticación y pantallas acordadas |
| Elden | `feature/pagos-planes` | `backend/src/modules/subscriptions/` y `frontend/src/features/subscriptions/` |
| Geovanny | `feature/storage-subida` | `backend/src/modules/storage/`, futuros workers y `frontend/src/features/storage/` |
| Diego Alegría | `feature/ui-tema` | Tema, componentes compartidos, estructura visual e integración del frontend |

Son ejemplos de próximas tareas, no ramas permanentes reservadas para cada persona. Después del tema visual, Alegría puede abrir `feature/ui-login` o `feature/ui-galeria`. Una tarea de módulo puede incluir frontend y backend; acordar quién edita cada archivo si participan dos personas.

Las tareas asistidas por Codex usan el prefijo `codex/`, como `codex/tema-y-flujo-git`. Se revisan e integran mediante el mismo proceso. El prefijo no cambia la responsabilidad del integrante que presenta el trabajo.

## Empezar una tarea

Primero integrar a `main` la preparación compartida de estilos y documentación. Después, cada integrante ejecuta desde su clon:

```powershell
git status
git switch main
git pull --ff-only origin main
git switch -c feature/usuarios-login
npm ci
```

Cambiar `feature/usuarios-login` por el nombre de la tarea propia. El estado de trabajo debe estar limpio antes de cambiar de rama; si hay cambios, guardarlos en su rama o resolverlos primero. Si `--ff-only` falla, revisar por qué las historias difieren; no usar `reset --hard` para descartar trabajo.

`git pull` actualiza código; `npm ci` instala las versiones del lockfile. La configuración `.env` es local. Seguir el README para PostgreSQL y migraciones.

`.editorconfig` y `.gitattributes` mantienen UTF-8 y finales de línea LF para código y documentación, evitando cambios de formato entre los sistemas del equipo.

## Guardar y compartir avance

Revisar el diff y añadir solo los archivos de la tarea. Ejemplo orientativo para Andy:

```powershell
git diff
git add backend/src/modules/auth/
git diff --cached
git commit -m "feat: implementar inicio de sesión"
git push -u origin feature/usuarios-login
```

Añadir también los archivos de middleware, pruebas y migraciones que esa tarea realmente cambie. No subir `.env`, imágenes privadas ni `node_modules`. Mensajes de commit: `feat:`, `fix:`, `refactor:`, `docs:` o `test:` según el cambio.

Publicar una rama comparte avance, pero no integra sus cambios a `main`.

## Recibir cambios de los demás

Actualizar la rama de trabajo regularmente y antes de solicitar integración:

```powershell
git fetch origin
git merge origin/main
npm ci
npm run check
npm test
```

Ejecutar estos comandos estando en la rama de la tarea. Si hay conflictos, revisar cada archivo con quien lo modificó, resolver, ejecutar `git add` sobre los resueltos y `git commit` para terminar el merge. `git merge --abort` cancela el intento si no se puede resolver todavía. Evitar `push --force` y reescribir ramas que usa otro compañero.

Cuando Alegría integre el nuevo tema, cada integrante lo recibe al incorporar `origin/main`; no debe copiar esos cambios manualmente a tres ramas.

## Pull request e integración

1. Abrir PR desde la rama de tarea hacia `main`.
2. Explicar el comportamiento, cómo comprobarlo y cualquier migración/configuración necesaria. Hay una plantilla en `.github/pull_request_template.md`.
3. Ejecutar `npm run check` y `npm test`. Demostrar además el flujo específico de la tarea; esas pruebas básicas no prueban funciones todavía pendientes.
4. Obtener revisión de al menos un compañero; corregir observaciones y resolver conflictos.
5. Integrar mediante un merge commit. Esta estrategia conserva la historia y permite eliminar la rama local con `git branch -d` cuando `main` ya la contiene.
6. Actualizar `main` local y borrar únicamente la rama de tarea ya integrada. GitHub permite borrar la rama remota desde el PR.

```powershell
git switch main
git pull --ff-only origin main
git branch -d feature/usuarios-login
```

La revisión es un acuerdo del equipo. Esta guía y la plantilla no activan por sí solas protecciones en GitHub ni verificaciones automáticas. No integrar directamente trabajo funcional a `main` sin la revisión acordada.

## Archivos que requieren coordinación

| Área | Acuerdo |
| --- | --- |
| `styles/theme.css`, `styles/components.css`, `app/layout.css` | Alegría coordina cambios compartidos |
| `frontend/src/app/App.jsx` | Acordar nuevas rutas para evitar cambios incompatibles |
| `backend/migrations/` | Reservar un número distinto por tarea; nunca editar una migración aplicada |
| `docs/api.md` y middleware de identidad | Acordar contratos entre Andy y los consumidores antes de implementarlos |
| `package.json` y `package-lock.json` | Coordinar dependencias; actualizar y versionar ambos cuando corresponda |
| `compose.yaml` y archivos `.env.example` | Avisar cambios de puertos, servicios o configuración y actualizar el README |

Una rama no es una copia de la base de datos: cambiar de rama no revierte migraciones ni cambia los volúmenes de Docker. Si dos tareas necesitan esquemas incompatibles, usar bases de desarrollo separadas; no borrar volúmenes ni bases compartidas para resolverlo.

Mantener las tareas cortas permite detectar dependencias a tiempo. Por ejemplo, Alegría puede trabajar la pantalla de login mientras Andy implementa su endpoint con el contrato de `docs/api.md`; la integración se hace cuando ambos cambios están listos y revisados.
