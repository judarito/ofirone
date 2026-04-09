# CONTEXTO_GENERAL — Ofirone / POSLite

Fecha: 2026-04-08
Proyecto: POSLite / OfirOne — monorepo web + mobile + shared

---

## Regla de versionado (obligatoria)

Este archivo representa el contexto activo del monorepo completo.
Cada app tiene ademas su propio archivo de contexto local:

- Web:    `web/CONTEXTO_ULTIMO.md`
- Mobile: `mobile/docs/CONTEXTO_MOBILE.md`

Cuando se realice un cambio relevante en cualquier proyecto:
1. Actualizar este archivo con el resumen del cambio.
2. Actualizar el contexto del proyecto afectado.
3. Si el cambio toca `shared/`, actualizar ambos contextos locales.

---

## Regla de desarrollo vigente — TDD obligatorio

A partir de 2026-04-08, **todo codigo nuevo debe tener su test antes o junto con la implementacion**.

### Principios

- No se acepta logica nueva sin test que la cubra.
- Prioridad de testing: primero las funciones puras (calculadoras, motores, utils), luego integracion.
- Los tests deben correr localmente sin errores antes de considerar la tarea terminada.
- Si se modifica un archivo existente, revisar si sus tests siguen pasando y ampliarlos si la modificacion introduce comportamiento nuevo.

### Comandos

```bash
# Web (Vitest)
cd web && npm test          # run once
cd web && npm run test:watch # watch mode

# Mobile (Jest + jest-expo)
cd mobile && npm test          # run once
cd mobile && npm run test:watch # watch mode
```

### Donde viven los tests

```
web/src/utils/__tests__/        ← tests de utils pure (Vitest)
mobile/src/__tests__/           ← tests de utils pure y logica mobile (Jest)
```

### Estado actual del suite (2026-04-08)

| Proyecto | Tests | Framework        |
|----------|-------|------------------|
| web      | 154   | Vitest 2.x       |
| mobile   | 84    | Jest + jest-expo ~54 |
| **Total**| **238** |                |

---

## Estructura del monorepo

```
ofirone/
├── shared/          # Utilidades puras compartidas entre web y mobile
│   └── utils/
│       ├── discountCalculator.js
│       ├── saleCalculator.js
│       ├── taxCalculator.js
│       └── pricingRuleEngine.js   ← nuevo 2026-04-08
├── web/             # Vue 3 + Vuetify + Supabase (PWA)
└── mobile/          # React Native + Expo + Supabase
```

### Regla de imports mobile → shared

`mobile/metro.config.js` agrega `../shared` a `watchFolders`.
Los imports usan rutas relativas desde el archivo que importa:

```js
// Desde mobile/src/screens/
import { resolveApplicableRule, applyPriceRule } from '../../../shared/utils/pricingRuleEngine';

// Desde mobile/src/services/
import { calculateDiscount } from '../../shared/utils/discountCalculator';
```

### Regla de imports web → shared

Web usa el alias `@/utils/` (apunta a `web/src/utils/`).
Los archivos en `shared/` usan imports relativos (`./`) para ser usables desde mobile.
Los tests de web importan shared con ruta relativa desde `__tests__/`:

```js
import { ... } from '../../../../shared/utils/pricingRuleEngine';
```

---

## Estado tecnico actual — shared/

### Calculadores centralizados (2026-04-08)

Todos los archivos en `shared/utils/` son JavaScript puro, sin dependencias de framework.

#### `discountCalculator.js`
- `calculateDiscount(subtotal, value, type)` — calcula monto de descuento AMOUNT o PERCENT. Lanza en casos invalidos.
- `validateDiscount(subtotal, value, type)` — retorna `{ valid, error }`. Trata `<= 0` como sin descuento (early-return valido).
- `calculateLineTotal(line)` — subtotal + descuento + impuesto por linea.
- `convertDiscountType(subtotal, value, from, to)` — convierte AMOUNT ↔ PERCENT.
- `formatDiscount(value, type)` — formato UI. Usa `toLocaleString()` (separador de miles depende del locale).

#### `saleCalculator.js`
Fuente canonica de calculos de venta. Importa de `./discountCalculator` (ruta relativa, no alias).

Funciones principales:
- `getDocumentLineSubtotal(line, opts)` — `qty * price`, soporta campos configurables.
- `normalizeLineDiscountInput(subtotal, value, type)` — clampea y valida, retorna `{ valid, adjusted, sanitizedValue, ... }`.
- `getCartLineDiscountAmount(line)` — descuento de linea calculado.
- `getCartLineGlobalDiscountAmount(line)` — descuento global prorrateado ya asignado a la linea.
- `getCartLineTotalDiscountAmount(line)` — suma de ambos.
- `getCartLineNetSubtotal(line)` — subtotal bruto - descuento de linea.
- `allocateGlobalDiscountAcrossLines(lines, amount)` — distribuye el descuento global proporcional al neto de cada linea; la ultima absorbe el residuo de redondeo.
- `validateCartDiscounts(lines)` — valida carrito completo (campos `discount_line`/`discount_line_type`).
- `validateSalePayloadDiscounts(lines)` — valida payload (campos `discount`/`discount_type`).
- `getMaxGlobalDiscountAmount(lines)` — maximo descuento global aplicable.
- `summarizeCartTotals(lines, opts)` — acumula subtotal, descuentos, impuestos, total y taxDetails por codigo.
- `buildSalePayloadLines(lines)` — arma el array para `sp_create_sale`. Si `price_includes_tax`, divide `unit_price` y `discount` por `(1 + tax_rate)`.

#### `taxCalculator.js`
- `applyLineTaxes(line, taxResult, priceAfterDiscount)` — muta la linea in-place.
  - `price_includes_tax=false`: base = precio, tax = base * rate, total = base + tax.
  - `price_includes_tax=true`: total = precio, base = total / (1 + rate), tax = total - base.
  - `rate=0` o `success=false`: tax=0, base=total=precio.
- **Diferencia con la version local de mobile**: mobile deriva `tax_amount = line_total - base_amount` para garantizar consistencia exacta. El archivo shared usa `Math.round(tax)` independiente. Mobile sigue usando su version local por esta razon.

#### `pricingRuleEngine.js` — nuevo 2026-04-08
Motor puro de resolucion y aplicacion de reglas de precio. Sin dependencias.

```js
resolveApplicableRule(rules, { variantId, productId, categoryId, locationId })
// → regla ganadora o null

applyPriceRule(baseCost, rule)
// → precio entero o null (si FIXED, costo=0, o sin regla)
```

Prioridad de scope: `VARIANT(50) > PRODUCT(40) > CATEGORY(30) > LOCATION(20) > TENANT(10)`.
Desempate: mayor `priority` gana.
Metodo MARKUP: `price = cost * (1 + markup% / 100)` + redondeo (NONE/UP/DOWN/NEAREST).
Metodo FIXED: retorna `null` → el POS usa `variant.price` sin modificar.

**Nota de punto flotante**: `N * (1 + p/100)` puede dar `X.499...` por IEEE 754.
En tests de NEAREST, evitar el limite exacto 0.5. Usar markups como 37% donde `13.699` redondea a 14 de forma robusta.

---

## Estado tecnico actual — web/

Contexto completo en `web/CONTEXTO_ULTIMO.md` (actualizado 2026-04-05).

### Ultimas modificaciones relevantes (2026-04-08)

#### Calculos de precio centralizados en shared

`web/src/utils/saleCalculator.js` ahora importa de `./discountCalculator` (ruta relativa).
Antes usaba el alias `@/utils/discountCalculator` que no funciona fuera del proyecto web.
Este cambio permite que `shared/utils/saleCalculator.js` sea importable desde mobile.

#### Testing web configurado

- Framework: Vitest 2.x
- Config: `web/vitest.config.js` — alias `@` apunta a `web/src/`, environment `node`.
- Tests: `web/src/utils/__tests__/`
  - `discountCalculator.test.js` — 43 tests
  - `taxCalculator.test.js` — 11 tests
  - `saleCalculator.test.js` — 63 tests
  - `pricingRuleEngine.test.js` — 37 tests

### Stack web

- Vue 3 + Vuetify 3 + Vite
- Supabase (auth, DB, realtime, edge functions)
- `src/utils/queryCache.js` — cache L1 (memory) + L2 (sessionStorage), aislado por tenant
- `src/utils/appErrors.js` — sanitizador central `humanizeAppError`
- `src/utils/saleCalculator.js` — calculos de venta canonicos
- Router con lazy loading, guard de billing en navegacion

### Modulos operativos web

POS, Compras, Inventario, Caja, Cartera, Contabilidad (completa con cierre, retenciones, automatizacion, IA), Reportes, Lotes, Importacion masiva, Configuracion tenant, Superadmin (billing, roles, tenants).

---

## Estado tecnico actual — mobile/

Contexto completo en `mobile/docs/CONTEXTO_MOBILE.md` (actualizado 2026-04-05).

### Ultimas modificaciones relevantes (2026-04-08)

#### Metro config para imports desde shared

`mobile/metro.config.js` (nuevo) agrega `../shared` a `watchFolders`.
Permite que mobile importe utilidades puras desde `shared/utils/` usando rutas relativas.

#### Motor de reglas de precio offline — nuevo

`mobile/src/services/pos.service.js`:
- `warmPricingRules(tenantId, locationId)` — fetch de reglas activas + guarda en cache `pos-pricing-rules:{tenantId}:{locationId}`.
- `getPricingRulesFromCache(tenantId, locationId)` — lectura offline.
- `warmPosCatalog` ahora incluye `category_id` en el select del producto para que el motor pueda resolver reglas de scope CATEGORY.

`mobile/src/screens/PointOfSaleScreen.js`:
- `pricingRulesRef = useRef([])` — almacena reglas sin disparar re-render.
- Warmup: carga reglas junto con catalogo y clientes (online) o desde cache (offline).
- `upsertVariantInCart`: aplica `resolveApplicableRule` + `applyPriceRule` sobre `variant.cost` antes de asignar `initialUnitPrice`. Si el resultado es `null` (FIXED, costo=0, sin reglas), usa `variant.price` como siempre.

#### Testing mobile configurado

- Framework: Jest 29 + jest-expo ~54
- Config: `jest` en `mobile/package.json`, preset `jest-expo`, `babel.config.js` con `babel-preset-expo`.
- Tests: `mobile/src/__tests__/`
  - `pricingRuleEngine.test.js` — 45 tests (incluye 5 escenarios POS offline)
  - `saleCalculator.test.js` — 39 tests

### Stack mobile

- React Native + Expo ~54
- Supabase
- SQLite (expo-sqlite) para cola offline y cache local
- `offlineMode = useMemo(() => !session || !networkReachable, [...])` — valor derivado, no estado manual
- `warmPosCatalog` + `warmCustomersCatalog` + `warmPricingRules` — warmup al abrir POS
- IA: agente RAG (`ops-rag-agent` edge function), voz (Vosk), OCR + DeepSeek para facturas
- Push: `push-dispatcher` edge function (Expo/FCM)

### Modulos operativos mobile

POS (con lenguaje natural, voz, OCR de facturas), Compras (con lectura de factura IA), Inventario (operaciones, traslados), Caja, Cartera, Reportes (subtabs ventas/cajas), Lotes, Importacion masiva, Config tenant (billing visible), About, Onboarding.

---

## Reglas de producto vigentes (transversales)

### Listas

Toda lista nueva en web usa `<ListView>` (`src/components/ListView.vue`).
En contabilidad esto es obligatorio sin excepcion para modo LIST.

### Modales y theming

Los `v-dialog` de Vuetify se teletransportan fuera del arbol del layout.
El theming de modales no puede depender de `.ofir-shell--dark/.light`.
Aplicar clases explicitas `--dark`/`--light` dentro del propio `v-card`.

### Cache

- No cachear: stock operativo, caja, alertas, credito disponible, estados transaccionales.
- Toda clave de cache debe estar aislada por `tenantId`.
- No usar `localStorage` para datos operativos de lectura frecuente.

### Billing

- Enforcement activo en router (web) y en `sp_create_sale` path.
- Rutas seguras sin bloqueo comercial: `/`, `/about`, `/help`, `/tenant-config`, `/setup`.
- Pendiente: checkout real, webhooks, renovacion automatica, pantalla de pago para tenant.

### Errores

Web: `humanizeAppError(error, context)` en `src/utils/appErrors.js`.
Nunca exponer UUIDs, nombres de constraints ni mensajes crudos de BD en la UI.

---

## Migraciones pendientes de ejecutar en Supabase

| Archivo | Descripcion | Estado |
|---------|-------------|--------|
| `web/migrations/FIX_SALE_COUNTERS_RLS.sql` | Redefine `fn_next_sale_number` como SECURITY DEFINER para evitar error RLS en `sale_counters` | Pendiente ejecucion manual |

---

## Historial de cambios en este archivo

| Fecha      | Cambio |
|------------|--------|
| 2026-04-08 | Creacion del archivo. Incluye setup de testing (Vitest web + Jest mobile), `pricingRuleEngine.js` en shared, metro.config mobile, warmup de reglas de precio en POS, regla TDD obligatoria. |
