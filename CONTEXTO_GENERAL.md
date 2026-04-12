# CONTEXTO_GENERAL — Ofirone / POSLite

Fecha: 2026-04-08
Proyecto: POSLite / OfirOne — monorepo web + mobile + shared

---

## Actualizacion reciente (2026-04-12) — IA operativa en web y onboarding compacto en mobile

- `web` ahora cubre dos brechas funcionales frente a mobile sin depender del modo offline:
  - nuevo `Centro IA` en `web/src/views/AIInsights.vue`, conectado al agente operativo via `web/src/services/opsRagAgent.service.js`
  - compras web ahora puede tomar o subir una factura para OCR y proponer proveedor + lineas en `web/src/views/Purchases.vue`
  - carga masiva web ahora suma un carril de `foto -> borrador -> importacion` en `web/src/views/BulkImports.vue`
- Nuevas utilidades y pruebas:
  - `web/src/utils/aiInsightsCenter.js`
  - `web/src/utils/purchaseInvoiceOcr.js`
  - `web/src/utils/productPhotoBulkImport.js`
  - `web/src/utils/__tests__/aiInsightsCenter.test.js`
  - `web/src/utils/__tests__/purchaseInvoiceOcr.test.js`
  - `web/src/utils/__tests__/productPhotoBulkImport.test.js`
- `mobile/src/screens/SetupScreen.js` ya no es solo launcher de modulos; ahora incluye:
  - flujo recomendado extendido
  - rutas guiadas a operacion
  - ayuda rapida/FAQ embebida
- Decision de producto vigente:
  - contabilidad avanzada y tenant management siguen `web-only`
  - IA operativa transversal y onboarding compacto ya quedan mejor alineados entre apps

## Actualizacion reciente (2026-04-12) — infraestructura de coverage + tests de servicios criticos

- `web/package.json` ahora expone `test:coverage` y `web/vitest.config.js` define cobertura V8 para `src/**/*.{js,vue}`.
- `mobile/package.json` ahora expone `test:coverage` y `collectCoverageFrom` para `src/**/*.{js,jsx}`.
- Se agregaron tests unitarios de servicios criticos con mocks de Supabase / Edge Functions:
  - web:
    - `web/src/services/__tests__/opsRagAgent.service.test.js`
    - `web/src/services/__tests__/purchaseInvoiceOcr.service.test.js`
    - `web/src/services/__tests__/productPhotoImport.service.test.js`
  - mobile:
    - `mobile/src/__tests__/invoiceAgent.service.test.js`
    - `mobile/src/__tests__/productPhotoImport.service.test.js`
- Para hacer los flujos mas testeables sin montar toda la UI, se extrajo logica de estado a utilidades puras:
  - `web/src/utils/aiInsightsViewModel.js`
  - `web/src/utils/purchasesInvoiceFlow.js`
  - `web/src/utils/bulkImportPhotoFlow.js`
  - `mobile/src/constants/setupGuideContent.js`

## Actualizacion reciente (2026-04-12) — OCR de imagen para pedido natural en POS web

- `web/src/views/PointOfSale.vue` ahora permite tomar o subir una imagen con texto para convertirla al carrito, no solo pegar el chat manualmente.
- El flujo nuevo:
  - optimiza la imagen en navegador
  - invoca la Edge Function configurada en `VITE_DEEPSEEK_OCR_EDGE_FUNCTION`
  - reutiliza el mismo parser de pedido natural ya existente en web
- Nuevos archivos principales:
  - `web/src/services/orderImageOcr.service.js`
  - `web/src/utils/orderImageOcr.js`
- Cobertura nueva:
  - `web/src/utils/__tests__/orderImageOcr.test.js`

## Actualizacion reciente (2026-04-10) — validacion de caja vencida centralizada en shared

- Se fortalecio `shared/utils/cashSessionUtils.js` para que la regla de expiracion de caja no quede duplicada entre web y mobile.
- Nuevas utilidades compartidas:
  - `getCashSessionState(session, maxHours)`
  - `buildCashSessionExpiredMessage(state)`
  - `validateCashSessionForOperation(session, maxHours, options)`
- Regla canonica vigente:
  - la sesion se considera vencida cuando `ageHours >= cash_session_max_hours`
  - si no hay sesion abierta y la operacion la requiere, la validacion devuelve `NO_OPEN_SESSION`
  - si la sesion supero el limite, la validacion devuelve `EXPIRED_SESSION` con un mensaje estandar
- Web ahora consume esta logica compartida en:
  - `web/src/composables/useTenantSettings.js`
  - `web/src/views/PointOfSale.vue`
  - `web/src/views/CashSessions.vue`
  - `web/src/views/Home.vue`
  - `web/src/views/LayawayDetail.vue`
  - `web/src/views/LayawayContracts.vue`
- Mobile ahora consume esta logica compartida en:
  - `mobile/src/lib/cashSession.js`
  - `mobile/src/screens/PointOfSaleScreen.js`
  - `mobile/src/screens/LayawayScreen.js`
- Ajuste UX importante:
  - `Home.vue` ya no deja hardcodeado el copy de `24 horas`; ahora usa el limite real configurado por tenant
- Cobertura nueva:
  - `web/src/utils/__tests__/cashSessionUtils.test.js`

## Actualizacion reciente (2026-04-10) — perfil explicito para APK release en mobile

- `mobile/eas.json` ahora expone un perfil dedicado `production-apk`.
- Regla operativa:
  - `production` sigue representando el release normal de Android
  - `production-apk` fuerza `android.buildType=apk` para obtener un instalable directo cuando se necesite compartir o probar fuera de store
  - el `postinstall` de `mobile` que parchea `llama.rn` se endurecio para EAS y ya no depende de `sed -i`, porque el build estaba fallando en `Install dependencies` con error generico
  - `mobile/eas.json` ahora fija `node: 20.19.4` porque el lock de RN 0.81.5/Metro ya exige esa version minima en varias dependencias

## Actualizacion reciente (2026-04-10) — POS alternativo tipo wizard en web

- `shared/utils/saleWizard.js` pasa a ser la fuente canonica del flujo guiado de venta para web y mobile.
- `web/src/views/PointOfSale.vue` ahora incluye una segunda entrada llamada `Venta guiada` sin reemplazar el POS clasico.
- `mobile/src/screens/PointOfSaleScreen.js` ahora tambien ofrece `Venta guiada` como flujo alternativo mediante `BottomSheetModal`.
- La estrategia vigente es:
  - mantener el POS actual como `modo rapido`
  - ofrecer un flujo alternativo guiado para ventas asistidas
  - reutilizar exactamente la misma logica de carrito, pagos, validaciones y creacion de venta
- El wizard de venta en ambas apps trabaja sobre 4 pasos:
  - cliente y contexto
  - productos
  - pago
  - confirmar
- La logica minima de navegacion y bloqueo vive en:
  - `shared/utils/saleWizard.js`
- Reglas funcionales del wizard:
  - si ya existe carrito, abre directamente en `Productos`
  - no permite avanzar a pago sin items
  - no permite confirmar si la caja no existe o esta vencida
  - no permite confirmar si falta dinero, si hay error de credito o si la fecha/hora manual es invalida
  - `Guardar en espera`, `Limpiar` y `Cobrar` reutilizan las mismas acciones del POS actual
  - al retomar una venta en espera, el wizard puede abrir directamente en productos
  - en mobile, `Ventas en espera` ya no interrumpe el flujo principal del POS; se movio a un acceso de header y al paso inicial del wizard
  - en mobile, la cabecera del POS se simplifico a dos accesos horizontales (`Ventas en espera` y `Venta guiada`)
  - en mobile, `Ventas en espera` ahora muestra un contador de borradores en espera
  - en mobile, la accion del ticket actual queda rotulada explicitamente como `Guardar en espera` y se agrupa junto a `Limpiar` y `Cobrar` en el bloque operativo final del POS rapido
- Cobertura nueva:
  - `web/src/utils/__tests__/saleWizard.test.js`
  - `mobile/src/__tests__/saleWizard.test.js`

## Actualizacion reciente (2026-04-10) — Wizard guiado de creacion de productos y alineacion web/mobile

- Se creo `shared/utils/productCreationWizard.js` como fuente canonica de perfiles y reglas del wizard de productos.
- El wizard reduce decisiones tecnicas iniciales en 6 perfiles guiados:
  - `sale_simple`
  - `sale_variants`
  - `component`
  - `manufactured`
  - `bundle`
  - `service`
- Regla UX vigente del wizard:
  - por defecto muestra solo lo esencial segun el perfil elegido
  - las combinaciones completas viven en una seccion de `opciones avanzadas`, colapsada por defecto
  - asi se preserva funcionalidad sin volver la pantalla principal a un formulario tecnico
  - `producto simple` implica una sola variante predeterminada
  - `componente` implica `RESELL + is_component=true` y se presenta como insumo para crear otros productos
  - el campo visible de stock en el wizard representa `alerta minima`, no el encendido/apagado del control de inventario
  - `0` en esa alerta significa `sin alerta minima`, no `sin inventario`
  - el control de inventario arranca en `No` por defecto para los perfiles fisicos; se activa solo si el usuario lo necesita
- Reglas centralizadas:
  - `component` siempre queda como `RESELL + is_component=true`
  - `manufactured` queda como `MANUFACTURED + production_type=ON_DEMAND`
  - `service` apaga inventario, vencimiento y componente
  - `variant_mode=multiple` ya no envia campos base al payload del producto
  - `buildProductDraftFromProduct()` reconstruye el draft de edicion con el mismo lenguaje del wizard
- Web:
  - nuevo componente `web/src/components/ProductCreationWizardDialog.vue`
  - nuevo componente `web/src/components/ProductVariantWizardDialog.vue`
  - `web/src/views/Products.vue` usa wizard para creacion y deja el dialogo legacy para edicion
  - `web/src/views/Products.vue` ahora abre tambien el wizard para edicion y deja variantes/BOM como complementos guiados
- Mobile:
  - nuevo componente `mobile/src/components/ProductCreationWizardSheet.js`
  - nuevo componente `mobile/src/components/ProductVariantWizardSheet.js`
  - `mobile/src/screens/ProductsScreen.js` usa wizard para creacion y deja el bottom sheet existente para edicion/fotos
  - `mobile/src/screens/ProductsScreen.js` ahora abre tambien el wizard para edicion; el sheet anterior queda como complemento de fotos/IA
  - se corrigio la inconsistencia donde `Componente` se guardaba como `MANUFACTURED`; ahora respeta `RESELL + is_component=true`
- Variantes en productos guiados:
  - como la BD auto-crea `Predeterminado`, el wizard reutiliza esa variante inicial cuando el perfil es `sale_variants` en vez de crear una segunda innecesaria
- Cobertura nueva:
  - `web/src/utils/__tests__/productCreationWizard.test.js`
  - `mobile/src/__tests__/productCreationWizard.test.js`
  - `web/src/utils/__tests__/productVariantWizard.test.js`
  - `mobile/src/__tests__/productVariantWizard.test.js`

## Actualizacion reciente (2026-04-10) — Wizard guiado de terceros

- Se creo `shared/utils/thirdPartyWizard.js` como fuente canonica para el flujo guiado de terceros.
- El wizard de terceros ahora arranca por defecto en `cliente`; `proveedor` y `cliente/proveedor` siguen disponibles como decision explicita.
- Tipos guiados activos:
  - `customer`
  - `supplier`
  - `both`
- Regla UX vigente:
  - crear y editar terceros usan el mismo patron guiado en web y mobile
  - el wizard pide primero rol + identidad, luego contacto, y deja lo fiscal/comercial en ajustes avanzados
- Web:
  - nuevo componente `web/src/components/ThirdPartyWizardDialog.vue`
  - `web/src/views/ThirdParties.vue` ya no abre el formulario largo como entrada principal; ahora usa el wizard
- Mobile:
  - nuevo componente `mobile/src/components/ThirdPartyWizardSheet.js`
  - `mobile/src/screens/ThirdPartiesScreen.js` ahora usa el wizard para crear y editar terceros
- Cobertura nueva:
  - `web/src/utils/__tests__/thirdPartyWizard.test.js`
  - `mobile/src/__tests__/thirdPartyWizard.test.js`

## Actualizacion reciente (2026-04-10) — Fotos de producto llevadas a web

- `mobile` ya tenia el flujo completo de fotos por producto sobre `product_media`, bucket privado `productmedia`, signed URLs y edge function `product-photo-analyzer`.
- `web` ahora reutiliza esa misma arquitectura con:
  - `web/src/services/productMedia.service.js`
  - `web/src/components/ProductMediaManager.vue`
  - `web/src/utils/productMediaHelpers.js`
- La edicion guiada de producto en `web/src/views/Products.vue` ya incluye el complemento de `Fotos del producto` dentro del slot suplementario del wizard.
- El flujo web ahora permite:
  - subir foto desde archivo o camara del navegador
  - ver galeria y preview
  - marcar portada
  - eliminar foto
  - aplicar sugerencias IA al formulario de producto
  - crear categoria sugerida por IA si aun no existe
- `web/src/services/products.service.js` ahora adjunta `media_count` y `cover_image_url` al listado y al detalle de producto para que la lista muestre miniatura y cantidad de fotos.
- Configuracion frontend nueva:
  - `VITE_PRODUCT_PHOTO_ANALYZER_EDGE_FUNCTION=product-photo-analyzer`
- Cobertura nueva:
  - `web/src/utils/__tests__/productMediaHelpers.test.js`

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

### Estado actual del suite (2026-04-10)

| Proyecto | Tests | Framework        |
|----------|-------|------------------|
| web      | 193   | Vitest 2.x       |
| mobile   | 159   | Jest + jest-expo ~54 |
| **Total**| **352** |                |

---

## Estructura del monorepo

```
ofirone/
├── shared/          # Utilidades puras compartidas entre web y mobile
│   ├── utils/
│   │   ├── discountCalculator.js
│   │   ├── saleCalculator.js
│   │   ├── taxCalculator.js
│   │   ├── pricingRuleEngine.js
│   │   ├── stringUtils.js        ← nuevo 2026-04-10
│   │   ├── cashSessionUtils.js   ← nuevo 2026-04-10
│   │   ├── appErrors.js          ← nuevo 2026-04-10
│   │   └── formatters.js         ← nuevo 2026-04-10
│   └── constants/
│       └── thirdParty.js         ← nuevo 2026-04-10
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

#### `stringUtils.js` — nuevo 2026-04-10
Utilidades puras de strings. Extraidas de `mobile/src/services/commandEngine/normalize.service.js`.

- `stripDiacritics(value)` — elimina tildes y diacríticos (NFD).
- `normalizeText(value)` — lowercase + sin diacríticos + sin especiales + trim.
- `normalizeCommandText(value)` — alias semántico de `normalizeText` para el command engine.
- `hashNormalizedText(value)` — hash DJB2 de 32 bits, devuelve hex de 8 chars.
- `normalizeCustomerName(value)` — elimina puntuación final y normaliza espacios.
- `normalizeSku(value, maxLength)` — mayúsculas + alfanumérico + truncado.

`mobile/src/services/commandEngine/normalize.service.js` ahora re-exporta desde aqui.

#### `cashSessionUtils.js` — nuevo 2026-04-10
Lógica pura de sesiones de caja. Extraida de `mobile/src/lib/cashSession.js`.

- `resolveCashSessionMaxHours(settings, fallback)` — lee `cash_session_max_hours` del tenant.
- `getCashSessionOpenedAt(sessionOrOpenedAt)` — extrae la fecha de apertura.
- `getCashSessionAgeHours(sessionOrOpenedAt, nowMs)` — edad en horas enteras.
- `isCashSessionExpired(sessionOrOpenedAt, maxHours, nowMs)` — si superó el límite.

`mobile/src/lib/cashSession.js` ahora re-exporta desde aqui.

#### `appErrors.js` — nuevo 2026-04-10
Sanitización y humanización de errores. Extraida de `web/src/utils/appErrors.js`.

- `humanizeAppError(error, context)` — convierte errores de BD/red a español legible. Reemplaza UUIDs, field names, errores conocidos (RLS, FK, unique, JWT, network).
- `serviceErrorResult(error, extra, context)` — wrapper estándar `{ success: false, error: ... }`.

`web/src/utils/appErrors.js` re-exporta desde aqui. Mobile puede importar directamente.

#### `formatters.js` — nuevo 2026-04-10
Formateo de moneda y fechas. Extraida de `web/src/utils/formatters.js`. Default locale: `'es-CO'`.

- `formatMoney(value, locale, currency)` — moneda con Intl (ej: `$1.500.000`).
- `formatMoneyShort(value)` — abreviado K/M (ej: `$1.5M`).
- `formatDate(date, locale)` — fecha corta.
- `formatDateTime(date, locale)` — fecha + hora corta.
- `formatDateTimeFull(date, locale)` — fecha + hora completa.

`web/src/utils/formatters.js` re-exporta inyectando `getCurrentLocaleTag()` como default locale (soporta es/en).
Mobile importa directamente desde shared (locale fijo `'es-CO'`).

#### `shared/constants/thirdParty.js` — nuevo 2026-04-10

- `DOCUMENT_TYPE_CODES` — array de tipos de documento Colombia: `['CC','NIT','CE','TI','PASSPORT','PEP','NUI','RUT']`.
- `TAX_REGIMES` — array con `{ value, shortLabel, fullLabel }` para los 4 regímenes DIAN.
- `TAX_REGIME_OPTIONS_MOBILE` — `{ value, label }` para selectores mobile.
- `TAX_REGIME_OPTIONS_WEB` — `{ value, title }` para `v-select` de Vuetify.

Usado en: `mobile/src/screens/ThirdPartiesScreen.js`, `web/src/components/ThirdPartyForm.vue`, `web/src/views/TenantConfig.vue`.

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
  - `appErrors.test.js` — 39 tests (nuevo 2026-04-09)

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
  - `deterministicParser.test.js` — 49 tests (nuevo 2026-04-09)
  - `manufacturing.test.js` — 26 tests (nuevo 2026-04-10)

### Stack mobile

- React Native + Expo ~54
- Supabase
- SQLite (expo-sqlite) para cola offline y cache local
- `offlineMode = useMemo(() => !session || !networkReachable, [...])` — valor derivado, no estado manual
- `warmPosCatalog` + `warmCustomersCatalog` + `warmPricingRules` — warmup al abrir POS
- IA: agente RAG (`ops-rag-agent` edge function), voz (Vosk), OCR + DeepSeek para facturas
- Push: `push-dispatcher` edge function (Expo/FCM)

### Modulos operativos mobile

POS (con lenguaje natural, voz, OCR de facturas), Compras (con lectura de factura IA), Inventario (operaciones, traslados), Caja, Cartera, Reportes (subtabs ventas/cajas), Lotes, Importacion masiva, Config tenant (billing visible), About, Onboarding, **Manufactura completa (2026-04-10)**.

#### Manufactura mobile — estado 2026-04-10

`mobile/src/screens/ProductionOrdersScreen.js` — ciclo completo operativo:
- Listar y filtrar ordenes por estado y sede
- Ver detalle: componentes requeridos, lineas consumidas, fechas, estado
- **Iniciar produccion** (`startProductionOrder`) — PENDING → IN_PROGRESS
- **Completar produccion** (`completeProductionOrder` → RPC `fn_complete_production`) — con cantidad producida y fecha de vencimiento opcional. Backend aplica FEFO, consume componentes, calcula costo real y actualiza `variant.cost` y `variant.price`.
- **Cancelar orden** (PENDING o IN_PROGRESS)
- **Crear nueva orden** (solo online): seleccion de BOM, sede, cantidad + verificacion de stock con `validateBOMAvailability` antes de crear.

`mobile/src/screens/BOMsScreen.js` — detalle completo:
- Listar y buscar BOMs
- Ver detalle: componentes con sku, cantidad, desperdicio %, costo unitario y costo de linea
- Costo total estimado calculado en frontend (identico a web)

Nuevas funciones en `mobile/src/services/inventoryCatalog.service.js`:
`getBOMById`, `getProductionOrderById`, `validateBOMAvailability`, `createProductionOrder`, `startProductionOrder`, `completeProductionOrder`, `cancelProductionOrder`, `listBomsForSelect`.

#### UX mobile — fix teclado y botones en formularios modales (2026-04-10)

Se corrigieron dos problemas visuales/de UX en todos los formularios modales de mobile:

**Problema 1 — Barra de botones muy grande en BottomSheetModal**

En `ProductsScreen`, `PurchasesScreen` (y otros que usan `BottomSheetModal`), el footer de botones tenía un `marginBottom: Math.max(0, androidBottomInset - 4)` redundante. `BottomSheetModal` ya aplica `paddingBottom: 14 + bottomInset + keyboardInset` al sheet, por lo que se duplicaba el espacio y la barra aparecía muy grande en dispositivos con navegación por gestos. Se eliminó el `marginBottom` redundante de todos los footers afectados.

**Problema 2 — Teclado tapa campos TextInput al fondo del formulario**

Se añadió `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"` a **16 pantallas** que usaban `Modal` regular sin protección de teclado. Patrón aplicado:

```jsx
<Modal>
  <View style={styles.modalOverlay}>
    <KeyboardAvoidingView style={styles.modalAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalBody}>
        <ScrollView keyboardShouldPersistTaps="handled">
          {/* campos + botones */}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </View>
</Modal>
```

`modalAvoider: { width: '100%' }` — añadido a estilos de cada pantalla.

Pantallas modificadas:
- `LocationsScreen`, `TaxesScreen` — también se añadió `ScrollView` (no tenían ninguno)
- `UnitsScreen`, `CategoriesScreen`, `PaymentMethodsScreen`, `TaxRulesScreen`, `PricingRulesScreen`, `CashRegistersScreen` — 1 Modal c/u
- `UsersScreen` — 2 Modals (editar usuario + cambiar contraseña)
- `RolesMenusScreen` — 3 Modals (rol + permisos + menus)
- `SalesHistoryScreen` — 2 Modals con TextInput (devolución + editar venta offline)
- `CarteraScreen`, `LayawayScreen` — 1 Modal c/u
- `ProductionOrdersScreen` — 2 Modals (detalle + crear orden)
- `ThirdPartiesScreen`, `CashAssignmentsScreen`, `BulkImportsScreen` — limpieza de `marginBottom` redundante en closeBtn

**Bonus — Botones estandarizados a fila horizontal**

En pantallas con botones apilados verticalmente (Guardar full-width + Cancelar pequeño a la derecha), se cambió a un `formFooter` row con ambos botones en `flex: 1` y `paddingVertical: 9`. Consistente con el patrón de `BottomSheetModal`.

```js
formFooter: { flexDirection: 'row', gap: 8, marginTop: 14 },
formFooterBtn: { flex: 1 },
primaryBtn: { backgroundColor: '#57d65a', borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
closeBtn: { backgroundColor: '#235ea9', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
```

Afecta: `LocationsScreen`, `TaxesScreen`, `UnitsScreen`, `CategoriesScreen`, `PaymentMethodsScreen`, `TaxRulesScreen`, `PricingRulesScreen`, `CashRegistersScreen`, `UsersScreen`, `RolesMenusScreen`.

`BottomSheetModal` (`mobile/src/components/BottomSheetModal.js`) ya maneja `KeyboardAvoidingView` internamente — las pantallas que lo usan (`ProductsScreen`, `PurchasesScreen`, `CashSessionsScreen`, `InventoryScreen`) no necesitaron cambios de teclado.

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
| 2026-04-09 | Nuevos tests: `appErrors.test.js` (web, 39 tests) y `deterministicParser.test.js` (mobile, 49 tests). Total suite: 326 tests. |
| 2026-04-10 | Centralización en shared/: `stringUtils.js`, `cashSessionUtils.js`, `appErrors.js`, `formatters.js`, `constants/thirdParty.js`. Archivos origen reemplazados por re-exports. Sin cambios en importadores existentes. |
| 2026-04-10 | Manufactura mobile completa: ciclo de órdenes (crear/iniciar/completar/cancelar), detalle BOM con componentes y costos, verificación de stock. 26 tests nuevos. Mobile suite: 159 tests. |
| 2026-04-10 | UX mobile — fix de teclado y botones en formularios modales. Ver sección abajo. |
