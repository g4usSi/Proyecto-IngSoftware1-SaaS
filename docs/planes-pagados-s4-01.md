# S4-01: Catálogo de planes pagados y precios

## 1. Objetivo

Configurar y documentar los planes de SmartStorage, incluyendo precios, almacenamiento, límites diarios y características de cada plan.

## 2. Catálogo de planes

| Característica       | Free                | Estándar | Pro        | Enterprise        |
| -------------------- | ------------------- | -------- | ---------- | ----------------- |
| Precio mensual       | Q0.00               | Q35.00   | Q100.00    | Desde Q300.00     |
| Almacenamiento       | 2 GB                | 25 GB    | 100 GB     | 500 GB o a medida |
| Subida diaria        | 10 subidas o 200 MB | 500 MB   | Sin límite | A medida          |
| Conversión a WebP    | Sí                  | Sí       | Sí         | Sí                |
| Deduplicación global | Sí                  | Sí       | Sí         | Sí                |
| Acceso SDK/API       | No                  | Básico   | Completo   | Completo          |
| Prioridad de proceso | No                  | No       | Sí         | Sí                |
| Soporte prioritario  | No                  | No       | No         | Sí                |

## 3. Reglas de los planes

- **Moneda:** quetzales (GTQ).
- **Periodicidad:** mensual.
- **Free:** permite hasta 10 subidas y 200 MB diarios. Ambos límites se aplican.
- **Estándar:** permite hasta 500 MB diarios, sin límite de cantidad de subidas configurado.
- **Pro:** no tiene límites diarios configurados.
- **Enterprise:** contempla condiciones personalizadas según las necesidades del cliente.
- Todos los planes incluyen conversión de imágenes a WebP y deduplicación global.
- Los precios y condiciones comerciales están sujetos a confirmación del equipo antes del lanzamiento.

## 4. Implementación en el backend

Se creó la migración:

`backend/migrations/008_paid_plans_catalog.sql`

Esta migración registra los planes pagados en la tabla `plans` de PostgreSQL.

**Planes registrados:**

- Estándar: Q35.00, 25 GB.
- Pro: Q100.00, 100 GB.
- Enterprise: Q300.00 como precio base provisional, 500 GB.

El plan Free ya existía en la base de datos.

Los campos de acceso SDK/API, prioridad de procesamiento y soporte prioritario están documentados como características comerciales, pero todavía no están representados en la tabla `plans`.

En Enterprise, los límites diarios personalizados aún no están implementados. Actualmente se utilizan valores `NULL`, que el sistema interpreta como ausencia de límites configurados.

## 5. Contrato de la API

**Método:** GET

**Endpoint:** `/api/plans`

**Respuesta:** objeto JSON con una propiedad `data` que contiene los planes activos.

Cada plan incluye:

- `id`
- `code`
- `name`
- `capacityBytes`
- `dailyUploadLimit`
- `dailyBytesLimit`
- `monthlyPriceGtq`
- `active`

Los valores de capacidad y precio se devuelven como cadenas de texto para conservar su precisión.

## 6. Verificación realizada

- Se ejecutó `npm run db:migrate` correctamente.
- Se aplicó la migración `008_paid_plans_catalog.sql`.
- Se consultó `http://127.0.0.1:3000/api/plans`.
- Se verificó que la API devuelve los cuatro planes activos.
- Se comprobaron los precios y capacidades configurados.

## 7. Pendientes antes del lanzamiento

- Confirmar formalmente los precios y características con el equipo.
- Definir las condiciones comerciales personalizadas de Enterprise.
- Implementar o verificar las restricciones de acceso SDK/API, prioridad y soporte según el alcance de los módulos correspondientes.
- Agregar pruebas automatizadas del catálogo.
- Verificar el comportamiento de las suscripciones pagadas cuando se implemente la facturación.

**Estado:** catálogo provisional implementado y verificado localmente; pendiente de aprobación comercial definitiva.
