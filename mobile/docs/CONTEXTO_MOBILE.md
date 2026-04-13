# CONTEXTO_MOBILE

Fecha: 2026-04-12
Proyecto: POSLite Mobile / OfirOne
Estado: Contexto operativo consolidado para trabajo diario

## Mantenimiento del archivo

Este archivo debe actualizarse en cada modificacion relevante del proyecto mobile.

Regla de trabajo:

- toda modificacion funcional, arquitectonica o tecnica que cambie el estado real de la app debe reflejarse aqui
- si se crea, migra, elimina o cambia el alcance de un modulo, este documento debe ajustarse
- si cambia el flujo de navegacion, offline, sincronizacion, IA, tema o integraciones, este documento debe ajustarse
- este archivo debe tratarse como fuente de contexto vivo para onboarding y desarrollo diario

## Actualizacion reciente (2026-04-12) — navegacion y semantica alineadas con web

### Nuevas pantallas mobile para cerrar paridad falsa

- `src/screens/TenantManagementScreen.js`
  - reemplaza la falsa paridad donde `TenantManagement` caia en `TenantConfigScreen`
  - ahora muestra un resumen real del tenant y de la suscripcion
  - deja explicito que tenant management avanzado y billing siguen `web-only`
- `src/screens/SettingsScreen.js`
  - `mobile` ya no traduce `/settings` a `Setup`
  - ahora `/settings` representa preferencias de usuario/app:
    - tema
    - vista del menu
    - resumen de contexto operativo
- `src/screens/RolesScreen.js`
  - `mobile` ya no traduce `/roles` a `RolesMenus`
  - ahora `/roles` es una vista de consulta de roles
  - la administracion avanzada sigue en `RolesMenus`
- `src/screens/HelpCenterScreen.js`
  - mobile ya no deja el manual solo como referencia a web
  - ahora existe un `Centro de Ayuda` compacto con:
    - busqueda
    - filtros por proceso
    - guias operativas
    - FAQs
    - pasos que abren modulos reales

### Navegacion actualizada

- `src/navigation/menuMapper.js` ahora alinea:
  - `/help` -> `HelpCenter`
  - `/settings` -> `Settings`
  - `/roles` -> `Roles`
- `src/navigation/menuMapper.js` ahora distingue disponibilidad mobile:
  - `supported`
  - `web-only`
  - `unsupported`
- Rutas como `/accounting*`, `/contabilidad*` y `/superadmin/billing` quedan marcadas como `web-only`.

### Drawer y comunicacion de paridad

- `src/components/MenuDrawer.js` ahora muestra badge `WEB` para modulos `web-only`.
- Ya no se presenta `accounting` o `billing` como si fueran permisos bloqueados o modulos equivalentes en mobile.
- `App.js` ahora dirige `openManual` al `HelpCenter` real en mobile.

### Cobertura agregada en esta tanda

- nuevo test: `src/__tests__/menuMapper.test.js`
- nuevo test: `src/__tests__/helpCenter.test.js`
- ajuste de cobertura existente: `src/__tests__/setupGuideContent.test.js`

### Estado de paridad vigente despues de esta tanda

- diferencias cerradas:
  - semantica de `/settings`
  - semantica de `/roles`
  - ayuda/manual en mobile
  - falsa paridad de `TenantManagement`
- diferencias intencionales mantenidas:
  - contabilidad avanzada `web-only`
  - superadmin billing `web-only`
  - modo offline solo mobile

## Actualizacion reciente (2026-04-12) — fix de reportes de inventario por columna legacy en lotes

- Se corrigio un bug real en `src/services/reports.service.js`:
  - el snapshot de reportes estaba consultando `inventory_batches.quantity_on_hand`
  - la columna real del proyecto es `inventory_batches.on_hand`
- Impacto del bug:
  - la subvista `Proximos a Vencer` dentro de `Reportes > Inventario` podia fallar con error SQL/REST de columna inexistente
- Ajuste aplicado:
  - el query ahora usa `on_hand`
  - el filtro `gt(...)` ahora usa `on_hand`
  - el mapeo de lotes expuestos en reportes ya calcula `quantity` y `at_risk_value` desde `on_hand`
  - se extrajo helper `mapExpiringInventoryBatches(...)` para evitar que el nombre de columna quede hardcodeado en varios puntos
- Cobertura agregada:
  - nuevo test: `src/__tests__/reports.service.test.js`
- Compatibilidad:
  - el helper mantiene fallback a `quantity_on_hand` si algun origen legacy entrega ese shape en memoria

## Actualizacion reciente (2026-04-12) — cierre de disparidades con web en inventario, compras y reportes

### Reportes de inventario

- `src/screens/ReportsScreen.js` ahora amplía la pestaña `Inventario` con subtabs reales:
  - `Stock Bajo`
  - `Por Sede`
  - `Sin Movimiento`
  - `Proximos a Vencer`
- `src/services/reports.service.js` ahora entrega:
  - `inventory.by_location`
  - `inventory.no_movement_items`
  - `inventory.expiring_items`
  - KPIs nuevos como `total_at_risk`, `expiring_soon` y `no_movement`
- Con esto mobile deja de depender solo de KPIs basicos y alertas de stock.

### Compras

- `src/screens/PurchasesScreen.js` ahora suma una capa compacta de seguimiento operativo:
  - `OC Pendientes`
  - `CxP Proveedores`
  - `Sugerencias IA`
  - `Analisis IA`
- `src/services/purchases.service.js` ahora soporta:
  - `getOpenPurchaseOrders(...)`
  - `receivePurchaseOrder(...)`
  - `receivePurchaseOrderPartial(...)`
  - `getSupplierPayablesDashboard(...)`
  - `getPurchaseSuggestions(...)`
  - `getInventoryRotationAnalysis(...)`
  - `getAIPurchaseAnalysis(...)`
  - `isAIAvailable()`
- Nuevo servicio:
  - `src/services/ai-purchase-advisor.service.js`
- Estado funcional vigente:
  - mobile ya no deja la recepcion de OC y el seguimiento base de CxP exclusivamente en web
  - IA operativa de compras ya tiene una version compacta en mobile

### Inventario

- `src/screens/InventoryScreen.js` ahora incluye `Ingreso por Compra` dentro de `Operaciones`.
- La capa de servicio nueva vive en `src/services/inventoryOperations.service.js` con:
  - `createPurchaseIngress(...)`
- Esto alinea mobile con el modulo de operaciones de inventario que ya existia en web.

### Cobertura agregada en esta tanda

- nuevo test: `src/__tests__/inventoryOperations.service.test.js`
- nuevo test: `src/__tests__/purchases.service.test.js`

### Estado de paridad vigente

- Se reducen de forma importante las brechas entre mobile y web en:
  - inventario
  - compras
  - reportes
- Siguen siendo diferencias intencionales:
  - modo offline mobile
  - tenant management `web-only`
  - contabilidad avanzada `web-only`

## Actualizacion reciente (2026-04-10) — validacion de caja vencida centralizada con web

- La regla de vencimiento de sesiones de caja ahora queda consolidada en `shared/utils/cashSessionUtils.js`.
- Nuevas utilidades compartidas activas:
  - `getCashSessionState(session, maxHours)`
  - `buildCashSessionExpiredMessage(state)`
  - `validateCashSessionForOperation(session, maxHours, options)`
- `src/lib/cashSession.js` sigue existiendo como capa de compatibilidad, pero ahora reexporta tambien esas funciones nuevas.
- Mobile ya consume esta validacion compartida en:
  - `src/screens/PointOfSaleScreen.js`
  - `src/screens/LayawayScreen.js`
- Regla vigente:
  - si la operacion requiere caja y no existe sesion, la validacion devuelve `NO_OPEN_SESSION`
  - si la sesion supero `cash_session_max_hours`, devuelve `EXPIRED_SESSION`
- el mensaje de sesion vencida queda alineado con web para no divergir entre apps

## Actualizacion reciente (2026-04-10) — perfil explicito para APK release en EAS

- `eas.json` ahora incluye un perfil `production-apk`.
- Objetivo:
  - no depender del perfil `preview` para generar APK instalable
  - mantener `production` para el flujo normal de release Android (`aab`)
  - permitir pedir un APK firmado de release con un comando explicito
- Comando operativo esperado:
  - `eas build -p android --profile production-apk`

### Ajuste posterior (2026-04-11) — hardening del postinstall para EAS

- `scripts/postinstall/patch-llama-rn.sh` se hizo mas portable para reducir fallos opacos en la fase `Install dependencies` de EAS.
- Cambio aplicado:
  - ya no depende de `sed -i`
  - ahora transforma el archivo en staging temporal y luego reemplaza el destino
- Motivo:
  - el build de Android estaba fallando en EAS con error generico en `Install dependencies`
  - el punto mas sospechoso del repo en esa fase era el `postinstall` que parchea `llama.rn`

### Ajuste posterior (2026-04-11) — Node fijado en EAS por requerimientos de RN 0.81

- `eas.json` ahora fija `node: 20.19.4` en los perfiles `development`, `preview` y `production`.
- Motivo:
  - el `package-lock.json` ya contiene varias dependencias de `react-native@0.81.5` y `metro` con `engines.node >= 20.19.4`
  - si EAS usa una version menor por defecto, la fase `Install dependencies` puede fallar de forma generica antes de compilar

## Actualizacion reciente (2026-04-10) — venta guiada alternativa en POS mobile

- `src/screens/PointOfSaleScreen.js` ahora incluye una entrada `Venta guiada` como flujo alternativo, sin reemplazar el POS rapido.
- El wizard vive en un `BottomSheetModal` y reutiliza el mismo motor de:
  - carrito
  - pagos
  - ventas en espera
  - nota y fecha manual
  - cobro final
- La logica minima de pasos y bloqueos viene de `shared/utils/saleWizard.js`.
- Pasos vigentes:
  - cliente y contexto
  - productos
  - pago
  - confirmar
- Reglas vigentes:
  - si ya existe carrito, abre en `Productos`
  - no deja avanzar a pago sin items
  - no deja confirmar si la caja no existe o esta vencida
  - no deja confirmar si falta dinero o si la fecha manual es invalida
- Al retomar una venta en espera, mobile puede abrir directamente el wizard en el paso de productos.
- `Ventas en espera` ya no se muestra en la mitad del POS rapido:
  - ahora se accede desde una fila superior de accesos rapidos, en horizontal, para no saturar el header del POS
  - el acceso `Ventas en espera` ahora muestra un indicador numerico con la cantidad de borradores guardados
  - la accion de guardar el ticket actual ya no queda ambigua como `Guardar`; se expone como `Guardar en espera`
  - `Guardar en espera` y `Limpiar` quedan agrupados cerca de `Cobrar` dentro del bloque operativo final del POS rapido
  - dentro del wizard aparece en el paso inicial, que es donde mejor encaja retomar una venta
- Cobertura agregada:
  - `src/__tests__/saleWizard.test.js`

## Actualizacion reciente (2026-04-10) — wizard guiado de creacion de productos

### Alcance

Se simplifico el alta de productos en mobile y se alineo con la logica guiada de web:
- nuevo componente `src/components/ProductCreationWizardSheet.js`
- `src/screens/ProductsScreen.js` usa el wizard para crear productos nuevos
- el bottom sheet legacy queda enfocado en edicion y fotos del producto

### Diseno aplicado

- el wizard trabaja con 3 pasos:
  - datos basicos
  - perfil del producto
  - configuracion minima
- los perfiles y reglas no viven hardcodeados solo en mobile; ahora vienen de `shared/utils/productCreationWizard.js`
- perfiles activos:
  - producto simple
  - producto con variantes
  - insumo/componente
  - producto fabricado
  - combo/bundle
  - servicio
- regla UX vigente:
  - el wizard muestra por defecto solo lo esencial segun el perfil elegido
  - las combinaciones completas viven bajo `Opciones avanzadas`
  - asi se mantiene la funcionalidad sin recargar la pantalla principal
  - el wizard comunica explicitamente que `producto simple` = una sola variante y `componente` = insumo para otros productos
  - el campo de stock mostrado en la configuracion minima ahora se presenta como `alerta minima de stock`
  - `0` en ese campo significa `sin alerta minima`, no `sin control de inventario`
  - `track_inventory` ya no queda encendido por defecto para los perfiles fisicos del wizard

### Correccion importante de paridad

- se corrigio el bug donde `Componente` podia terminar con `inventory_behavior='MANUFACTURED'`
- la regla vigente queda alineada con web:
  - componente = `RESELL + is_component=true`
  - manufacturado = producto final fabricado, no insumo

### Variantes en wizard

- como la BD auto-crea una variante `Predeterminado` al insertar un producto, el wizard reutiliza esa variante cuando el perfil es `producto con variantes`
- para soportarlo se agrego en `src/services/productsCatalog.service.js`:
  - `createVariant(payload)`
  - `updateVariant(variantId, tenantId, updates)`
  - `getProductById(productId, tenantId)`
  - `removeVariant(variantId, tenantId)`
- nuevo componente `src/components/ProductVariantWizardSheet.js` para crear y editar variantes con el mismo patron guiado
- `src/components/ProductCreationWizardSheet.js` ahora tambien soporta edicion (`mode="edit"`)
- `src/screens/ProductsScreen.js` abre el wizard para editar productos y deja el bottom sheet anterior como complemento de fotos/IA

### Cobertura

- nuevo test: `src/__tests__/productCreationWizard.test.js`
- nuevo test: `src/__tests__/productVariantWizard.test.js`

## Actualizacion reciente (2026-04-10) — wizard guiado de terceros

### Alcance

Se llevo el mismo patron guiado al modulo de terceros:
- por defecto el wizard inicia en tipo `cliente`; `proveedor` y `ambos` quedan como seleccion explicita
- nuevo componente `src/components/ThirdPartyWizardSheet.js`
- `src/screens/ThirdPartiesScreen.js` ahora usa el wizard para crear y editar terceros

### Diseno aplicado

- el wizard trabaja en 3 pasos:
  - rol e identidad
  - contacto y ubicacion
  - resumen y ajustes fiscales/comerciales
- la logica comun vive en `shared/utils/thirdPartyWizard.js`
- regla UX vigente:
  - primero se captura el rol (`cliente`, `proveedor` o `ambos`) y la identificacion
  - lo fiscal y comercial queda en una seccion avanzada, no en la pantalla principal

### Cobertura

- nuevo test: `src/__tests__/thirdPartyWizard.test.js`

## Actualizacion reciente (2026-04-10) — paridad de fotos de producto con web

- El flujo de fotos/portada/IA de productos ya no es exclusivo de mobile; web ahora consume la misma base `product_media` y la misma edge function `product-photo-analyzer`.
- Esto reduce la brecha entre apps:
  - mobile sigue usando `src/screens/ProductsScreen.js`
  - web ahora lo replica con `web/src/components/ProductMediaManager.vue`
- La referencia operativa de storage/RLS/edge function sigue siendo la misma documentada en `docs/PRODUCT_PHOTOS_AI_SETUP.md`.

## Actualizacion reciente (2026-04-04) — Base de agente RAG operativo reusable para mobile/web

### Ajuste posterior (2026-04-05) — notificaciones con copy mas claro y priorizado en espanol

Se mejoro la claridad del inbox y del push remoto para evitar textos tecnicos poco utiles como `RECEIVABLE`, `EXPIRATION` o mensajes genericos tipo `Se detecto una alerta del sistema`:
- `NotificationsModal` ahora humaniza severidad (`Informativa`, `Atencion`, `Critica`, `Completada`) y traduce eventos tecnicos a lenguaje de negocio
- se agrego una capa de copy que infiere dominio de la alerta (`cartera`, `vencimientos`, `stock`, `compras`, `caja`, `ventas`) usando `title`, `message`, `event_type` y `payload`
- si el backend solo trae un nombre corto como `Bolsos Almirante`, la UI construye una frase completa y accionable en espanol
- `push-dispatcher` aplica la misma logica antes de enviar por Expo o FCM, para que la barra del sistema y la campanita interna queden alineadas
- el objetivo es que el usuario entienda `que paso` y `que revisar` sin conocer codigos internos del sistema

Archivos tocados en este ajuste:
- `src/components/NotificationsModal.js` — formateo legible del inbox mobile
- `supabase/functions/push-dispatcher/index.ts` — copy normalizado para push Android/iOS/fallback

Nota operativa:
- para que el nuevo copy salga en la barra del sistema, hay que volver a desplegar `push-dispatcher`
- la mejora del inbox in-app se refleja al recargar la app

### Ajuste posterior (2026-04-04) — mejor cobertura para consultas de vencimientos

Se endurecio la primera version del agente RAG para consultas de expiracion/lotes:
- el routing del dominio `inventory` ahora reconoce mejor vocabulario real de usuario como `vencido`, `vencidos`, `vence`, `por vencer`, `caduca`, `expira` y `fefo`
- el retrieval de inventario ya no depende solo del bloque `<= 30 dias`; ahora expone resumen de vencimientos, proximos lotes a vencer y lotes ya vencidos
- se subio `CACHE_VERSION` del agente para evitar que respuestas viejas cacheadas sigan devolviendo falta de contexto en preguntas de vencimientos

### Ajuste posterior (2026-04-04) — soporte explicito para productos menos vendidos

Se ajusto el dominio `sales` del agente RAG para consultas de baja rotacion:
- el routing ahora reconoce frases como `menos vendidos`, `baja rotacion`, `menor rotacion` y `poca rotacion`
- el retrieval ya no expone solo `sales_top_products`; ahora agrega `sales_low_rotation_summary` y `sales_low_rotation_products`
- cuando el catalogo activo esta disponible, el agente puede incluir variantes con `0 ventas` en el rango para responder mejor preguntas de `menos vendidos`
- se actualizo nuevamente `CACHE_VERSION` para invalidar respuestas cacheadas previas que no tenian estos bloques

### Ajuste posterior (2026-04-04) — consultas de que comprar / reabastecimiento

Se corrigio el routing de consultas de compra sugerida:
- preguntas como `que debo comprar`, `que debo pedir`, `reponer`, `reabastecer` o `comprar para la proxima semana` ya no quedan sesgadas solo al dominio `purchases`
- el agente ahora fuerza combinacion de `inventory + sales + purchases` para esa intencion
- el prompt grounded tambien se ajusto para priorizar stock/riesgo + top ventas + compras recientes antes de recomendar productos concretos

### Alcance nuevo

Se agrego la primera base de un agente operativo con retrieval orientado a datos reales del tenant:
- nueva Edge Function `ops-rag-agent`
- retrieval SQL multi-dominio sobre `sales`, `inventory`, `purchases`, `cash`, `portfolio` y `production`
- respuesta grounded con `citations` a bloques recuperados
- cache compartida en BD para reuso entre clientes mobile y web

### Diseno aplicado

- el agente no ejecuta acciones transaccionales; responde sobre contexto recuperado
- el routing de dominios es deterministico, con soporte para hints explicitos enviados por el cliente
- el retrieval usa las tablas operativas reales y respeta el usuario autenticado via JWT
- se creo `src/services/opsRagAgent.service.js` como cliente mobile del contrato comun
- se documento el contrato y despliegue en `docs/OPS_RAG_AGENT.md`

### Archivos modificados en esta sesion

- `supabase/functions/ops-rag-agent/index.ts` — Edge Function RAG multi-dominio
- `migrations/ADD_OPS_RAG_AGENT_CACHE.sql` — cache compartida del agente
- `src/services/opsRagAgent.service.js` — wrapper cliente mobile
- `docs/OPS_RAG_AGENT.md` — contrato, deploy y uso

## Actualizacion reciente (2026-04-04) — POS con lenguaje natural mas operativo en caja

### Ajuste posterior (2026-04-05) — Compras con carga de factura por IA y creacion asistida de articulos

Se extendio a `PurchasesScreen` un flujo inspirado en el escaneo de factura del POS:
- el modal `Nueva Compra` ahora incluye un bloque `Factura con IA` con 3 entradas: `Foto`, `Galeria` y `Archivo`
- la lectura prioriza OCR cloud + estructura de factura con `DeepSeek` via `invoiceAgent.service`; si eso falla y hay OCR nativo disponible, intenta `OCR nativo -> parseo textual`
- las lineas detectadas se cruzan contra catalogo activo usando `listCatalogCandidatesForMatching` + `matchInvoiceLinesToCatalog`, reutilizando el patron de matching del modulo de ventas
- los items con match se agregan automaticamente como lineas de compra con cantidad/costo inferidos desde la factura
- los items sin match quedan listados como `Articulos sin catalogo` y se pregunta al usuario si quiere crearlos
- para faltantes se agrego `purchaseInvoiceAssistant.service`, que normaliza el articulo con un proveedor cloud configurable (`DeepSeek` por defecto y fallback configurable para `OpenAI` si el tenant lo cablea)
- al confirmar, se crean `product + variant` minimos desde mobile via `createCatalogVariantForPurchase` y se agregan inmediatamente a la compra

Notas de integracion:
- la opcion `Archivo` usa `expo-document-picker` si esta disponible en el build; si no, la UI informa que falta esa dependencia
- el resumen de la factura muestra proveedor detectado, numero/fecha, total, conteo de matches/faltantes, motor OCR y preview del texto recuperado

### Ajuste posterior (2026-04-04) — consulta rapida contextual desde POS

Se llevo parte del valor del agente operativo directamente al flujo de caja:
- `PointOfSaleScreen` ahora expone una `Consulta rapida` dentro del bloque IA del POS
- la consulta usa el contexto de caja actual para lanzar preguntas operativas sin salir del flujo de venta
- se agregaron 4 accesos directos orientados a caja: `Mas vendidos hoy`, `Menos vendidos hoy`, `Stock critico` y `Resumen turno`
- las respuestas muestran resumen grounded, acciones sugeridas, citas y metadata basica de confianza/cache dentro de un bottom sheet
- en `offlineMode` la UI deja visible la funcionalidad, pero explica que necesita conectividad para responder

### Problemas corregidos

El flujo de carga por texto natural en POS ya existia, pero seguia teniendo fricciones de uso real:
- el modo de texto seguia rotulado como `Chat`, lo que ocultaba que acepta lenguaje natural libre
- el input se limpiaba incluso cuando el comando fallaba o quedaba con `sin match`, obligando al cajero a reescribir
- texto y voz quedaban bloqueados esperando el modelo embebido, aunque el parser deterministico o el fallback cloud podian resolver

### Solucion aplicada

- el acceso de texto IA en POS ahora se presenta como `Natural`, mas alineado al uso real en operacion
- el composer muestra un ejemplo explicito de lenguaje natural para guiar al cajero
- `parseChatOrderWithAgent()` ya no bloquea por preparacion del modelo embebido y solo limpia el texto cuando la conversion al carrito fue exitosa
- `parseVoiceOrderWithVosk()` tambien deja de depender del modelo embebido para poder intentar resolver por parser/cache/cloud

### Archivos modificados en esta sesion

- `src/screens/PointOfSaleScreen.js` — UX mas clara para lenguaje natural y menor friccion operativa

## Actualizacion reciente (2026-04-03) — Hardening transversal de offline, sync y compras

### Problemas corregidos

Se cerro una pasada transversal sobre fallas silenciosas que estaban afectando coherencia de datos y experiencia diaria:
- logout con cache local permitia una reentrada offline no deseada
- bootstrap desde cache podia dejar perfil, menu y settings viejos si la sesion se confirmaba despues
- la cola offline podia quedar mezclada entre usuarios o en un estado dificil de reintentar
- listas y buscadores remotos podian aplicar respuestas viejas sobre filtros o queries nuevos
- proveedores visibles por `trade_name` no siempre aparecian en la busqueda
- compras se seguia listando por linea de movimiento en lugar de cabecera de documento
- una venta encolada offline no impactaba el dashboard `Home` hasta sincronizar

### Solucion aplicada

- `handleLogout` ahora limpia `auth_cache` y `menu_cache` tanto online como offline, baja `offlineAvailable` y reinicia el contexto de tenant/menu/dashboard.
- el bootstrap desde cache ya no se queda solo con `setSession()`: si la sesion reaparece, rehidrata perfil en background sin tumbar la UI.
- `useSync` ahora usa el adaptador multiplataforma `database` y solo dispara `onNetworkRecovery` al pasar de offline real a online real.
- `syncPendingOperations()` quedo serializado en memoria para evitar carreras entre auto-sync, modal de cola y reintentos manuales.
- la cola pendiente y el conteo se filtran por `tenantId + userId` en SQLite nativo y web.
- `retryPendingOp()` reinicia `retry_count`, para que un reintento manual vuelva a procesar de verdad una op bloqueada o agotada.
- `usePaginatedList`, `PurchasesScreen` e `InventoryScreen` ahora ignoran respuestas stale mediante request ids y guards de montaje.
- la busqueda de terceros ahora incluye `trade_name`, `phone` y `email`.
- `listPurchases()` paso a agrupar por cabecera de `purchases`, y `PurchasesScreen` usa un namespace de cache nuevo para no mezclar shapes viejos.
- `useDashboard` ahora puede fusionar localmente una venta encolada al snapshot actual, de modo que `Home` refleje ventas offline antes del sync.

### Archivos modificados en esta sesion

- `App.js` — logout/cache hardening, rehidratacion en background y dashboard optimista para POS offline
- `src/hooks/useSync.js` — recovery real y uso del adaptador multiplataforma
- `src/hooks/usePaginatedList.js` — proteccion contra respuestas stale
- `src/hooks/useDashboard.js` — merge optimista de ventas offline al dashboard
- `src/screens/PointOfSaleScreen.js` — notifica ventas encoladas al dashboard
- `src/screens/PurchasesScreen.js` — guards async y listado coherente por compra
- `src/screens/InventoryScreen.js` — guards async en operaciones/busquedas
- `src/services/sync.service.js` — serializacion del proceso de sync
- `src/services/sales.service.js` — operaciones pendientes acotadas al usuario actual
- `src/services/thirdParties.service.js` — busqueda de proveedores mas alineada con la UI
- `src/services/inventoryCatalog.service.js` — listado de compras por cabecera
- `src/storage/sqlite/database.native.js` — cola pendiente por usuario + retry real
- `src/storage/sqlite/database.web.js` — paridad web del manejo de cola pendiente

## Actualizacion reciente (2026-04-03) — Billing visible en mobile y correcciones base

### Problemas corregidos

El dominio de billing seguia en estado casi invisible para el usuario mobile:
- existia `tenant_billing_summary`, pero mobile no lo consumia en ninguna pantalla
- el tenant no podia ver facil su plan actual ni la fecha de vencimiento
- la migracion base tenia un bug de idempotencia en una policy de `tenant_subscriptions`
- `days_to_expiry` dependia solo de `current_period_end`, dejando mal casos de trial o gracia sin ese campo

### Solucion aplicada

- se creo `src/services/tenantBilling.service.js` para consumir `fn_get_my_tenant_billing_summary()` con fallback a cache local.
- `TenantConfigScreen` ahora muestra un bloque de `Suscripcion` con plan, estado, vencimiento y mensaje operativo del tenant.
- `AboutScreen` ahora tambien expone el plan actual y el vencimiento como resumen rapido.
- la migracion `ADD_TENANT_BILLING_MONETIZATION.sql` corrige el guard roto de `tenant_subscriptions_update_policy` y calcula `days_to_expiry` usando `current_period_end`, `trial_end_at` o `grace_end_at`.
- la misma migracion ahora detecta esquemas con `tenants.tenant_id` o `tenants.id`, y tambien puede resolver actor/tenant desde `users` o `profiles` para no romper instalaciones antiguas o variantes de esquema.

### Archivos modificados en esta sesion

- `src/services/tenantBilling.service.js` — lectura segura del resumen comercial + cache offline
- `src/screens/TenantConfigScreen.js` — visibilidad del plan/vencimiento en Empresa
- `src/screens/AboutScreen.js` — visibilidad rapida del plan/vencimiento
- `migrations/ADD_TENANT_BILLING_MONETIZATION.sql` — fix de idempotencia y vencimiento

## Actualizacion reciente (2026-04-03) — Plan freemium y backfill seguro de suscripciones

### Alcance nuevo

Se agrego una migracion operativa para poblar billing en tenants rezagados sin tocar planes activos existentes:
- se crea/actualiza el plan `freemium`
- se crea precio `semiannual` en COP con valor `0`
- se definen features base similares a un plan operativo basico
- se asigna una suscripcion `active` de 6 meses solo a tenants sin suscripcion abierta
- tambien se crean el primer `tenant_subscription_period` y un evento `subscription_created`

### Notas operativas

- la migracion no reemplaza planes abiertos existentes; solo hace backfill en tenants sin `trialing`, `active`, `pending_activation`, `past_due` o `grace_period`
- para compatibilidad, detecta `tenants.tenant_id` o `tenants.id`
- el plan `freemium` quedo como no publico (`is_public = false`) para no ofrecerlo accidentalmente en catalogos futuros

### Archivos modificados en esta sesion

- `migrations/ADD_FREEMIUM_6M_TENANT_SUBSCRIPTIONS.sql` — seed comercial + asignacion segura de freemium 6 meses

## Actualizacion reciente (2026-04-03) — Reportes de Ventas y Cajas acercados a paridad web

### Problemas corregidos

El modulo `Reports` en mobile estaba entregando un snapshot demasiado resumido frente a la web:
- `PARTIAL_RETURN` se estaba sumando al bruto en lugar de devoluciones
- faltaban KPI de descuentos e impuestos en ventas
- `Ventas` no tenia `Top Productos`, `Por Categoria`, `Movimientos de Caja`, `Plan Separe` ni `Alertas de Stock`
- `Cajas` no exponia `Ventas por Caja` ni `Ventas por Cajero/Sesion`
- el selector de sedes en reportes no tenia fallback local

### Solucion aplicada

- `getReportsSnapshot()` ahora calcula `gross_discount`, `gross_tax`, `top_products`, `by_category`, conteos por metodo de pago, movimientos de caja detallados, contratos de plan separe, alertas de stock, ventas por caja y sesiones enriquecidas.
- el calculo de devoluciones trata `PARTIAL_RETURN` igual que `RETURNED` para resumen y agregado diario.
- `ReportsScreen` ahora muestra subtabs dentro de `Ventas` y `Cajas`, acercando la navegacion a la web sin romper el enfoque mobile-first.
- `listReportLocations()` guarda cache local y puede servirlo como fallback offline.

### Archivos modificados en esta sesion

- `src/services/reports.service.js` — snapshot ampliado, calculos corregidos y fallback de sedes
- `src/screens/ReportsScreen.js` — subtabs de ventas/cajas, KPI ampliados y nuevas vistas mobile

## Actualizacion reciente (2026-04-03) — Compras detalle/CxP y Operaciones de Inventario en mobile

### Alcance nuevo

La segunda tanda de paridad mobile con web dejo operativos estos bloques:
- detalle de compra con cabecera, proveedor, usuario, total y lineas compradas
- bloque de cuenta por pagar por compra, con creacion de CxP y registro de abonos
- visualizacion de devoluciones acumuladas por linea (`Dev`)
- tab `Operaciones` dentro de `Inventory` con ajuste manual y traslado entre sedes
- modal para recibir traslados en transito desde la sede destino

### Notas operativas

- el detalle de compra y la CxP siguen requiriendo conexion; en offline compras conserva consulta cacheada de la lista
- los ajustes y traslados de inventario usan RPCs online (`sp_create_transfer_request`, `sp_receive_transfer_request`) y no se encolan offline
- la busqueda remota de variantes reutiliza el servicio de compras para no duplicar catalogos

### Archivos modificados en esta sesion

- `App.js` — `InventoryScreen` tambien recibe `userProfile`
- `src/screens/PurchasesScreen.js` — detalle de compra, CxP, abonos y estado offline coherente
- `src/screens/InventoryScreen.js` — tab `Operaciones`, ajustes, traslados y recepcion en transito
- `src/services/purchases.service.js` — detalle de compra + CxP + abonos + devoluciones por linea
- `src/services/inventoryOperations.service.js` — operaciones de inventario via RPC
- `src/services/inventoryCatalog.service.js` — exposicion de `source_id` para enlazar detalle real de compra

## Actualizacion reciente (2026-04-03) — Compras mobile habilitado para registro y ordenes de compra

### Alcance nuevo

El modulo `Purchases` en mobile dejo de ser solo consulta. Ahora permite:
- registrar compras contra `sp_create_purchase`
- guardar ordenes de compra borrador contra `sp_create_purchase_order`
- buscar proveedores y variantes desde la app
- capturar lotes, vencimiento y ubicacion fisica cuando la variante lo requiere

### Notas operativas

- en `offlineMode` compras sigue siendo solo lectura; la creacion requiere conexion
- la recepcion avanzada de OC y el seguimiento detallado siguen en web
- el selector buscable mobile ahora soporta busqueda remota opcional para catalogos grandes

### Archivos modificados en esta sesion

- `App.js` — `PurchasesScreen` recibe `userProfile` para registrar `created_by`
- `src/components/SearchableSelectField.js` — soporte para busqueda remota opcional y estado `Buscando...`
- `src/screens/PurchasesScreen.js` — formulario mobile de compra/OC, lineas dinamicas, lote/vencimiento
- `src/services/purchases.service.js` — RPCs y busquedas de proveedores/variantes para compras

## Actualizacion reciente (2026-04-03) — Dashboard Home robusto en offline, foreground y reconexion

### Problema detectado

Despues del rediseño offline-first, `Home` podia quedarse con KPIs vacios o desactualizados en escenarios reales:
- arranque desde cache con sesion validada en background, pero sin refrescar dashboard online
- recuperacion de red sin ops pendientes, por lo que no corria `loadDashboard()`
- retorno desde background sin recheck inmediato de conectividad
- fallo parcial en queries opcionales (`topProducts` o `sale_payments`) que tumbaba todo el resumen del dashboard
- UI del Home mostrando `0` cuando en realidad no habia snapshot valido

### Solucion aplicada

- `useDashboard` ahora guarda el ultimo snapshot exitoso por tenant en `SimpleCache` (`sync_state` SQLite).
- Si `Home` entra en offline, el hook sirve el snapshot cacheado del dashboard en vez de quedar vacio.
- Si una carga online falla, el hook intenta fallback a cache y, si ya habia un snapshot valido en memoria para ese tenant, lo conserva.
- `getDashboardSummary()` ya no considera criticos los bloques de `topProducts` y `paymentMethods`; si fallan, los KPIs principales (`today`, `month`, `year`, serie diaria`) siguen saliendo.
- `Home` refresca dashboard al entrar a la pantalla, al volver del background y con pull-to-refresh manual.
- La recuperacion de red ahora refresca dashboard aunque no existan operaciones pendientes para sincronizar.
- El refresco periodico online de 5 minutos ahora tambien vuelve a pedir dashboard si la pantalla visible es `Home`.
- `useConnectivity` recupero el recheck inmediato al volver a `active`.
- `HomeScreen` ya no pinta `0` silencioso cuando falta snapshot; muestra `Sin datos`.

### Archivos modificados en esta sesion

- `App.js` — refresh de dashboard en Home, foreground, reconexion y cache offline
- `src/hooks/useDashboard.js` — cache/fallback por tenant para resumen dashboard
- `src/hooks/useConnectivity.js` — recheck en `AppState=active`
- `src/services/reports.service.js` — queries opcionales ya no tumban KPIs
- `src/screens/HomeScreen.js` — pull-to-refresh y estado visual `Sin datos`

## Actualizacion reciente (2026-03-27) — Rediseno arquitectura offline, bootstrap y estabilidad de render

### Problema raiz resuelto: `offlineMode` como estado manual

`offlineMode` era un `useState` manejado manualmente desde mas de 10 sitios en `App.js`. Esto causaba:
- parpadeo de pantalla al cambiar entre online/offline
- loops infinitos de render cuando `forceSessionToLogin` (que depende de `resetDashboard` y `resetNotifications`) era inestable
- la pantalla de POS entraba en modo offline inesperadamente al arrancar

Solucion definitiva aplicada:

```js
// Antes: const [offlineMode, setOfflineMode] = useState(false); + 10+ setOfflineMode(...)
// Ahora:
const offlineMode = useMemo(() => !session || !networkReachable, [session, networkReachable]);
```

`offlineMode` ahora es un valor derivado. Solo cambia cuando `session` o `networkReachable` cambian de verdad. Ningun setter manual. Ningun parpadeo.

### `userExplicitlyLoggedOut` — nuevo flag de sesion

Se agrego el estado `userExplicitlyLoggedOut` para distinguir dos situaciones con `session=null`:
- el usuario cerro sesion intencionalmente → debe ver Login
- la app arranyo sin sesion validada pero tiene cache → debe ver la app en modo offline

Flujo:
- `forceSessionToLogin` y `handleLogout` lo ponen en `true`
- `hydrateProfile` exitoso y `handleUseOfflineMode` lo ponen en `false`

Condicion de render actualizada:
```js
// Muestra Login si: no hay sesion Y (no hay cache O cerro sesion) Y no esta cargando desde cache
if (!session && (!offlineAvailable || userExplicitlyLoggedOut) && !bootingFromCache) → Login
```

Esto permite que un usuario con cache offline entre directamente a la app sin internet en la proxima apertura, sin ver la pantalla de Login.

### Bootstrap offline-first con `bootingFromCache`

El bootstrap ahora tiene dos caminos:

**Con cache previo (segunda apertura en adelante):**
1. Lee `auth_cache` de SQLite (instantaneo, sin red)
2. Establece `userProfile` y `tenant` desde cache
3. Llama `setBootingFromCache(true)` + `setLoadingBoot(false)` — app visible inmediatamente
4. En background con timeout de 6s: valida sesion con Supabase
5. Si hay sesion → `setSession()` + `setBootingFromCache(false)` + `warmCriticalOfflineCaches`
6. Si no hay red → `setBootingFromCache(false)` — app sigue mostrando datos de cache
7. `hydrateProfile()` NUNCA se llama en este path (evita `loadingProfile=true` que rebloquea la pantalla)

**Sin cache (primer login):**
1. `supabase.auth.getSession()` con `Promise.race` + timeout de 6 segundos
2. Si resuelve: flujo normal
3. Si cuelga: despues de 6s muestra Login

### Fix: loop infinito `Maximum update depth exceeded`

Causa: `resetDashboard` (en `useDashboard.js`) y `reset` (en `useNotifications.js`) eran funciones anonimas recreadas en cada render. Esto hacia que `forceSessionToLogin` (que depende de ambas en su `useCallback`) fuera inestable, lo que re-ejecutaba el effect `[forceSessionToLogin]` en cada render. Ese effect suscribe `onAuthStateChange`, Supabase dispara `INITIAL_SESSION` → `setSession(newRef)` → re-render → ciclo infinito.

Solucion: envolver ambas funciones en `useCallback([], [])`.

### Fix: APK release — crash `ReferenceError: Property 'AppState' doesn't exist`

`AppState` era usado en `App.js` pero no estaba importado en el bloque `import { ... } from 'react-native'`. El motor Hermes en release APK es estricto con variables no declaradas (a diferencia del bundler Metro en dev). Se agrego `AppState` al import.

### Fix: `safeStep` — diagnostico de bootstrap en pantalla

Se agrego el helper `safeStep(label, fn)` en bootstrap. Cada paso muestra su nombre en pantalla durante la carga (`initDB`, `getAuthCache`, `applyTheme`, `getSession`, etc.) y captura errores con el nombre del paso en el mensaje. Facilita diagnostico en APK de produccion sin necesidad de logcat.

### Fix: `ExpoAudio.setAudioModeAsync` ClassCastException en Android

El modulo nativo de Expo Go espera un enum entero para `interruptionMode`, pero el tipo JS de `expo-audio` pasa un string (`'mixWithOthers'`), causando `ClassCastException` en Android. Solucion: omitir `interruptionMode` (es opcional segun el tipo nativo).

### Logout sin conexion

`handleLogout` detecta `!networkReachable`. En ese caso hace `supabase.auth.signOut({ scope: 'local' })` (solo borra tokens locales, no llama al servidor) y muestra el mensaje: *"Sesion cerrada sin conexion. Necesitaras internet para volver a iniciar sesion."*

### Effect eliminado: setOfflineMode manual por networkReachable

El effect que antes hacia `setOfflineMode(!networkReachable)` cada vez que cambiaba la conectividad fue eliminado. Era redundante con el nuevo `useMemo` derivado y causaba re-runs de efectos secundarios.

### Archivos modificados en esta sesion

- `App.js` — bootstrap, offlineMode derivado, userExplicitlyLoggedOut, safeStep, handleLogout
- `src/hooks/useDashboard.js` — resetDashboard en useCallback
- `src/hooks/useNotifications.js` — reset en useCallback, import useCallback
- `src/services/soundFeedback.service.js` — omitir interruptionMode

---

## Actualizacion reciente (2026-03-26) — Offline robustez y mejoras transversales

Se realizo una pasada transversal de robustez offline con los siguientes cambios:

**App.js — limpieza y calentamiento de cache**
- Se eliminaron ~1544 lineas de StyleSheet que eran codigo muerto (estilos de componentes ya extraidos a sus propios archivos). El archivo bajo de ~3100 a ~1630 lineas.
- `warmCriticalOfflineCaches` ahora se ejecuta en 4 momentos: login, recuperacion de red, sync exitoso y cada 5 minutos mientras haya red. Incluye calentamiento de `listLocations` y `listStockBalances` (pagina 1) para que sedes e inventario esten disponibles offline.
- Se agrego import de `listLocations` y `listStockBalances` desde `inventoryCatalog.service`.

**`sync.service.js` — dispatcher generalizado con mapa de handlers**
- Se reemplazo el if/else hardcodeado por un mapa `OP_HANDLERS = { CREATE_SALE: processCreateSale, ... }`.
- Tipos de operacion desconocidos quedan marcados como `NO_RETRY` automaticamente.
- Agregar soporte para nuevos tipos (`CREATE_RETURN`, `CREATE_CARTERA_PAYMENT`, etc.) solo requiere agregar una entrada al mapa.

**`useSync.js` — desacople de offlineMode vs networkReachable**
- El loop de sync ahora usa `networkReachable` (conectividad real) en lugar de `offlineMode` (estado UI).
- Permite que el sync corra aunque el usuario haya activado modo offline manual, si hay red real disponible.

**`offlineCache.service.js` — deteccion de cache vencido**
- Se agrego y exporta `isCacheStale(cachedAt)`: devuelve `true` si el cache tiene mas de 24 horas.

**`usePaginatedList.js` — advertencia de datos desactualizados**
- Al servir datos desde cache, verifica si tiene mas de 24 horas. Si es asi, muestra mensaje al usuario indicando que los datos estan desactualizados.

**`database.native.js` — ops atascadas y cola completa**
- `resetStuckProcessingOps()` se llama al inicializar SQLite. Regresa a PENDING las ops que quedaron en PROCESSING por crash de la app.
- `getAllQueuedOps({ tenantId, limit })` devuelve todas las ops pendientes incluyendo las bloqueadas (NO_RETRY), con campo `isNoRetry` para la UI.

**`SyncQueueModal.js` — nuevo componente**
- Bottom sheet que muestra la cola de operaciones pendientes.
- Por cada op: tipo legible (Venta, Pago cartera, etc.), tiempo relativo, reintentos, error, botones Reintentar y Descartar.
- Contador de pendientes vs bloqueadas. Boton "Sync ahora" deshabilitado sin red.

**`AppBar.js` — chip de conexion interactivo**
- El chip de estado de red ahora es un `Pressable`. Si hay ops pendientes, tocarlo abre el `SyncQueueModal`.

**`PointOfSaleScreen.js` — autosave de carrito + fix sesion expirada offline**
- Autosave con debounce 2s: el carrito activo se guarda en cache local. Al volver, si el carrito esta vacio, se restaura el borrador automaticamente.
- Sesion expirada offline: antes bloqueaba el boton Cobrar incluso sin red. Ahora en modo offline muestra advertencia y deja continuar; la venta se encola y el servidor valida al sincronizar.

**`inventoryCatalog.service.js` — cache para sedes e inventario**
- `listLocations`: guarda en SimpleCache al traer online, sirve cache en modo offline, usa cache como fallback ante error de red.
- `listStockBalances`: usa PageCache con namespace `inventory-stock` y filtros `{ locationId, isComponent }`. Mismo patron: guarda online, sirve offline, fallback ante error.

**7 pantallas — propagacion de offlineMode a listLocations/listStockBalances**
- `SalesHistoryScreen`, `InventoryScreen`, `BatchesScreen`, `ProductionOrdersScreen`, `PurchasesScreen`, `CashRegistersScreen`, `CashAssignmentsScreen` ahora pasan `{ offlineMode }` a `listLocations`.
- `InventoryScreen` tambien pasa `offlineMode` a `listStockBalances`.

---

## Actualizacion anterior

- Se inicio una pasada transversal de ortografia y consistencia visual de textos en la app mobile.
- Se centralizaron textos reutilizables en `src/constants/uiText.js` para componentes compartidos, autenticacion y etiquetas comunes.
- `PaginatedList`, `SearchableSelectField`, `MultiSelectField` y parte del shell principal (`App.js`) ya consumen esa base comun.
- Tambien se alineo el copy visible de multiples modulos para usar mejor espanol en labels, placeholders, validaciones y estados de cache offline.
- El modelo local de IA ahora empieza a descargarse en segundo plano despues del inicio de sesion cuando el runtime local esta habilitado.
- La descarga del modelo embebido ya es compartida a nivel app para evitar carreras o descargas duplicadas entre `App.js` y POS.
- En POS, camara/chat/voz IA quedan bloqueados mientras el modelo local siga descargandose, aunque la descarga haya arrancado desde background.
- En push Android, la app ahora declara explicitamente `POST_NOTIFICATIONS` en nativo y el dispatcher ya no depende de Expo Push: Android registra token FCM nativo y `push-dispatcher` envia directo a FCM HTTP v1; Expo queda como fallback/iOS por ahora.
- En POS, los atajos de efectivo ya no representan incrementos (`+5000`, `+10000`); ahora representan montos reales recibidos y resaltan el valor aplicado para que el flujo de cobro sea mas natural para caja.
- El detector de conectividad en `App.js` ya no manda la app a offline automatico con una sola falla aislada: ahora usa timeout mas amplio y exige varias fallas consecutivas antes de cambiar el estado operativo.
- Se definio una propuesta arquitectonica separada para monetizacion por tenant en `docs/TENANT_BILLING_MONETIZATION_DESIGN.md`, con planes, suscripciones, renovaciones, gracia, suspension y enforcement por features/limites.
- Ya existe una migracion inicial `migrations/ADD_TENANT_BILLING_MONETIZATION.sql` que crea el dominio SQL base de billing para tenants: planes, precios, suscripciones, periodos, invoices, pagos, resumen operativo y seeds iniciales.
- La migracion de billing ya incluye hardening de seguridad para Supabase: RLS, aislamiento por tenant, catalogo de planes en solo lectura para autenticados y acceso resumido por funcion segura.
- Existe ademas `docs/TENANT_BILLING_IMPLEMENTATION_STATUS.md` como bitacora corta de esta implementacion puntual de billing y su estado actual.
- El header mobile se simplifico: se retiro el avatar de iniciales, el estado online/offline ahora usa un icono compacto sin texto y el cambio de tema oscuro/claro se movio del header al menu lateral.
- Se reforzaron las capas visuales de filtros con fecha en mobile: `DatePickerField`, `SalesHistoryScreen` y `ReportsScreen` ahora respetan mejor `zIndex`/`overflow` para evitar que filtros o pickers queden peleando con otros bloques de la vista.
- En POS se ajusto la UX del bloque IA: el panel ahora respeta mejor el tema claro/oscuro, los estados activos tienen mejor contraste y el banner de trabajo ya no queda visualmente ambiguo en modo oscuro.
- El matching IA de catalogo para pedidos/chat/OCR se volvio mas estricto contra falsos positivos por prefijos cortos de SKU: ahora prioriza coincidencia real por nombre y evita casos como interpretar `Pan tajado` como un `Pantalon` solo por coincidir con `PAN-...`.
- El POS ya no depende de cargar un catalogo masivo completo antes de cada comando IA: el pipeline sigue `cache -> parser deterministico -> llm local -> llm cloud`, y luego resuelve productos con retrieval de candidatos por linea + matching, con fallback controlado a catalogo mas amplio solo si hace falta.
- En tablet/Android el manejo del inset inferior del sistema ya no debe depender solo de pantallas puntuales: `App.js` ahora reserva ese espacio desde el shell/layout del modulo activo, y los componentes/pantallas especificos solo agregan ajustes finos para modales, paginacion o acciones fijas.
- El calculo del inset inferior Android se endurecio con heuristica para tablets/pantallas grandes cuando `Dimensions` subreporta la barra de navegacion; `PaginatedList` ahora usa ese inset con mas aire para que la paginacion no quede debajo de la barra del sistema.
- El chequeo periodico de conectividad del shell mobile ya no consulta el root ` /rest/v1/ ` con `anon key`; ahora usa ` /auth/v1/health ` para no depender del acceso anonimo al esquema OpenAPI que Supabase retirara para proyectos existentes el 8 de abril de 2026.
- Se introdujo una pasada transversal para compactar filtros mobile: ahora existe una seccion reusable colapsable para filtros y ya se aplico en modulos con filtros altos como ventas, reportes, reglas de precio, reglas de impuesto y asignaciones de caja para liberar viewport por defecto.
- Tambien se creo una base reusable de `BottomSheetModal` para unificar manejo de safe area + teclado + footer en sheets mobile; `SearchableSelectField` y flujos clave como sesiones de caja/detalle de ventas ya consumen esa base para reducir huecos inferiores y mejorar visibilidad del input activo.
- En filtros con fechas (`SalesHistoryScreen`, `ReportsScreen`, `DatePickerField`) se bajo el uso de `overflow`/`zIndex` agresivo solo en Android para evitar que las tarjetas de filtros se monten unas sobre otras.
- Decision de arquitectura vigente: la correccion definitiva de la barra de navegacion Android no debe seguir resolviendose por componente o heuristica local; debe migrarse a una solucion global desde el root/layout de la app usando safe areas reales del sistema.
- Esa migracion global ya se movio a `App.js` con `react-native-safe-area-context` (`SafeAreaProvider` + `useSafeAreaInsets()`), de modo que el shell principal consuma insets reales del sistema para header, drawer, contenido y dock inferior.
- `useAndroidBottomInset()` ya no intenta absorber altura del teclado: su responsabilidad global queda limitada al espacio real del sistema (`safe area` + fallback Android). El manejo del teclado debe resolverse en contenedores modal/form reutilizables, no sumando ese alto al inset base.
- En modulos paginados con accion principal de crear/abrir, el patron recomendado ya no es boton fijo abajo peleando con la paginacion; ahora existe `ListHeaderActionButton` y varias pantallas (`CashSessions`, `Products`, `Users`, `ThirdParties`, `CashRegisters`, `PaymentMethods`, `Categories`, `Units`, `PricingRules`, `TaxRules`, `RolesMenus`, `CashAssignments`) ya movieron esa accion al header del `PaginatedList`.
- En tema claro tambien se aumento el contraste visual de la paginacion compartida para que los controles inferiores no se vean lavados en pantallas grandes.
- `TenantConfigScreen` ya expone tambien configuracion de `Contabilidad` y de `Facturacion Electronica` avanzada (proveedor FE + resolucion DIAN activa) alineada con web, pero por ahora eso se limita a cargar/guardar configuracion; no activa todavia operacion contable ni emision FE avanzada desde mobile.
- La app ya tiene una base reusable de sonidos UI con `expo-audio`: se precargan desde el root y POS ya reproduce feedback local al agregar un item al carrito.
- El flujo de fotos por producto ya quedo validado en mobile: la carga al bucket privado funciona, pero si el bucket `productmedia` no existe debe crearse manualmente en Supabase Storage antes de probar.
- La IA asociada a fotos por producto depende de la Edge Function `product-photo-analyzer`; si la app muestra `HTTP 404`, normalmente significa que la function no esta desplegada o que el nombre configurado en mobile no coincide con el deploy real.
- El aislamiento multi-tenant de fotos por producto hoy se apoya en tres capas: `tenant_id` en `product_media`, path fisico `tenantId/productId/...` dentro de Storage y policies sobre `storage.objects` que restringen acceso a la carpeta del tenant autenticado.
- El Security Advisor de Supabase reporto en produccion cinco tablas core sin RLS (`customers`, `locations`, `product_variants`, `products`, `tenants`); el repo ya incluye hardening adicional en `migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql`, pero sigue siendo necesario aplicarlo/verificarlo en el proyecto remoto.

## 1. Proposito

POSLite Mobile es la app mobile de punto de venta multi-tenant construida con React Native + Expo. Su objetivo es permitir operacion comercial, administrativa y de consulta con soporte offline-first, sincronizacion diferida y consumo de backend Supabase.

La app no es un MVP pequeno: hoy cubre una parte importante del flujo operativo del negocio, incluyendo POS, inventario, terceros, cartera, cajas, reportes, configuracion e integraciones asistidas por IA.

## 2. Stack principal

- React `19.1.0`
- React Native `0.81.5`
- Expo SDK `54`
- Expo Audio `expo-audio` para sonidos cortos de feedback UI
- Supabase JS `v2`
- SQLite local con `expo-sqlite`
- AsyncStorage para persistencia de sesion
- Expo Notifications para push e in-app notifications
- `llama.rn` para modelos embebidos/locales
- `react-native-vosk` para voz local
- `expo-text-extractor` y flujo OCR por Edge Functions

Archivos de referencia:

- `package.json`
- `app.json`
- `app.config.js`
- `src/lib/supabase.js`

## 3. Arquitectura actual

### 3.1 Orquestacion principal

El entrypoint real de la aplicacion es `App.js`. Actualmente concentra gran parte de la logica transversal:

- bootstrap inicial
- resolucion de sesion
- carga de perfil y tenant
- tema
- menu dinamico
- dashboard/home
- modo offline
- sincronizacion
- notificaciones
- render manual de pantallas

Esto hace que `App.js` sea el archivo con mayor deuda tecnica del proyecto y el principal candidato a dividir por responsabilidades.

Nota de estado actual:

- aunque `App.js` sigue siendo monolitico, el render de modulos ya no cuelga completamente del mismo arbol inline
- existe un `ActiveModuleScreen` memoizado para aislar mejor la pantalla activa frente a cambios de estado global como alertas/notificaciones
- esto reduce el efecto visual de "recarga completa" cuando se actualiza el inbox de notificaciones

### 3.2 Navegacion

La app no usa actualmente `react-navigation` ni `expo-router` como mecanismo principal de navegacion. La navegacion se resuelve con estado local (`currentScreen`) y render condicional de pantallas desde `App.js`.

La traduccion entre menus/rutas/pantallas se apoya en:

- `src/navigation/menuMapper.js`
- `src/navigation/mobileScreenConfig.js`

Aspectos clave:

- existe un `ROUTE_SCREEN_MAP` para traducir rutas web a pantallas mobile
- se mezclan menus remotos con secciones core obligatorias
- el acceso a pantallas depende del arbol de menus permitido por usuario
- algunas pantallas siempre estan permitidas, como `Home`, `About` y `AIInsights`

### 3.3 Refresh de modulos y listas

Los listados paginados mobile ya soportan gesto de pull-to-refresh.

Implementacion observada:

- `src/hooks/usePaginatedList.js` maneja `loading` y `refreshing` por separado
- `src/components/PaginatedList.js` integra `RefreshControl`
- al jalar hacia abajo se recarga el modulo actual sin reemplazar toda la vista por un loading global

Implicacion practica:

- para modulos basados en `PaginatedList`, la recarga esperada del usuario en mobile ya es gesto nativo de arrastre hacia abajo
- si un listado no responde a este patron, primero conviene validar si realmente usa `usePaginatedList` + `PaginatedList`

## 4. Flujo de arranque

Resumen del bootstrap actual:

1. Inicializa SQLite local.
2. Carga cache local de autenticacion y menu.
3. Resuelve tema desde preferencia cacheada y/o configuracion tenant.
4. Consulta la sesion vigente en Supabase.
5. Si hay sesion, hidrata perfil, tenant, menus y datos base.
6. Si no hay sesion pero existe cache valido, permite continuidad en modo offline.

Este enfoque esta alineado con una app de operacion en campo o punto de venta, donde perder conectividad no debe bloquear por completo la operacion.

## 5. Backend y persistencia

### 5.1 Supabase

Supabase es el backend principal para:

- autenticacion
- tablas operativas
- vistas
- RPC
- Edge Functions
- notificaciones/realtime
- push remoto para barra del sistema via Edge Function `push-dispatcher` + Supabase Cron; Android usa FCM directo y iOS/fallback sigue pudiendo usar Expo Push

Variables publicas criticas:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_CHAT_ORDER_EDGE_FUNCTION`
- `EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL`
- `EXPO_PUBLIC_DEEPSEEK_OCR_EDGE_FUNCTION`
- `EXPO_PUBLIC_DEEPSEEK_TEXT_EDGE_FUNCTION`

### 5.2 SQLite local

La capa offline local vive en `src/storage/sqlite/database.native.js`.

Tablas importantes observadas:

- `pending_ops`
- `sync_state`
- `auth_cache`
- `menu_cache`
- borradores locales de venta y pagos

Responsabilidades principales:

- cache de autenticacion
- cache de menu
- borradores operativos
- cola de operaciones pendientes
- continuidad offline de flujos criticos

### 5.3 Monetizacion tenant

Estado actual:

- no se observo una capa real de billing o suscripciones ya implementada en mobile
- `tenant_settings` hoy pertenece a configuracion operativa, no a facturacion comercial del tenant

Direccion definida:

- la monetizacion multi-tenant debe vivir como dominio separado
- el backend debe ser la fuente de verdad del estado comercial de cada tenant
- mobile debe consumir un resumen operativo de billing para mostrar plan, vencimiento, gracia, suspension y limites efectivos
- la referencia de diseno actual es `docs/TENANT_BILLING_MONETIZATION_DESIGN.md`
- la base SQL inicial ya vive en `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`
- el estado puntual de esta implementacion vive en `docs/TENANT_BILLING_IMPLEMENTATION_STATUS.md`

## 6. Estrategia offline-first

La app ya tiene una estrategia offline real, no solo mensajes de error.

Puntos importantes:

- operaciones pendientes se encolan localmente en `pending_ops` (SQLite)
- existe sincronizacion diferida con reintentos y backoff exponencial
- hay lectura desde cache cuando la red o el backend fallan
- el conteo de pendientes se expone en la experiencia de usuario via badge en AppBar
- al arrancar, `resetStuckProcessingOps` limpia ops atascadas en PROCESSING por crash previo
- el dispatcher de sync usa un mapa `OP_HANDLERS` extensible; agregar un nuevo tipo solo requiere una entrada en el mapa
- el calentamiento de cache corre en login, recuperacion de red, sync exitoso y cada 5 minutos; cubre: sesion de caja, metodos de pago, catalogo de clientes, cajas activas, catalogo POS, productos, sesiones de caja, ventas, sedes e inventario (pagina 1)
- `isCacheStale(cachedAt)` detecta cache de mas de 24 horas; `usePaginatedList` avisa al usuario si los datos mostrados son viejos
- el loop de sync usa `networkReachable` (conectividad real), no `offlineMode` (estado UI); un usuario en modo offline manual puede sincronizar si hay red
- la cola de operaciones pendientes es visible e interactuable desde `SyncQueueModal` (accesible tocando el chip de conexion en AppBar)
- el carrito del POS se autosalva con debounce de 2s; al volver se restaura si estaba vacio
- sesion de caja expirada en modo offline: permite continuar la venta y encolarla; el servidor valida al sincronizar

Archivos clave:

- `src/services/sync.service.js`
- `src/hooks/useSync.js`
- `src/services/offlineCache.service.js`
- `src/hooks/usePaginatedList.js`
- `src/storage/sqlite/database.native.js`
- `src/components/SyncQueueModal.js`

## 7. Modulos funcionales actuales

Segun codigo y checklist vigente, los modulos mobile actualmente presentes son:

- Punto de venta
- Historial de ventas
- Plan Separe
- Cartera
- Terceros
- Clientes y proveedores como alias de navegacion sobre terceros
- Productos
- Categorias
- Unidades
- Carga masiva
- Inventario
- Lotes y vencimientos
- Compras
- Ordenes de produccion
- BOMs
- Sesiones de caja
- Cajas registradoras
- Asignaciones de caja
- Metodos de pago
- Reportes
- Centro IA
- Setup
- Configuracion de empresa
- Sedes
- Impuestos
- Reglas de impuesto
- Reglas de precio
- Usuarios
- Roles y menus
- About

Importante:

- parte de la documentacion antigua aun menciona `TaxRules`, `PricingRules`, `Users` y `RolesMenus` como placeholder
- el checklist mas reciente ya los marca como migrados/funcionales
- para estado real conviene confiar primero en `src/screens/*`, `src/services/*` y en `docs/MOBILE_IMPLEMENTATION_CHECKLIST.md`

## 8. POS actual

`src/screens/PointOfSaleScreen.js` es uno de los modulos mas completos y grandes del proyecto.

Capacidades visibles:

- venta rapida
- multiples medios de pago
- referencia por pago
- fecha/hora manual de venta condicionada por tenant settings para administradores/gerentes
- retrofecha maxima controlada por `pos_max_backdate_hours`
- seleccion de cliente
- favoritos
- busqueda por nombre, codigo y SKU
- captura rapida compatible con lector
- ventas en espera (hold/resume)
- notas de venta
- soporte de IA para cargar pedidos desde texto/chat
- bloqueo cuando la sesion de caja supera `cash_session_max_hours`

Esto sugiere que el POS mobile no es solo un visor, sino un modulo operativo principal.

## 9. Historial de ventas y facturacion electronica

`src/screens/SalesHistoryScreen.js` incluye logica relevante de postventa y seguimiento:

- devoluciones
- anulaciones
- validacion de saldos pendientes por devolver
- campos de facturacion electronica como `invoice_type`, `dian_status` y `cufe`
- accion de `Reintentar FE`

Esto vuelve el historial una pantalla de operacion y soporte, no solo de consulta.

## 10. IA, OCR y voz

La app tiene una apuesta fuerte por asistentes operativos.

### 10.1 Centro IA

`src/services/aiInsights.service.js` expone un catalogo de analisis operativos, entre ellos:

- inventario
- compras
- ventas
- cajas
- cartera
- produccion
- terceros
- resumen ejecutivo

### 10.2 OCR e importacion por foto

Existe flujo de lectura de facturas y parseo estructurado de productos mediante:

- `src/screens/BulkImportsScreen.js`
- `src/services/invoiceAgent.service.js`

Capacidades observadas:

- tomar foto o elegir de galeria
- optimizar imagen para OCR
- extraer texto y estructurarlo con IA
- convertir factura/foto en items importables

### 10.3 Voz y LLM local

El motor de comandos local vive en `src/services/commandEngine/*`.

Se identificaron:

- Vosk para speech-to-text local
- `llama.rn` para inferencia embedded/local
- parser deterministico como fallback
- OCR nativo adicional
- motor para consultas de reportes en lenguaje natural

Nota operativa:

- varias funciones locales requieren build nativo/dev build y no funcionaran en Expo Go
- el flujo de push remoto a barra del sistema debe validarse en dev build o build nativa; Expo Go no debe considerarse entorno valido para esa verificacion
- en Android, la barra del sistema requiere FCM configurado (`google-services.json` + plugin Google Services); el inbox in-app por realtime no sustituye esa capa
- la app mobile ya intenta registrar `push_provider = fcm` en Android mediante `expo-notifications.getDevicePushTokenAsync()`; si eso falla, puede caer a Expo como fallback, pero el camino objetivo es FCM directo
- el dispatcher ahora necesita la credencial `FIREBASE_SERVICE_ACCOUNT_JSON` en Supabase Edge Functions para Android; la dependencia de Expo/EAS para entrega Android deja de ser el camino principal
- la ruta de diagnostico cuando solo funciona la campanita es: permiso SO -> token/proveedor en `user_push_devices` -> filas en `notification_push_queue` -> `push-dispatcher`/cron -> secret `FIREBASE_SERVICE_ACCOUNT_JSON`

## 11. Tema y experiencia visual

La regla de tema actual prioriza:

1. preferencia local cacheada del usuario
2. `tenant_settings.theme` cacheado
3. fallback

La documentacion historica menciona fallback a `dark`, aunque el comportamiento exacto debe validarse siempre contra `src/lib/themePreferences.js` y el flujo actual de `App.js`.

Tambien existe una capa centralizada de colores/tokens en:

- `src/theme/colors.js`

Consideracion de layout mobile:

- en Android con barra de navegacion clasica de 3 botones, la app debe respetar inset inferior para que docks, footers y acciones fijas no queden tapados por botones del sistema
- este ajuste afecta especialmente contenedores fijos inferiores como el dock principal y footers de modales o drawers

Consideracion de experiencia:

- las alertas/notificaciones in-app no deberian transmitir sensacion de reinicio completo del modulo visible
- el estado actual ya desacopla mejor el drawer/inbox de notificaciones respecto al render del modulo activo

## 12. Estado de calidad del repo

Estado observado hoy:

- no encontre suite de tests automatizados en el repo
- no encontre configuracion activa de ESLint o Prettier
- el proyecto depende bastante de smoke testing manual

Esto coincide con la deuda declarada en el checklist y aumenta el riesgo de regresiones, sobre todo en modulos grandes como POS, reportes, terceros y `App.js`.

## 13. Deuda tecnica principal

Los puntos mas claros hoy son:

- `App.js` es monolitico y concentra demasiadas responsabilidades
- la navegacion esta resuelta manualmente y puede volverse fragil al crecer
- no hay toolchain de calidad base visible
- parte de la documentacion esta desactualizada frente al estado real mobile
- el soporte offline parece fuerte en ventas, pero no igualmente maduro en todos los modulos
- algunos cron historicos todavia aparecen en documentacion antigua; el scheduler objetivo ya es Supabase Cron y el push-dispatcher debe ejecutarse desde jobs de Supabase

## 14. Archivos clave para onboarding

Si alguien nuevo entra al proyecto, el orden recomendado de lectura es:

1. `docs/CONTEXTO_MOBILE.md`
2. `docs/MOBILE_IMPLEMENTATION_CHECKLIST.md`
3. `App.js`
4. `src/navigation/menuMapper.js`
5. `src/navigation/mobileScreenConfig.js`
6. `src/storage/sqlite/database.native.js`
7. `src/services/sync.service.js`
8. `src/screens/PointOfSaleScreen.js`
9. `src/screens/SalesHistoryScreen.js`
10. `src/screens/AIInsightsScreen.js`

## 15. Recomendaciones para trabajar sobre esta base

Antes de tocar codigo sensible, conviene asumir estas reglas practicas:

- validar siempre si el flujo debe funcionar online y offline
- revisar si la pantalla depende de menus/permisos por ruta
- confirmar si el cambio impacta cache local o `pending_ops`
- revisar si el modulo tiene integraciones con Supabase RPC o Edge Functions
- en flujos de POS, ventas, OCR o voz, probar en dispositivo/build nativo cuando aplique

## 16. Novedades recientes relevantes

Fotos de producto:

- `ProductsScreen` ya soporta portada y galeria por producto usando `product_media`
- el limite actual es `5` fotos por producto y cada imagen se comprime a JPEG con tope cercano a `2 MB`
- las imagenes viven en bucket privado `productmedia` y se consumen via signed URLs
- el listado de productos ahora puede mostrar portada y conteo de fotos sin consultas manuales en la UI

IA aplicada a fotos de producto:

- existe la edge function `product-photo-analyzer`
- la IA hoy se usa como asistente de catalogacion: sugiere nombre, categoria, marca, descripcion corta, etiquetas y warnings
- las sugerencias quedan asociadas a `product_media` y desde `ProductsScreen` se pueden aplicar al formulario del producto
- el modelo actual de producto no tiene campo estructurado para marca, asi que por ahora esa señal queda como sugerencia y no como columna propia

Backend de soporte:

- migracion nueva: `migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql`
- hardening adicional de seguridad: `migrations/HARDEN_PUBLIC_RLS_REMAINING_TABLES.sql`
- servicio mobile nuevo: `src/services/productMedia.service.js`
- el feature depende de ejecutar la migracion, crear/verificar el bucket `productmedia` y desplegar la edge function antes de probar en app
- para diagnostico operativo del feature conviene revisar tambien `docs/PRODUCT_PHOTOS_AI_SETUP.md`

## 17. Resumen ejecutivo

POSLite Mobile ya es una app operativa amplia, con backend Supabase, base offline consistente y una capa diferencial de IA/OCR/voz. El proyecto esta avanzado funcionalmente, pero aun arrastra deuda estructural importante, especialmente por el tamano de `App.js`, la falta de tooling de calidad y la mezcla entre documentacion actualizada y documentacion historica.

La lectura correcta del estado del proyecto hoy es:

- funcionalmente: avanzado
- arquitectonicamente: util y productivo, pero tensionado
- mantenibilidad: media, con necesidad clara de modularizacion
