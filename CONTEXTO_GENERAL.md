# CONTEXTO_GENERAL — Ofirone / POSLite

Fecha: 2026-04-22
Proyecto: POSLite / OfirOne — monorepo web + mobile + shared

---

## Actualizacion reciente (2026-05-04) — Mercado Pago + emails centralizados con Resend

- Se integro Mercado Pago para tienda online en modo multi-tenant:
  - cada tenant guarda sus propias credenciales de Mercado Pago en backend
  - `mercadopago-create-preference-v2` crea preferencias de pago
  - `mercadopago-webhook` sincroniza pagos gateway y revalida contra Mercado Pago
  - el flujo soporta retorno `success/failure/pending` con estado publico del pedido
- Se centralizo el envio de emails:
  - nueva migracion `shared/supabase/migrations/ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql`
  - nueva Edge Function `shared/supabase/functions/notification-dispatcher/index.ts`
  - nueva documentacion `shared/supabase/EMAIL_NOTIFICATION_SYSTEM.md`
  - tabla canonica `notification_outbox`
  - deduplicacion fuerte por `channel + dedupe_key`
- Procesos cubiertos por email:
  - pedidos online pendientes/aprobados/rechazados
  - ventas POS
  - devoluciones
  - plan separe y abonos
  - cartera/credito
  - cuentas por pagar y pagos a proveedor
  - alertas operativas
  - usuarios creados
  - importaciones masivas finalizadas
  - suscripciones de tenant
- Regla operativa:
  - ningun modulo debe llamar Resend directamente
  - todo email debe encolarse con `fn_enqueue_email_notification(...)`
  - `notification-dispatcher` procesa la cola y marca `sent/failed`
  - un mismo evento logico debe definir `dedupe_key` estable para evitar correos repetidos y sobrecostos
- Secrets requeridos en Supabase Edge Functions:
  - `RESEND_API_KEY`
  - `RESEND_FROM_EMAIL`
  - `RESEND_FROM_NAME`
  - `PUBLIC_APP_URL`

## Actualizacion reciente (2026-04-22) — alertas de pedidos online llegan a mobile (push + tab de gestion)

- Se cerro la brecha entre web y mobile para alertas operativas de tienda online.
- Arquitectura de canales:
  - `system_alerts` (tabla operativa) sigue siendo la fuente canonica para AMBAS apps
  - `notifications` (tabla por usuario) es el canal de push/in-app personal — ahora tambien recibe pedidos online
- Cambios backend:
  - nueva migracion `shared/supabase/migrations/ONLINE_ORDER_MOBILE_NOTIFICATIONS.sql`
  - reemplaza `fn_upsert_online_order_alert` para que, ademas de escribir en `system_alerts`, emita a `notifications` via `fn_emit_notification_event` con dedupe de 30 min
  - el emit esta envuelto en `BEGIN/EXCEPTION` para que un fallo en la notificacion no aborte la alerta operativa
- Cambios mobile (nuevos archivos):
  - `mobile/src/services/onlineOrders.service.js` — fetch de ordenes manuales con lineas y reservas, confirmar y rechazar via RPC, suscripcion a `system_alerts` para refresh en tiempo real
  - `mobile/src/services/alerts.service.js` — lectura de `system_alerts` por tipo con realtime subscription
  - `mobile/src/hooks/useOnlineOrderAlerts.js` — hook que mantiene el conteo de alertas ONLINE_ORDER en tiempo real (para badge del tab)
- Cambios mobile (modificados):
  - `mobile/src/screens/SalesHistoryScreen.js` ahora tiene tabs `Historial` y `Pedidos online`
    - badge rojo en el tab muestra pendientes en tiempo real via `useOnlineOrderAlerts`
    - tab `Pedidos online` lista ordenes con filtros de estado y buscador
    - botones `Confirmar` y `Rechazar` abren modal de accion con campo de referencia/nota
    - confirmar llama `fn_confirm_online_manual_order` y crea la venta POS real
    - rechazar llama `fn_reject_online_manual_order` y libera las reservas de stock
    - la lista se refresca en tiempo real via subscription a `system_alerts`
- Regla operativa:
  - cuando llega un pedido online, mobile recibe TANTO una notificacion en el bell (via `notifications`) COMO el tab de pedidos online actualiza en tiempo real
  - el bell muestra la notificacion con topic `online_order` (ya formateado por `NotificationsModal.inferTopic`)
  - el tab permite gestionar (confirmar/rechazar) sin salir de la app mobile
- Suite de tests: 200 pasando, 5 fallando preexistentes — sin regresiones

## Actualizacion reciente (2026-04-22) — tienda online operativa con branding, carrito, reservas y gestion desde ventas

- Se implemento un MVP funcional de tienda online por tenant sin romper el flujo actual del POS.
- La configuracion base de tienda vive en:
  - `web/src/components/OnlineStoreSettingsCard.vue`
  - `web/src/services/onlineStore.service.js`
  - `web/src/views/TenantConfig.vue`
- La tienda publica ahora vive en:
  - `web/src/views/PublicStorefront.vue`
  - `web/src/router/index.js`
  - `web/src/App.vue`
- Capacidades ya activas del storefront:
  - una tienda por tenant
  - slug publico `/s/:slug`
  - branding por marca con logo, header, colores y link de retorno a landing
  - catalogo publicable por variante
  - categorias y buscador
  - imagen de producto con fallback visual si no existe portada
  - carrito y checkout publico
- Backend compartido nuevo y/o actualizado en `shared/supabase/migrations`:
  - `ADD_ONLINE_STORE_MVP.sql`
  - `ADD_ONLINE_STORE_PUBLIC_CATEGORIES.sql`
  - `ADD_ONLINE_STORE_PUBLIC_IMAGES.sql`
  - `FIX_ONLINE_STORE_CHECKOUT_STOCK_LOCK.sql`
  - `FIX_ONLINE_STORE_SP_CREATE_SALE_SIGNATURE.sql`
  - `ONLINE_STORE_MANUAL_PAYMENT_HOLD_FLOW.sql`
  - `ONLINE_STORE_PAYMENT_PROOF_AND_GATEWAY_READY.sql`
- Regla operativa vigente del checkout online:
  - si el pago es manual, el pedido NO crea la venta inmediatamente
  - primero se crea `online_orders` en estado pendiente
  - se generan `online_order_lines`
  - se crean reservas en `online_order_reservations`
  - `fn_online_store_available_qty(...)` descuenta reservas activas para bloquear stock online mientras el pago esta pendiente
  - la venta POS real se crea solo al confirmar el pago desde backoffice
- Operacion de ventas online centralizada:
  - `web/src/views/Sales.vue` ahora tiene tab `Ventas online`
  - desde ahi se pueden ver pedidos pendientes, confirmar pago o rechazar y liberar stock
  - una vez confirmado, la venta entra al flujo normal del POS
- Checkout online preparado para evolucion de pagos:
  - `MANUAL` activo
  - `GATEWAY` visible como camino futuro
  - el cliente ya puede adjuntar comprobante manual
  - el soporte se guarda en `payment_payload.payment_proof_url`
- Storage relevante:
  - bucket `storefront` se usa para branding y comprobantes publicos de pago
  - bucket `productmedia` se usa para imagenes de producto en la tienda publica
- Decision de producto vigente:
  - configuracion de tienda sigue en `TenantConfig > Tienda online`
  - operacion diaria de pedidos online vive en `Ventas > Ventas online`
  - `Ventas > Historial de Ventas` sigue siendo la bandeja de ventas POS y ventas online ya confirmadas

## Actualizacion reciente (2026-04-16) — backend Supabase compartido ya no vive duplicado en web/mobile

- Se ejecuto la unificacion del backend compartido entre `web` y `mobile`.
- La fuente canonica del backend comun ahora vive en:
  - `shared/supabase/migrations`
  - `shared/supabase/functions`
- Estado actual del backend compartido:
  - `145` migraciones comunes entre `web` y `mobile` quedaron alineadas y sin divergencias entre ambas apps
  - `2` Edge Functions compartidas quedaron canonizadas:
    - `create-tenant-user`
    - `chat-order-parser`
- Las rutas historicas de despliegue no se eliminaron, pero dejaron de ser copias fisicas independientes:
  - `web/migrations/*` y `mobile/migrations/*` para archivos compartidos ahora apuntan por symlink a `shared/supabase/migrations/*`
  - `web/supabase/functions/create-tenant-user/index.ts`
  - `mobile/supabase/functions/create-tenant-user/index.ts`
  - `web/supabase/functions/chat-order-parser/index.ts`
  - `mobile/supabase/functions/chat-order-parser/index.ts`
  - todos esos paths compartidos ahora apuntan a `shared/supabase/functions/*`
- Regla operativa nueva:
  - si un archivo aparece en `shared/supabase/shared-migrations.txt` o `shared/supabase/shared-functions.txt`, se edita primero en `shared/supabase`
  - despues se actualizan links o se usa el script:
    - `scripts/sync-shared-supabase.sh link`
    - `scripts/sync-shared-supabase.sh check`
    - `scripts/sync-shared-supabase.sh sync` solo como fallback para entornos sin soporte fiable de symlink
- Lo que sigue fuera de `shared` es backend realmente especifico de producto:
  - `web`: `accounting-queue-worker`, `deepseek-proxy`
  - `mobile`: `deepseek-ocr-proxy`, `ops-rag-agent`, `product-photo-analyzer`, `product-photo-parser`, `push-dispatcher`

## Actualizacion reciente (2026-04-16) — plan separe queda endurecido y compartido entre apps

- Se cerro una tanda de consistencia funcional de `plan separe` entre `web`, `mobile` y backend.
- La logica transversal del contrato ahora vive en:
  - `shared/utils/layawayContract.js`
- Esa capa compartida centraliza:
  - calculo de lineas y totales
  - borradores y saneamiento de cuotas
  - etiquetas de estado
  - deteccion de `due soon`, vencido y auto-expiracion
- Backend compartido nuevo:
  - `shared/supabase/migrations/LAYAWAY_OPERATIONAL_HARDENING.sql`
- La migracion endurece tres reglas operativas:
  - `sp_create_layaway(...)` ya respeta `reserve_stock_on_layaway`
  - contratos guardan si realmente reservaron stock en `stock_reserved_on_create`
  - cancelacion/completado solo liberan reserva si esa reserva existio
- Tambien agrega `fn_expire_due_layaways(...)` para expirar automaticamente contratos vencidos con saldo pendiente.
- `web` y `mobile` ahora refrescan ese estado operativo antes de listar, ver detalle, cobrar o completar contratos:
  - `web/src/services/layaway.service.js`
  - `mobile/src/services/layaway.service.js`
- Paridad funcional nueva:
  - `web` ya expone cuotas dentro del flujo de creacion y del detalle
  - `mobile` ya no queda solo en seguimiento/cobro; ahora tambien puede crear contratos, registrar abono inicial, definir cuotas y expirar manualmente
- Cobertura agregada para esta tanda:
  - `web/src/utils/__tests__/layawayContract.test.js`
  - `web/src/services/__tests__/layaway.service.test.js`
  - `mobile/src/__tests__/layaway.service.test.js`

## Actualizacion reciente (2026-04-16) — recovery de password en web ya no colisiona con sesion activa

- El flujo de restablecimiento de contraseña en `web` ya no redirige al inicio cuando el usuario abre el enlace estando autenticado.
- Se introdujo utilidad compartida de deteccion de recovery en:
  - `web/src/utils/authRecovery.js`
- El ajuste se conecto en:
  - `web/src/router/index.js`
  - `web/src/composables/useAuth.js`
  - `web/src/views/Login.vue`
- Regla vigente:
  - si la navegacion llega con marcadores de recovery (`type=recovery`, `code`, `token_hash`, `access_token` o flag interno), `/login` debe permanecer en modo restablecer contraseña y no tratarse como login autenticado normal

## Actualizacion reciente (2026-04-15) — mobile suma gestion avanzada de lotes y onboarding operativo

- `mobile` cierra dos brechas importantes frente a `web` en `BatchManagement` y `Setup / onboarding`.
- `mobile/src/screens/BatchesScreen.js` deja de ser una lista simple y ahora incorpora:
  - tabs `Lotes`, `Alertas` y `Reportes`
  - filtros por sede, nivel de alerta y numero de lote
  - creacion y edicion de lotes desde modal
  - generacion de numero de lote
  - trazabilidad por lote
  - dashboard de vencimientos y top de productos en riesgo
- La nueva capa operativa de lotes mobile vive en:
  - `mobile/src/services/batches.service.js`
- `mobile/src/screens/SetupScreen.js` deja de ser solo un launcher y ahora muestra:
  - progreso real del tenant
  - siguiente accion recomendada
  - checklist por proceso operativo
  - lectura desde servidor o cache offline
- La logica de readiness y consolidacion del onboarding mobile ahora vive en:
  - `mobile/src/services/setupAssistant.service.js`
- `mobile/App.js` ahora inyecta `tenant` y `offlineMode` en `SetupScreen` para evaluar el estado real del tenant.
- Cobertura agregada para esta tanda:
  - `mobile/src/__tests__/batches.service.test.js`
  - `mobile/src/__tests__/setupAssistant.service.test.js`
- Estado de producto vigente tras esta tanda:
  - `lotes y vencimientos` ya no queda reducido a lectura basica en mobile
  - `setup` ya no es solo navegacion rapida; ahora funciona como onboarding operativo real
  - `contabilidad avanzada` sigue marcada como frente de paridad parcial y se comunica como `web-only` dentro del propio onboarding mobile

## Actualizacion reciente (2026-04-12) — paridad de inventario, compras y reportes entre web/mobile

- Se cerro una tanda grande de disparidades funcionales entre `web` y `mobile` en inventario, compras y reportes.
- `mobile/src/screens/ReportsScreen.js` ahora amplía `Reportes > Inventario` con:
  - `Stock Bajo`
  - `Por Sede`
  - `Sin Movimiento`
  - `Proximos a Vencer`
- La data nueva de reportes mobile vive en `mobile/src/services/reports.service.js` y ahora incluye:
  - `inventory.by_location`
  - `inventory.no_movement_items`
  - `inventory.expiring_items`
  - KPIs nuevos como `total_at_risk`, `expiring_soon` y `no_movement`
- `mobile/src/screens/PurchasesScreen.js` ya no deja el seguimiento avanzado solo en web; ahora suma:
  - `OC Pendientes` con recepcion directa
  - `CxP Proveedores` en bandeja compacta
  - `Sugerencias IA`
  - `Analisis IA`
- La capa de servicios mobile que soporta eso ahora queda en:
  - `mobile/src/services/purchases.service.js`
  - `mobile/src/services/ai-purchase-advisor.service.js`
- `mobile/src/screens/InventoryScreen.js` ahora incluye `Ingreso por Compra` dentro de `Operaciones`, alineado con web.
- El backend mobile para ese flujo vive en `mobile/src/services/inventoryOperations.service.js` con `createPurchaseIngress(...)`.
- `web/src/views/Purchases.vue` cierra la brecha inversa del OCR de compras:
  - los faltantes de catalogo detectados por factura ya se pueden crear y agregar desde el mismo flujo
  - soporte nuevo via `web/src/services/purchaseInvoiceAssistant.service.js`
  - `web/src/services/purchases.service.js` ahora expone `createCatalogVariantForPurchase(...)`
- Cobertura agregada para esta tanda:
  - `web/src/services/__tests__/purchaseInvoiceAssistant.service.test.js`
  - `mobile/src/__tests__/inventoryOperations.service.test.js`
  - `mobile/src/__tests__/purchases.service.test.js`
- Decision operativa vigente despues de esta tanda:
  - `tenant management` y `contabilidad avanzada` siguen `web-only`
  - `reportes de inventario`, `seguimiento de compras`, `OCR/IA operativa` e `ingreso por compra` quedan mejor alineados entre apps

## Actualizacion reciente (2026-04-12) — alineacion de navegacion, ayuda y semantica entre apps

- Se cerro una tanda de disparidades que ya no eran de modulo faltante sino de semantica de ruta y UX:
  - `mobile` ya no redirige `/settings` a `Setup`; ahora existe `mobile/src/screens/SettingsScreen.js`
  - `mobile` ya no redirige `/roles` a `RolesMenus`; ahora existe `mobile/src/screens/RolesScreen.js` como vista de consulta
  - `mobile` ya no hace caer `TenantManagement` en `TenantConfigScreen`; ahora existe `mobile/src/screens/TenantManagementScreen.js`
  - `mobile` ahora tiene `mobile/src/screens/HelpCenterScreen.js` como version compacta real del manual/FAQ
- `mobile/src/navigation/menuMapper.js` ahora clasifica rutas como:
  - `supported`
  - `web-only`
  - `unsupported`
- Rutas `accounting` y `superadmin billing` quedan marcadas explicitamente como `web-only` en mobile, en lugar de aparentar una paridad que no existe.
- `mobile/src/components/MenuDrawer.js` ahora muestra badge `WEB` para esos accesos.
- `mobile/App.js` ahora redirige la accion `openManual` al `HelpCenter` mobile, no a un mensaje de indisponibilidad.
- Cobertura agregada/ajustada:
  - `mobile/src/__tests__/menuMapper.test.js`
  - `mobile/src/__tests__/helpCenter.test.js`
  - `mobile/src/__tests__/setupGuideContent.test.js`
- Lectura de producto vigente:
  - la mayor brecha restante entre apps ya no es navegacion general
  - las diferencias deliberadas quedan concentradas en `contabilidad avanzada`, `superadmin billing` y capacidades offline/nativas de mobile

## Actualizacion reciente (2026-04-12) — fix de lotes proximos a vencer en reportes

- Se corrigio una regresion de esquema en reportes de inventario:
  - `mobile/src/services/reports.service.js` estaba consultando `inventory_batches.quantity_on_hand`
  - la columna real en este repo es `inventory_batches.on_hand`
- El fix ya aplica en mobile y tambien en el gemelo web:
  - `mobile/src/services/reports.service.js`
  - `web/src/services/reports.service.js`
- Se extrajo helper mobile `mapExpiringInventoryBatches(...)` y se agrego cobertura en:
  - `mobile/src/__tests__/reports.service.test.js`
- Resultado funcional:
  - `Reportes > Inventario > Proximos a Vencer` deja de fallar por columna inexistente
  - se mantiene la paridad del calculo de `quantity` y `at_risk_value` entre apps

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
| `shared/supabase/migrations/ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql` | Emite alerta `ONLINE_ORDER` al llegar un pedido online pendiente y la limpia al confirmar/rechazar; alimenta web y mobile via `system_alerts` | Pendiente ejecucion manual |
| `shared/supabase/migrations/ONLINE_ORDER_MOBILE_NOTIFICATIONS.sql` | Reemplaza `fn_upsert_online_order_alert` para que ademas emita a `notifications` (canal push/in-app mobile) con dedupe de 30 min. Ejecutar DESPUES de `ONLINE_STORE_ALERTS_AND_NOTIFICATIONS.sql` | Pendiente ejecucion manual |
| `shared/supabase/migrations/ADD_CENTRAL_EMAIL_NOTIFICATION_OUTBOX.sql` | Crea `notification_outbox`, helpers/triggers de email y deduplicacion fuerte por `channel + dedupe_key`; requiere desplegar `notification-dispatcher` | Pendiente ejecucion manual |

---

## Historial de cambios en este archivo

| Fecha      | Cambio |
|------------|--------|
| 2026-05-04 | Mercado Pago multi-tenant y sistema central de emails con Resend: `notification_outbox`, `notification-dispatcher`, dedupe por `channel + dedupe_key`, docs en `shared/supabase/EMAIL_NOTIFICATION_SYSTEM.md`. |
| 2026-04-16 | Backend Supabase compartido unificado: fuente canonica en `shared/supabase`, `145` migraciones compartidas sin divergencias, `create-tenant-user` y `chat-order-parser` canonizadas, rutas `web/` y `mobile/` mantenidas via symlinks, script `scripts/sync-shared-supabase.sh` con modos `link`, `check` y `sync`. |
| 2026-04-08 | Creacion del archivo. Incluye setup de testing (Vitest web + Jest mobile), `pricingRuleEngine.js` en shared, metro.config mobile, warmup de reglas de precio en POS, regla TDD obligatoria. |
| 2026-04-09 | Nuevos tests: `appErrors.test.js` (web, 39 tests) y `deterministicParser.test.js` (mobile, 49 tests). Total suite: 326 tests. |
| 2026-04-10 | Centralización en shared/: `stringUtils.js`, `cashSessionUtils.js`, `appErrors.js`, `formatters.js`, `constants/thirdParty.js`. Archivos origen reemplazados por re-exports. Sin cambios en importadores existentes. |
| 2026-04-10 | Manufactura mobile completa: ciclo de órdenes (crear/iniciar/completar/cancelar), detalle BOM con componentes y costos, verificación de stock. 26 tests nuevos. Mobile suite: 159 tests. |
| 2026-04-10 | UX mobile — fix de teclado y botones en formularios modales. Ver sección abajo. |
