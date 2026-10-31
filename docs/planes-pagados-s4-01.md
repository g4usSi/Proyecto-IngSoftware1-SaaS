# S4-01: Catálogo y ajuste de cuotas

## Acuerdo vigente del 14/10/2026

Geovanny confirmó en la revisión de S4-01 el cambio a dólares estadounidenses,
Estándar a US$8, Pro a US$15 y Enterprise a US$40 con **200 GB incluidos**.
Enterprise suma **US$0.20 por GB-mes adicional**, proporcional al tiempo de uso.
Esta es la opción elegida para demanda variable en retail. Esta matriz sustituye
los precios provisionales en GTQ y los 500 GB de Enterprise de la migración 008.

| Plan / código | Precio mensual USD | Capacidad lógica | Máximo de subidas diarias | Máximo de bytes diarios |
| --- | --- | --- | --- | --- |
| Free / `free` | 0.00 | 2 GB | 10 | 200 MB |
| Estándar / `standard` | 8.00 | 25 GB | Sin límite | 500 MB |
| Pro / `pro` | 15.00 | 100 GB | Sin límite | Sin límite |
| Enterprise / `enterprise` | 40.00 incluye 200 GB; 0.20 por GB-mes adicional | 200 GB base | Sin límite | Sin límite |

Estándar es el nombre canónico del nivel llamado Básico en la propuesta inicial.
Free conserva su capacidad, sus dos límites diarios y la asignación al registrarse.

## Unidades, consumo y vigencia

- Moneda: **USD**, sin conversión automática desde GTQ.
- 1 GB = 1,000,000,000 bytes y 1 MB = 1,000,000 bytes.
- La capacidad cuenta bytes originales por referencia lógica del usuario, incluida
  la papelera, más las reservas pendientes al admitir una carga. Deduplicar el
  archivo físico no descuenta el consumo lógico de otra cuenta.
- Los límites diarios son independientes. Free admite hasta 10 subidas **y**
  200 MB; exceder cualquiera bloquea la siguiente admisión. El día se determina
  en `America/Guatemala`. Borrar no devuelve el consumo diario.
- `null` significa sin límite en ese campo. Todos conservan el máximo técnico de
  25 MB por archivo y su capacidad total; no equivale a almacenamiento ilimitado.
- Planes pagados: un **mes calendario**, conservando la hora local en
  `America/Guatemala` y ajustando al último día del mes destino si el día inicial
  no existe. Ejemplos: 31/01/2027 → 28/02/2027; 31/01/2028 → 29/02/2028.
  Free no tiene vencimiento periódico. La contratación y la renovación aplican
  esta regla; ver [suscripciones y pagos](api.md#suscripciones-y-pagos-s4-02-y-s4-03).

## Enterprise

**Estado actual: la tarifa de excedente se publica, pero no se mide ni se cobra.**
El pago de Enterprise es de US$40 y su capacidad operativa se mantiene en 200 GB.
Lo que sigue es el contrato acordado por si se implementa.

La base mensual de US$40 incluye los primeros **200 GB**. Sólo el excedente genera
cargo variable. Medir el almacenamiento lógico publicado por tiempo, sin cobrar
reservas pendientes ni tráfico acumulado de subida. La papelera conserva consumo
hasta el borrado definitivo, igual que la cuota actual.

Fórmula: dividir el período mensual en intervalos de consumo constante y calcular:

```text
GB-mes adicionales = suma(max(0, bytes lógicos - 200000000000) × duración del intervalo)
                     / (1000000000 × duración total del período)
total USD = 40.00 + 0.20 × GB-mes adicionales
```

Usar la duración real del mes calendario, no fijar todos los meses en 30 días.
No redondear cada intervalo ni cada GB; conservar precisión y redondear el cargo
variable final a centavos, mitad hacia arriba. No compensar un intervalo con
excedente usando otro por debajo del cupo incluido. Borrar una imagen deja de
acumular consumo futuro, sin borrar el consumo ya medido del período.

| Escenario en un período de 30 días | Cargo variable USD | Total USD |
| --- | --- | --- |
| Hasta 200 GB todo el período | 0.00 | 40.00 |
| 300 GB todo el período | 20.00 | 60.00 |
| 300 GB durante 3 días; hasta 200 GB los otros 27 | 2.00 | 42.00 |
| 250 GB durante 15 días; hasta 200 GB los otros 15 | 5.00 | 45.00 |

Estos ejemplos describen el contrato, no cobros ejecutados. El consumo diario de
subidas no sirve para reconstruir GB-mes almacenados. No utilizar bytes físicos
WebP ni el total actual de almacenamiento como sustitutos del historial por tiempo.

El paquete base conserva un límite operativo de 200 GB. Admitir almacenamiento
adicional requiere implementar y autorizar una ampliación por suscripción, con la
medición anterior y un límite acordado.
Las condiciones personalizadas requieren un acuerdo aparte. SDK por nivel,
prioridad de procesamiento y soporte son propuestas de alcance posterior; no
se publican como permisos ni prestaciones ya implementados. La API autenticada
actual sigue sirviendo a Free y a los demás planes según sus permisos existentes.

## Migraciones y conservación de datos

- `002_seed_free_plan.sql`: origen del plan Free.
- `008_paid_plans_catalog.sql`: catálogo provisional publicado por Elden.
- `009_plan_quota_terms.sql`: moneda USD, importes, vigencia, tarifa de consumo
  y capacidad base Enterprise de 200 GB acordados en esta revisión.

Las migraciones publicadas se conservan sin editar. La 009 mantiene IDs y
relaciones; no crea usuarios, no contrata planes, no borra imágenes ni modifica
reservas o consumo diario. Si una cuenta Enterprise anterior supera 200 GB,
conserva sus datos y las nuevas admisiones se rechazan por capacidad. Requiere
liberar capacidad o acordar un cambio posterior; no hay eliminación automática.

Desde la raíz del repositorio:

```powershell
npm run db:migrate
```

El migrador registra checksums y evita reaplicar una migración ya ejecutada.
`monthly_price_gtq` pasa a llamarse `monthly_price` en SQL. El precio se interpreta
siempre junto con `currency`; ningún importe USD se almacena como precio GTQ.

## Contrato de GET /api/plans

Endpoint público. Devuelve `200` con `{ "data": [...] }`, incluyendo solamente
planes activos y ordenando por capacidad y código: Free, Estándar, Pro, Enterprise. Identificar
los planes por `code`/`id`, no por su posición.

| Campo | Tipo / significado |
| --- | --- |
| `id`, `code`, `name` | Identidad y nombre del plan |
| `capacityBytes` | String decimal de capacidad lógica |
| `dailyUploadLimit` | Entero o `null` |
| `dailyBytesLimit` | String decimal o `null` |
| `monthlyPrice` | String decimal del importe fijo o base mensual |
| `currency` | `USD` para el catálogo acordado |
| `billingPeriod` | `none` para Free; `calendar_month` para los pagados |
| `pricingModel` | `fixed` o `base_plus_storage` |
| `storagePricePerGbMonth` | `"0.20"` por GB-mes adicional en Enterprise; `null` en otros planes |
| `includedStorageBytes` | `"200000000000"` para Enterprise; `null` cuando no hay tarifa variable |
| `storageBillingBasis` | `time_weighted_excess` para Enterprise; `null` en otros planes |
| `monthlyPriceGtq` | Campo anterior, deprecado. `null` para USD; sólo contiene un importe si `currency` es `GTQ` |
| `active` | Booleano |

Ejemplo de Enterprise; `id` es el UUID devuelto por PostgreSQL:

```json
{
  "code": "enterprise",
  "name": "Enterprise",
  "capacityBytes": "200000000000",
  "dailyUploadLimit": null,
  "dailyBytesLimit": null,
  "monthlyPrice": "40.00",
  "currency": "USD",
  "billingPeriod": "calendar_month",
  "pricingModel": "base_plus_storage",
  "storagePricePerGbMonth": "0.20",
  "includedStorageBytes": "200000000000",
  "storageBillingBasis": "time_weighted_excess",
  "monthlyPriceGtq": null,
  "active": true
}
```

Catálogo sin planes activos: `200`, `{ "data": [] }`. Base de datos o migraciones
no disponibles: `503 DATABASE_UNAVAILABLE`, sin información interna. La guía de
consumo está en [frontend-80-contratos.md](frontend-80-contratos.md).

Pruebas: `paid-plans.test.js` (contrato HTTP e indisponibilidad) y
`paid-plans.integration.test.js` (PostgreSQL real). Registro de la revisión:
[historial de Elden](historial/elden.md#catálogo-en-usd-s4-01-14102026).
