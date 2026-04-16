# CONTEXTO_ULTIMO

Fecha de actualizacion: 2026-04-16
Owner: Equipo POSLite
Ultimo cambio registrado: backend Supabase compartido queda canonizado en `shared/supabase`; web mantiene rutas historicas mediante symlinks y ya no debe editar migraciones/functions compartidas desde `web/`

## Regla de versionado de contexto (obligatoria)

Este archivo SIEMPRE representa el contexto activo mas reciente.

### Convencion

- Archivo activo: `CONTEXTO_ULTIMO.md`
- Archivo historico: `CONTEXTO_YYYY-MM-DD.md` (o `CONTEXTO_YYYY-MM-DD_HHMM.md` si hay mas de uno el mismo dia)

### Flujo cuando se genere un nuevo contexto

1. Renombrar el archivo actual `CONTEXTO_ULTIMO.md` a su version fechada.
2. Crear un nuevo `CONTEXTO_ULTIMO.md` con el contexto actualizado.
3. Mantener en el nuevo archivo esta misma seccion de reglas.
4. Actualizar este archivo inmediatamente despues de cada modificacion funcional o tecnica relevante (sin esperar cierre de sprint).

### Ejemplo rapido

```bash
mv CONTEXTO_ULTIMO.md CONTEXTO_2026-03-11.md
# luego crear nuevo CONTEXTO_ULTIMO.md
```

## Estado tecnico actual

### Ajuste reciente de arquitectura backend (2026-04-16) — web deja de ser dueno de los artefactos Supabase compartidos

- Se unifico el backend Supabase comun del monorepo.
- La fuente canonica ahora vive en:
  - `shared/supabase/migrations`
  - `shared/supabase/functions`
- Para web esto cambia una regla importante de mantenimiento:
  - los archivos compartidos ya no deben editarse directamente desde `web/migrations` ni desde `web/supabase/functions`
  - esos paths se conservaron para no romper despliegues, pero ahora apuntan por symlink al contenido de `shared/supabase`
- Shared canonizado en esta fase:
  - `145` migraciones comunes entre `web` y `mobile`
  - `create-tenant-user`
  - `chat-order-parser`
- Reglas operativas nuevas del lado web:
  - editar primero en `shared/supabase`
  - validar alineacion con `scripts/sync-shared-supabase.sh check`
  - usar `scripts/sync-shared-supabase.sh link` como modo recomendado
  - usar `scripts/sync-shared-supabase.sh sync` solo como fallback si un entorno no tolera symlinks
- Lo que sigue siendo ownership especifico de `web`:
  - `supabase/functions/accounting-queue-worker`
  - `supabase/functions/deepseek-proxy`
  - migraciones/artefactos de contabilidad y superadmin que no existen en mobile

### Ajuste reciente de backend compartido (2026-04-16) — `chat-order-parser` y bucket de data import quedan reconciliados

- `chat-order-parser` ya no diverge entre `web` y `mobile`.
- El contrato compartido ahora soporta `force_refresh` como parametro opcional para saltar cache server-side cuando haga falta reintentar parsing IA.
- `SETUP_DATAIMPORT_BUCKET.sql` tambien quedo reconciliada:
  - se conserva la variante compatible con Supabase administrado
  - ya no se intenta `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`
  - esto evita errores tipo `must be owner of table objects` en entornos reales
  - la migracion comun tambien se promueve desde `shared/supabase/migrations`

### Ajuste reciente de paridad transversal (2026-04-12) — mobile ya no finge equivalencias con web

- Aunque el cambio principal vive del lado mobile, afecta la lectura real de paridad del monorepo y por eso queda registrado aqui.
- `mobile` ahora corrige varias falsas equivalencias respecto a rutas web:
  - `/settings` ya no abre `Setup`; ahora tiene `SettingsScreen`
  - `/roles` ya no abre `RolesMenus`; ahora tiene `RolesScreen` como vista de consulta
  - `TenantManagement` ya no cae en `TenantConfigScreen`; ahora tiene `TenantManagementScreen`
  - `openManual` ya no muestra error; ahora abre `HelpCenterScreen`
- `mobile/src/navigation/menuMapper.js` ahora marca `accounting` y `superadmin/billing` como `web-only`.
- `mobile/src/components/MenuDrawer.js` ya expone esos accesos con badge `WEB`, evitando que el usuario interprete falta de permiso o paridad incompleta como bug.
- Cobertura agregada del lado mobile para esta tanda:
  - `mobile/src/__tests__/menuMapper.test.js`
  - `mobile/src/__tests__/helpCenter.test.js`
  - actualizacion de `mobile/src/__tests__/setupGuideContent.test.js`
- Lectura vigente desde web:
  - `help`, `settings` y `roles` ya tienen un espejo conceptual mas sano en mobile
  - `accounting` y `superadmin billing` siguen siendo diferencias deliberadas `web-only`

### Ajuste reciente de estabilidad (2026-04-12) — reportes de vencimiento usan columna real de lotes

- `src/services/reports.service.js` corrige una referencia legacy a `inventory_batches.quantity_on_hand`.
- La columna real del proyecto es `inventory_batches.on_hand`.
- El fix aplicado:
  - `select(...)` ahora pide `on_hand`
  - el filtro `.gt(...)` ahora usa `on_hand`
  - `quantity` y `at_risk_value` ahora se calculan desde `on_hand`
- Este ajuste tambien se hizo en el lado mobile para mantener paridad de inventario/reportes.

### Ajuste reciente de paridad (2026-04-12) — OCR de compras ahora crea faltantes desde web

- `src/views/Purchases.vue` ya no se queda solo en mostrar lineas sin match detectadas por OCR.
- El flujo web ahora permite:
  - detectar faltantes de catalogo desde la factura
  - sugerir nombre/variante con IA
  - crear la variante faltante
  - agregarla inmediatamente al borrador de compra
- Soporte nuevo:
  - `src/services/purchaseInvoiceAssistant.service.js`
  - `src/services/purchases.service.js` ahora expone `createCatalogVariantForPurchase(...)`
- Cobertura agregada:
  - `src/services/__tests__/purchaseInvoiceAssistant.service.test.js`
- Estado funcional vigente:
  - web y mobile quedan alineados en la capacidad de crear articulos faltantes desde factura OCR
  - la UI web mantiene preview corto de faltantes, pero la accion `Crear todos` opera sobre la lista completa pendiente

### Ajuste reciente de paridad (2026-04-12) — brechas cerradas en mobile que impactan a web

- Aunque estos cambios viven del lado mobile, afectan la lectura real de paridad del monorepo y por eso quedan registrados aqui:
  - `mobile/src/screens/ReportsScreen.js` ya cubre inventario por sede, sin movimiento y proximos a vencer
  - `mobile/src/screens/PurchasesScreen.js` ya cubre OCs pendientes, CxP proveedores, sugerencias IA y analisis IA
  - `mobile/src/screens/InventoryScreen.js` ya incluye `Ingreso por Compra`
- Lectura de producto vigente despues de este ajuste:
  - `tenant management` y `contabilidad avanzada` siguen siendo `web-only`
  - inventario, compras y reportes quedan con mucha menor disparidad entre apps

### Ajuste reciente de paridad (2026-04-12) — IA/OCR en web + ayuda compacta en mobile

- `src/views/AIInsights.vue` agrega un `Centro IA` compacto en web:
  - consultas libres al agente operativo
  - atajos por dominio (ventas, inventario, compras, caja, cartera, produccion)
  - soporte via `src/services/opsRagAgent.service.js`
- `src/views/Purchases.vue` ahora soporta OCR de facturas:
  - subir o tomar foto dentro del dialogo de compra
  - extraer proveedor + lineas con `src/services/purchaseInvoiceOcr.service.js`
  - hacer matching contra catalogo usando `src/utils/purchaseInvoiceOcr.js`
  - mezclar las coincidencias con el borrador de compra existente
- `src/views/BulkImports.vue` ahora soporta foto a borrador:
  - analizar una foto/listado
  - revisar filas detectadas
  - importar a catalogo e inventario con `src/services/productPhotoImport.service.js`
- Cobertura agregada:
  - `src/utils/__tests__/aiInsightsCenter.test.js`
  - `src/utils/__tests__/purchaseInvoiceOcr.test.js`
  - `src/utils/__tests__/productPhotoBulkImport.test.js`
- `mobile/src/screens/SetupScreen.js` gana una capa de onboarding y ayuda compacta:
  - flujo recomendado extendido
  - rutas guiadas a POS, compras, inventario y reportes
  - FAQ embebida con aclaracion de modulos web-only

### Ajuste reciente de calidad (2026-04-12) — coverage y tests de servicios

- `package.json` ya expone `test:coverage`.
- `vitest.config.js` ahora define cobertura V8 para el codigo fuente web.
- Se agregaron tests de servicios con mocks para los flujos mas sensibles de IA/OCR:
  - `src/services/__tests__/opsRagAgent.service.test.js`
  - `src/services/__tests__/purchaseInvoiceOcr.service.test.js`
  - `src/services/__tests__/productPhotoImport.service.test.js`
- Para que esas pruebas no dependan del render completo de la vista, parte del flujo se movio a helpers puros:
  - `src/utils/aiInsightsViewModel.js`
  - `src/utils/purchasesInvoiceFlow.js`
  - `src/utils/bulkImportPhotoFlow.js`

### Ajuste reciente de POS (2026-04-12) — OCR por imagen para pedido natural en web

- `src/views/PointOfSale.vue` ya no depende solo de texto pegado; ahora permite tomar o subir una imagen/captura con texto para convertirla a venta.
- El flujo nuevo usa:
  - `src/services/orderImageOcr.service.js`
  - `src/utils/orderImageOcr.js`
- Estrategia vigente:
  - optimizar la imagen en navegador para respetar el limite operativo de OCR
  - invocar la Edge Function configurada en `VITE_DEEPSEEK_OCR_EDGE_FUNCTION`
  - reutilizar el mismo pipeline de `analyzeChatOrderText()` y matching contra catalogo ya existente
- UX visible:
  - nuevo boton `Tomar o subir imagen`
  - resumen corto de OCR detectado antes/despues de convertir al carrito
- Cobertura agregada:
  - `src/utils/__tests__/orderImageOcr.test.js`

### Ajuste reciente de caja (2026-04-10) — validacion de sesion vencida centralizada

- La regla de expiracion de caja ya no vive repartida en calculos manuales dentro de vistas web.
- La fuente canonica ahora es `../shared/utils/cashSessionUtils.js`, con:
  - `getCashSessionState(session, maxHours)`
  - `buildCashSessionExpiredMessage(state)`
  - `validateCashSessionForOperation(session, maxHours, options)`
- Web la consume ahora en:
  - `src/composables/useTenantSettings.js`
  - `src/views/PointOfSale.vue`
  - `src/views/CashSessions.vue`
  - `src/views/Home.vue`
  - `src/views/LayawayDetail.vue`
  - `src/views/LayawayContracts.vue`
- Efecto visible:
  - mismo criterio de expiracion en todas las pantallas
  - mismo mensaje base cuando la caja supero el limite configurado
  - `Home.vue` ya no fija el copy en `24 horas`; usa el limite real del tenant
- Cobertura agregada:
  - `src/utils/__tests__/cashSessionUtils.test.js`

### Ajuste reciente de POS (2026-04-10) — venta guiada alternativa

- `src/views/PointOfSale.vue` ahora tiene una entrada nueva `Venta guiada` sin reemplazar el POS clasico.
- La estrategia vigente es:
  - mantener el POS actual como flujo rapido
  - ofrecer un flujo guiado para ventas asistidas o usuarios nuevos
  - evitar duplicar logica de negocio; el wizard usa el mismo carrito, los mismos pagos, las mismas validaciones y la misma llamada final a `salesService.createSale`
- El wizard opera en 4 pasos:
  - cliente y contexto
  - productos
  - pago
  - confirmar
- Navegacion y bloqueos centralizados:
  - `src/utils/saleWizard.js` como wrapper de `../shared/utils/saleWizard.js`
  - regla: si ya existe carrito, el wizard abre en `Productos`
  - regla: no se puede avanzar a pago sin items
  - regla: no se puede confirmar si la caja no existe o esta vencida
  - regla: no se puede confirmar con saldo faltante, error de credito o fecha manual invalida
- Integraciones operativas:
  - `Guardar en espera` y `Retomar` conviven con el wizard
  - retomar una venta en espera puede abrir directamente el flujo guiado en el paso de productos
  - si la venta se cobra desde el wizard, se reutiliza `processSale()` y el wizard se cierra al finalizar
- Cobertura agregada:
  - `src/utils/__tests__/saleWizard.test.js`

### Ajuste reciente de catalogo (2026-04-10) — creacion guiada de productos

- `src/views/Products.vue` ya no abre el formulario legacy para creacion nueva; ahora dispara `src/components/ProductCreationWizardDialog.vue`
- el wizard resume el arranque del producto en 3 pasos:
  - datos basicos
  - perfil del producto
  - configuracion minima
- el flujo guiado usa reglas compartidas desde `../shared/utils/productCreationWizard.js`
- perfiles disponibles:
  - producto simple
  - producto con variantes
  - insumo/componente
  - producto fabricado
  - combo/bundle
  - servicio
- regla UX vigente:
  - el wizard muestra por defecto solo campos esenciales del perfil elegido
  - las combinaciones manuales completas quedaron bajo `Opciones avanzadas`
  - esto preserva cobertura funcional sin convertir el wizard en el formulario legacy completo
  - el wizard comunica explicitamente que `producto simple` = una sola variante y `componente` = insumo para otros productos
  - el campo de stock mostrado en el paso minimo ahora se presenta como `alerta minima de stock`
  - `0` en ese campo significa `sin alerta minima`, no `sin control de inventario`
  - `track_inventory` ya no queda encendido por defecto para los perfiles fisicos del wizard
- el mismo `ProductCreationWizardDialog.vue` ahora se usa tambien para edicion (`mode="edit"`)
- se agrego `src/components/ProductVariantWizardDialog.vue` para crear/editar variantes con el mismo lenguaje visual del wizard
- en la edicion guiada del producto, variantes y BOM quedan como complementos dentro del mismo flujo
- para `sale_variants` el wizard reutiliza la variante `Predeterminado` auto-creada por BD y la convierte en la primera variante guiada, evitando duplicados
- el dialogo legacy de `Products.vue` se mantiene para edicion avanzada, manejo de variantes posteriores y BOM
- cobertura agregada:
  - `src/utils/__tests__/productCreationWizard.test.js`
  - `src/utils/__tests__/productVariantWizard.test.js`

### Ajuste reciente de terceros (2026-04-10) — creacion y edicion guiadas

- `src/views/ThirdParties.vue` ahora usa `src/components/ThirdPartyWizardDialog.vue` para crear y editar terceros
- por defecto el wizard inicia en tipo `cliente`; `proveedor` y `ambos` quedan como seleccion explicita
- el wizard de terceros trabaja en 3 pasos:
  - rol e identidad
  - contacto y ubicacion
  - resumen y ajustes fiscales/comerciales
- la logica comun vive en `../shared/utils/thirdPartyWizard.js`
- objetivo UX:
  - reducir carga cognitiva en nombre, documento y contacto
  - mover regimen, credito y toggles fiscales a ajustes avanzados
- cobertura agregada:
  - `src/utils/__tests__/thirdPartyWizard.test.js`

### Ajuste reciente de catalogo (2026-04-10) — fotos de producto en web

- `src/views/Products.vue` ahora incluye `src/components/ProductMediaManager.vue` como complemento del wizard de edicion.
- `src/services/productMedia.service.js` implementa para web el mismo flujo base de mobile:
  - `product_media`
  - bucket privado `productmedia`
  - signed URLs
  - edge function `product-photo-analyzer`
- El complemento permite cargar foto, cambiar portada, eliminar y aplicar sugerencias IA al formulario del producto.
- Si la IA sugiere una categoria inexistente, `Products.vue` la crea y la selecciona en el wizard.
- `src/services/products.service.js` ahora devuelve `media_count` y `cover_image_url` para mostrar miniatura/cantidad de fotos en la lista y al refrescar el detalle del producto.
- nueva variable esperada en `.env` de web:
  - `VITE_PRODUCT_PHOTO_ANALYZER_EDGE_FUNCTION`
- cobertura agregada:
  - `src/utils/__tests__/productMediaHelpers.test.js`

### Ajustes recientes de operacion y UX (actualizado 2026-04-05)

- Calculos de venta centralizados:
  - archivos:
    - `src/utils/saleCalculator.js`
    - `src/views/PointOfSale.vue`
    - `src/services/sales.service.js`
  - cambio aplicado:
    - se creo `saleCalculator.js` como fuente canonica para subtotal por linea, normalizacion de descuentos, distribucion de descuento global, validacion de factura, resumen de totales y armado del payload de venta
    - `PointOfSale.vue` ya no mantiene calculos paralelos para esos casos; ahora consume el modulo compartido
    - `sales.service.js` valida descuentos usando la misma logica compartida antes de invocar `sp_create_sale`
  - objetivo operativo:
    - reducir duplicidad entre UI y backend-facing service
    - facilitar soporte y auditoria de diferencias en subtotales, descuentos, impuestos y total
    - asegurar que lo que se muestra en POS y lo que se guarda sigan las mismas reglas

- Sanitizacion central de errores:
  - archivos principales:
    - `src/utils/appErrors.js`
    - `src/composables/useNotification.js`
  - helpers nuevos:
    - `humanizeAppError(error, context)`
    - `serviceErrorResult(error, extra, context)`
  - comportamiento vigente:
    - normaliza mensajes tecnicos de PostgREST/SQL antes de llevarlos a la UI
    - reemplaza campos internos (`tenant_id`, `variant_id`, `location_id`, etc.) por lenguaje de negocio
    - detecta patrones frecuentes como RLS, unique constraint, foreign key, UUID invalido y schema cache
    - puede reemplazar UUIDs por etiquetas reales cuando la vista aporta contexto local (`idLabels`)
  - cobertura aplicada en esta ronda:
    - servicios: `sales.service.js`, `products.service.js`, `inventory.service.js`, `cash.service.js`, `layaway.service.js`, `tenants.service.js`
    - vistas: `PointOfSale.vue`, `Purchases.vue`, `LayawayDetail.vue`, `ProductionOrders.vue`, `TenantManagement.vue`, `Products.vue`, `CashSessions.vue`, `SuperAdminRolesMenus.vue`
  - nota operativa:
    - POS y compras ya humanizan UUIDs de variantes con nombres reales cuando esa metadata existe en memoria
    - aun puede haber modulos legacy sin migrar al sanitizador; la estrategia vigente es extender `humanizeAppError` y conectar `showMsg`/servicios por superficie de uso

- Logout corregido:
  - archivos: `src/composables/useAuth.js`, `src/services/supabase.service.js`, `src/App.vue`
  - causa detectada: el router podia seguir viendo sesion valida por cache de `supabase.service` aun despues de cerrar sesion
  - fix aplicado:
    - invalidacion explicita de cache de sesion en `signOut`
    - invalidacion tambien cuando Supabase emite `SIGNED_OUT`
    - navegacion a login con `router.replace('/login')`

- POS / descuentos reforzados:
  - archivos: `src/views/PointOfSale.vue`, `src/services/sales.service.js`
  - regla vigente:
    - el descuento de linea no puede superar el valor del producto
    - el descuento global no puede superar el valor neto de la factura
  - comportamiento implementado:
    - normalizacion inmediata de descuentos invalidos en UI
    - tope visual en inputs de descuento
    - validacion previa antes de cobrar
    - validacion de respaldo tambien en `sales.service.js`

- Ayuda contextual compacta:
  - archivo: `src/components/ContextHelpCard.vue`
  - el bloque inline invasivo fue reemplazado por un disparador compacto `Ayuda`
  - al abrir, muestra un modal/dialog responsive con guia destacada, pasos, FAQ y acceso al centro de ayuda
  - ajuste importante posterior:
    - los estilos del modal no deben depender de `.ofir-shell--dark/.light`
    - se movio el theming a clases explicitas por componente porque Vuetify teletransporta los `v-dialog` fuera del arbol del layout

- Modales y tema visual:
  - archivos:
    - `src/components/AppAlertsDialog.vue`
    - `src/views/CashSessions.vue`
    - `src/components/ContextHelpCard.vue`
  - estado vigente:
    - se agrego boton `X` visible al modal de cierre de caja
    - se corrigio la estrategia de theming para modales teletransportados
    - los modales ahora aplican clases explicitas por tema (`--dark` / `--light`) dentro del propio `v-card`
  - objetivo:
    - evitar que alertas, cierre de caja y ayuda hereden mal fondos/contraste cuando el overlay se renderiza fuera de `App.vue`

- Superadmin:
  - `src/views/SuperAdminRolesMenus.vue`
    - el panel de roles ya no debe cortar controles en cabeceras estrechas
    - se desactivo el toggle de vista especificamente en ese modulo y se dio mas ancho al panel izquierdo
  - `src/components/ListView.vue`
    - el header ahora puede envolver controles sin romper layout
  - `src/services/tenants.service.js`
    - la lista de tenants prioriza RPC `fn_superadmin_list_tenants()`
  - nueva migracion:
    - `migrations/ADD_SUPERADMIN_TENANTS_LIST_RPC.sql`
    - expone listado de tenants via `SECURITY DEFINER` para evitar vacios por RLS

- Billing multi-tenant:
  - sigue vigente la implementacion web agregada el mismo dia
  - se confirmo que las migraciones principales existen y son re-ejecutables de forma segura en terminos de objetos (`if not exists`, `create or replace`, `on conflict`)
  - orden de ejecucion recomendado en DB nueva:
    - `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`
    - `migrations/ADD_FREEMIUM_6M_TENANT_SUBSCRIPTIONS.sql`
    - `migrations/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql`
  - observacion de ambiente:
    - si ya existe la base proveniente del repo mobile, normalmente basta con la migracion de workflows web/superadmin

- RLS en consecutivos de venta:
  - error detectado al guardar venta:
    - `new row violates row-level security policy for table "sale_counters"`
  - causa:
    - `sp_create_sale()` usa `fn_next_sale_number()`
    - esa funcion escribe en `sale_counters`
    - en algunos ambientes `sale_counters` queda protegido por RLS y rompe la venta
  - fix preparado:
    - nueva migracion `migrations/FIX_SALE_COUNTERS_RLS.sql`
    - redefine `fn_next_sale_number(uuid, uuid)` como `SECURITY DEFINER`
    - valida que la sede pertenezca al tenant antes de incrementar consecutivo
  - estado:
    - este fix requiere ejecucion manual en Supabase para quedar operativo en el ambiente afectado

- Estado de build local:
  - durante esta sesion no fue posible correr `npm run build`
  - motivo: en el entorno de trabajo no hay `node` disponible
  - por tanto, la verificacion ha sido por inspeccion de codigo y consistencia funcional, no por compilacion local

### Billing multi-tenant web (implementado 2026-04-05)

- Se porto al repo web la base SQL del dominio comercial:
  - `migrations/ADD_TENANT_BILLING_MONETIZATION.sql`
  - `migrations/ADD_FREEMIUM_6M_TENANT_SUBSCRIPTIONS.sql`
- Se agrego una migracion complementaria orientada a workflows web/superadmin:
  - `migrations/ADD_TENANT_BILLING_SUPERADMIN_WORKFLOWS.sql`
- El dominio comercial queda separado de `tenant_settings` y modela:
  - catalogo de planes
  - precios por periodicidad
  - features y limites por plan
  - suscripciones por tenant
  - periodos, eventos, invoices y pagos
- Se agregaron capacidades web de datos:
  - `src/services/tenantBilling.service.js`
  - `src/composables/useTenantBilling.js`
- Nueva UI de superadmin:
  - ruta `/superadmin/billing`
  - vista `src/views/SuperAdminBilling.vue`
  - menu superadmin expuesto desde `src/App.vue`
- La vista superadmin ya permite:
  - listar y editar catalogo de planes
  - listar estado comercial por tenant
  - asignar plan/precio a un tenant
  - cambiar estado de suscripcion
  - ver historial de suscripciones
- UI tenant incorporada:
  - `src/views/TenantConfig.vue` ahora incluye tab `Suscripcion`
  - `src/views/About.vue` ahora muestra plan, estado y vigencia
  - `src/App.vue` muestra banner global cuando billing expone mensaje operativo
- Enforcement vigente:
  - `src/router/index.js` consulta billing summary y bloquea navegacion segun `can_operate_sales` y `can_operate_admin`
  - `src/services/sales.service.js` impide registrar ventas si billing no permite operar ventas
  - `src/views/TenantConfig.vue` bloquea guardar cambios administrativos cuando billing no permite operar admin
- Regla operativa vigente:
  - `/`, `/about`, `/help` y `/tenant-config` quedan como rutas seguras de consulta ante restricciones comerciales
  - POS, historial de ventas y sesiones de caja se consideran superficie de operacion comercial
  - el resto de modulos tenant se tratan como administracion para enforcement inicial
- Estado de producto:
  - ya existe visibilidad y enforcement base
  - aun no existe checkout real, webhooks, renovacion automatica ni pantalla de pago para tenant
  - los limites cuantitativos y feature flags ya se exponen en UI, pero su enforcement fino por modulo sigue siendo fase siguiente

### Onboarding operativo v2 (implementado 2026-03-18)

- El `Asistente de Configuracion Inicial` dejo de ser un checklist plano y ahora funciona como hub de procesos criticos:
  - `Vender`
  - `Comprar`
  - `Operar caja`
  - `Controlar inventario`
  - `Activar contabilidad`
- Archivos principales:
  - `src/components/SetupWizard.vue`
  - `src/composables/useSetupAssistant.js`
  - `src/views/Home.vue`
  - `src/router/index.js`
- La logica de readiness ahora esta centralizada en `useSetupAssistant`, no embebida dentro del componente.
- Cada proceso expone:
  - estado (`BLOCKED`, `IN_PROGRESS`, `READY_FOR_TEST`, `OPERATIONAL`)
  - progreso esencial
  - bloqueantes
  - siguiente mejor accion
  - prueba operativa sugerida
- El asistente evalua datos reales del tenant usando tablas ya existentes:
  - `tenant_settings`
  - `locations`
  - `cash_registers`
  - `payment_methods`
  - `products`
  - `product_variants`
  - `cash_register_assignments`
  - `sales`
  - `third_parties`
  - `purchases`
  - `stock_balances`
  - `inventory_moves`
  - `cash_sessions`
  - `accounting_accounts`
  - `accounting_entries`
- `Home.vue` ya no muestra un bloque grande del asistente:
  - ahora expone un CTA compacto `Config inicial` junto a `Nueva Venta`;
  - solo aparece si hay configuraciones esenciales pendientes;
  - muestra badge con cantidad pendiente;
  - desaparece cuando el tenant queda operativo.
- La ruta `/setup` se considera ruta siempre permitida en router para evitar bloqueo por menu dinamico durante onboarding.

### Fase siguiente del onboarding (implementado 2026-03-18)

- `useSetupAssistant.js` ahora incluye metadata de onboarding por proceso:
  - `onboardingTitle`
  - `onboardingDescription`
  - `onboardingChecklist` (especialmente en contabilidad)
- Los pasos del asistente ya pueden redirigir con contexto a tabs y rutas especificas:
  - `TenantConfig` con `query.tab`
  - `Accounting` con `query.tab`
  - `Accounting plan de cuentas` con contexto `from=setup`
- `SetupWizard.vue` ahora:
  - persiste paneles expandidos por tenant en `localStorage`
  - puede enfocar proceso via `query.process`
  - incluye bloque dedicado para onboarding contable gradual
- `TenantConfig.vue` ahora:
  - reconoce `query.tab`
  - muestra alerta de modo guiado si entra desde el asistente
  - recarga readiness despues de guardar
- `Accounting.vue` ahora:
  - muestra banda de onboarding contable con bloqueantes y CTA
  - redirige a `TenantConfig` en tab contable cuando aplica
  - recarga readiness al cargar el modulo y despues de procesar cola
- `Inventory.vue` ahora:
  - reconoce `query.tab`
  - muestra guia contextual cuando entra desde onboarding
  - explica como cargar stock por compras, operaciones o cargue masivo
- `Products.vue` ahora:
  - reconoce `query.tab`
  - reconoce `query.action=create-product`
  - muestra guia contextual para catalogo, variantes e inventario
  - puede abrir el dialogo de nuevo producto desde onboarding
- `BulkImports.vue` ahora:
  - reconoce `query.type`
  - puede abrir directo en `product_variants`
  - muestra contexto cuando entra desde onboarding de inventario

### Regla UX vigente para onboarding

- El asistente debe sentirse continuo entre modulos:
  - no solo redirigir, sino llevar al usuario al tab o subflujo correcto
  - mostrar contexto de "modo guiado" cuando entre desde onboarding
- La adopcion contable se maneja como flujo gradual y explicado:
  - activacion
  - plan de cuentas
  - automatizacion
  - validacion del primer evento/asiento

### Implicaciones de producto (vigentes)

- El onboarding ahora esta orientado a “primer resultado operativo”, no solo a “datos maestros creados”.
- En inventario el readiness debe distinguir:
  - catalogo base (`products`)
  - variantes listas para operar (`product_variants`)
  - stock real cargado (`stock_balances`)
  - movimiento validado (`inventory_moves`)
- El `Home` debe mantenerse liviano:
  - no volver a montar cards grandes del asistente en el dashboard principal;
  - el acceso recomendado es CTA compacto + redireccion a `/setup`.
- Si se agregan nuevos requisitos de arranque, deben modelarse primero en `useSetupAssistant.js` y luego reflejarse en la UI del wizard.
- Contabilidad sigue tratandose como proceso de adopcion gradual:
  - no debe bloquear POS;
  - debe mostrar prerequisitos y prueba de validacion, no solo toggles de configuracion.

### Centro de ayuda y manual de usuario (implementado 2026-03-18)

- Se creo un centro de ayuda dentro de la app:
  - ruta: `/help`
  - vista: `src/views/HelpCenter.vue`
- La base de contenido vive en:
  - `src/content/helpCenter.js`
  - `src/composables/useHelpCenter.js`
- La documentacion asociada quedo en:
  - `docs/MANUAL_USUARIO.md`
  - `docs/HELP_CENTER_SYSTEM.md`
- El centro de ayuda cubre 5 frentes de producto:
  - guia `Primeros pasos`
  - guias operativas de venta, compra, caja, inventario y contabilidad
  - FAQs de errores comunes
  - checklists interactivos con persistencia local
  - accesos directos a modulos
- UX vigente del centro de ayuda:
  - los procesos ahora usan CTA `Abrir guia`
  - al abrir una guia, el panel de contenido hace scroll automatico
  - la guia activa se marca visualmente como `Guia abierta`
  - se agregaron `FAQs rapidas` y bloque `Siguientes pasos` dentro de la vista
- Se agrego ayuda contextual reusable:
  - componente `src/components/ContextHelpCard.vue`
  - usado en `PointOfSale.vue`, `Purchases.vue`, `Inventory.vue` y `Accounting.vue`
- El acceso al centro de ayuda quedo disponible:
  - desde la barra superior
  - desde el item `Manual de usuario` del menu especial de superadmin
- La ruta `/help` se considera ruta siempre permitida para no quedar bloqueada por menus dinamicos.
- Regla UX vigente:
  - el `Home` no debe cargar tarjetas adicionales de ayuda para no sobrecargar el dashboard;
  - el contenido del manual debe concentrarse en `/help`.
- La documentacion de caja quedo reforzada:
  - la operacion de caja se documenta por `sesiones`, no solo por cajas creadas
  - cada sesion debe abrirse y cerrarse
  - existe el parametro tenant `cash_session_max_hours`
  - ese parametro define cuantas horas maximo puede estar abierta una sesion antes de marcarse como vencida
- El manual HTML legacy quedo actualizado y sincronizado:
  - fuente editable: `docs/MANUAL_USUARIO.html`
  - version publica: `public/MANUAL_USUARIO.html`
  - ahora referencia el centro de ayuda interno `/help`, el CTA `Config inicial`, el flujo de inventario por compras/movimientos/cargue masivo y la operacion de caja basada en sesiones

### Base contable implementada

- Modulo contable desacoplado del POS por cola (`accounting_event_queue`).
- Menu contable por rol y panel contable principal.
- Libro Diario y Libro Mayor con exportacion XLSX/CSV.
- Badge de pendientes en Cola POS y flujo de regreso desde reportes a Contabilidad.

### Fase 1 ampliada (operacion contador)

- Rutas directas para navegacion por menu en contabilidad:
  - `/accounting/dashboard`
  - `/accounting/compliance`
  - `/accounting/queue`
  - `/accounting/assistant`
  - `/accounting/diario`
  - `/accounting/mayor`
- Exportables adicionales:
  - Balanza (XLSX/CSV)
  - Checklist DIAN/obligaciones (XLSX/CSV)

### UX contable (actualizado)

- Nuevo modo de visualizacion compartido: `LIST` / `TABLE` con persistencia local (`localStorage`).
- Composable: `src/composables/useAccountingViewMode.js`.
- Regla UI obligatoria (centralizacion de listas):
  - Toda lista nueva o modificada en la app debe usar el componente generico `src/components/ListView.vue`.
  - En contabilidad, el modo `LIST` debe renderizarse con `<ListView>`; `TABLE` se mantiene para grillas densas.
  - No se permiten implementaciones nuevas de listas manuales con `v-list`/`v-expansion-panels`/`v-timeline` si el caso aplica a listado.
- `src/components/ListView.vue` fue ampliado para uso transversal:
  - soporta cambio entre vista `list` y `table`
  - guarda la preferencia por vista en `localStorage`
  - permite listas `server-side` y `client-side`
  - soporta columnas configurables por vista mediante `tableColumns`
  - soporta slots `table-cell-*` para personalizar celdas sin reimplementar tablas manuales
- Vistas ajustadas para doble modo:
  - `src/views/Accounting.vue`
  - `src/views/AccountingAutomation.vue`
  - `src/views/AccountingWithholdings.vue`
  - `src/views/AccountingJournal.vue`
  - `src/views/AccountingLedger.vue`
  - `src/views/AccountingClosing.vue`
- Vistas contables migradas a `<ListView>` en modo `LIST`:
  - `src/views/Accounting.vue` (balanza, asientos recientes, obligaciones, cola, lineas IA)
  - `src/views/AccountingAutomation.vue` (reglas, excepciones)
  - `src/views/AccountingWithholdings.vue` (estimacion, configuracion)
  - `src/views/AccountingJournal.vue`
  - `src/views/AccountingLedger.vue`
  - `src/views/AccountingClosing.vue`
- En modo `LIST`, las tablas densas se muestran como cards/listas para mejorar lectura, edicion y uso en pantallas reducidas.
- Mejora UX adicional en modo `LIST`:
  - Separadores visuales entre items (`v-divider`).
  - `density="compact"` para reducir altura de filas.
  - Paginacion cliente con `v-pagination` + leyenda "Mostrando X - Y de N registros".
- Modulos no contables migrados al patron comun:
  - `src/views/BulkImports.vue` (historial de importaciones)
  - `src/views/TenantManagement.vue` (lista de tenants)
  - `src/views/SuperAdminRolesMenus.vue` (roles estandar y catalogo global de menus)
  - `src/views/Cartera.vue` (cuentas de credito)
  - `src/views/CashRegisterAssignments.vue` (asignaciones caja-cajero)
  - `src/views/BatchManagement.vue` (lotes con paginacion server-side)

### Regla de producto obligatoria (listas)

- Toda funcionalidad nueva de listas en la app debe implementar `<ListView>` como componente base.
- En contabilidad esta regla es obligatoria sin excepcion para modo `LIST`.
- Cualquier vista nueva que no use `<ListView>` en listados se considera incumplimiento tecnico.

### Competitividad contable v1 (implementado)

1. Retenciones
- Tabla: `accounting_withholding_configs`
- Resumen RPC: `fn_accounting_get_withholding_summary`
- Vista: `/accounting/retenciones`

2. Cierre contable mensual
- Tabla: `accounting_period_closures`
- RPCs: `fn_accounting_close_period`, `fn_accounting_reopen_period`
- Bloqueo de posteo por periodo cerrado en `fn_accounting_post_entry`
- Vista: `/accounting/cierre`

3. Automatizacion robusta
- Tabla de reglas: `accounting_posting_rules`
- Tabla de excepciones: `accounting_automation_exceptions`
- Processor actualizado: `fn_accounting_process_queue` usa reglas dinamicas y registra excepciones
- Vista: `/accounting/automatizacion`

4. Politica estricta de periodos (uno a la vez)
- Migracion: `migrations/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql`
- Solo existe un periodo `OPEN` por tenant (indice parcial unico).
- El posteo manual (`fn_accounting_post_entry`) exige periodo `OPEN`.
- El cierre (`fn_accounting_close_period`) exige que el periodo exista y este `OPEN`.
- Apertura explicita por periodo con `fn_accounting_open_period`.
- Compatibilidad mantenida: `fn_accounting_reopen_period` delega a `fn_accounting_open_period`.

### Contabilidad producto v2 (8 puntos implementados)

1. Asientos manuales operativos
- Vista: `/accounting/asientos-manuales`
- Servicio: `getManualEntries`, `createManualEntry`, `postEntry`, `voidDraftEntry`
- Soporta creacion balanceada, posteo y anulacion controlada.

2. Plan de cuentas gestionable
- Vista: `/accounting/plan-cuentas`
- Servicio: `getChartOfAccounts`, `saveAccount`, `toggleAccountActive`
- Alta/edicion/activacion por tenant.

3. Estados financieros en modulo contable
- Vista: `/accounting/estados-financieros`
- Servicio: `getFinancialStatements`
- Estado de resultados + balance general por periodo.

4. Centro tributario unificado
- Vista: `/accounting/centro-tributario`
- Servicio: `getTaxCenterData`
- IVA, retenciones y preview de exogena por tercero.

5. Cierre contable con checklist operativo
- Vista: `/accounting/cierre` (extendida)
- Servicio: `getCloseChecklist` integrado en UI de cierre.
- Checklist previo al cierre con estados `PASS/WARN/INFO`.

6. Conciliacion caja/bancos
- Vista: `/accounting/conciliacion`
- Servicio: `getReconciliationSnapshot`
- Cruce de sesiones de caja cerradas vs saldos contables de cuentas 11*.

7. Automatizacion avanzada de reglas
- Vista: `/accounting/automatizacion` (extendida)
- Servicio: `seedAdvancedPostingRules`
- Cobertura de eventos: devoluciones ventas/compras y movimientos de caja.

8. Control interno IA de anomalias
- Vista: `/accounting/control-ia`
- Servicio: `detectAccountingAnomalies`, `requestAIAnomalyInsights`
- Deteccion estadistica + resumen de riesgo y acciones IA.

### Rutas nuevas contables (fase producto)

- `/accounting/asientos-manuales`
- `/accounting/plan-cuentas`
- `/accounting/estados-financieros`
- `/accounting/centro-tributario`
- `/accounting/conciliacion`
- `/accounting/control-ia`

### Ajustes recientes POS/menus (2026-03-12)

1. POS - lista de items de venta (desktop)
- Archivo: `src/views/PointOfSale.vue`
- Mejora: reemplazo de tabla/cards por render unificado con `<ListView>` para items del carrito.
- Estructura de cada item: encabezado (producto + variante + SKU + total) y grilla de controles (cantidad, precio, subtotal y descuento para admin).
- Resultado esperado: menos apilamiento visual, mejor lectura y edicion de lineas de venta.

2. Menu contable `Control IA` (icono)
- Se estandarizo icono a `mdi-robot-outline`.
- Migraciones relacionadas:
  - `migrations/ADD_ACCOUNTING_PHASE2_PRODUCT_MENUS.sql` (definicion corregida)
  - `migrations/FIX_ACCOUNTING_CONTROL_IA_ICON.sql` (fix para entornos ya desplegados)

### Rendimiento y cache v1 (implementado 2026-03-13)

- Nueva utilidad comun: `src/utils/queryCache.js`.
- Capas implementadas:
  - `memory` como L1 para navegacion SPA y deduplicacion en vuelo.
  - `sessionStorage` como L2 para lecturas no criticas dentro de la sesion actual.
- Dominios integrados en Fase 1:
  - Menus por usuario (`roles.service` y guard del router).
  - `tenant_settings` y datos base del tenant.
  - Ubicaciones.
  - Metodos de pago.
  - Categorias.
  - Unidades de medida.
- Reglas operativas de cache:
  - Toda clave de cache debe estar aislada por tenant cuando aplique.
  - No usar `localStorage` para datos operativos de lectura frecuente.
  - No cachear de forma persistente stock operativo, caja, alertas, credito disponible ni estados transaccionales.
- Invalidacion implementada:
  - Por mutaciones CRUD en servicios cacheados.
  - Por limpieza de tenant al cerrar sesion o expirar sesion.
  - Por cambios de menus/roles en servicios de roles y superadmin.
- Integraciones relacionadas:
  - `src/services/tenantSettings.service.js`
  - `src/services/roles.service.js`
  - `src/router/index.js`
  - `src/composables/useTheme.js`
  - `src/services/accounting.service.js`

### Rendimiento app v2 (implementado 2026-03-13)

1. Router con carga diferida de vistas
- Archivo: `src/router/index.js`
- Cambio: vistas principales convertidas a imports dinamicos.
- Efecto: reduce bundle inicial y evita cargar modulos no usados en el arranque.

2. Centro de alertas desacoplado del shell
- Archivos: `src/App.vue`, `src/components/AppAlertsDialog.vue`, `src/composables/useAppAlerts.js`
- Cambio: el dialogo pesado de alertas sale del root y se monta async solo al abrirse.
- Efecto: el shell mantiene badge + suscripcion global, pero no renderiza toda la UI de alertas en cada ruta.

3. Dashboard contable con carga por pestaña
- Archivo: `src/views/Accounting.vue`
- Cambio: `loadAll()` ya no dispara balanza, asientos, cola y compliance en paralelo para todos los tabs.
- Efecto: se carga resumen base y luego solo la data del tab activo; los tabs restantes se resuelven on-demand.

4. Agregacion de dashboard movida a backend
- Archivos: `src/services/reports.service.js`, `migrations/ADD_REPORTS_DASHBOARD_SUMMARY_RPC.sql`
- Cambio: `getDashboardSummary()` intenta primero RPC SQL agregada y deja el calculo legacy como fallback.
- Efecto: menos volumen transferido al frontend y menos agregacion JS para Home.

5. Realtime de alertas consolidado
- Archivos: `src/composables/useAppAlerts.js`, `src/views/Home.vue`
- Cambio: Home deja su suscripcion dedicada de cuentas por pagar y reutiliza el estado singleton compartido.
- Efecto: se evita duplicar eventos realtime y lecturas parciales del mismo dominio de alertas.

6. Sesion y cargas automaticas unificadas
- Archivos: `src/services/supabase.service.js`, `src/utils/sessionManager.js`, `src/router/index.js`, `src/components/ListView.vue`
- Cambio:
  - validacion de sesion centralizada con cache corta + refresh controlado;
  - guard del router y monitor de sesion reutilizan la misma capa;
  - `ListView` soporta `autoLoad=false` para listas locales/paginadas en memoria.
- Efecto: menos checks duplicados, menos requests redundantes y mas control sobre listas que no necesitan autoload.

### Politica operativa de fecha de venta POS (vigente)

- Por defecto, el POS registra la venta con la fecha/hora actual del servidor al momento de cobrar.
- La fecha manual solo puede habilitarse por tenant y solo para `ADMINISTRADOR` / `GERENTE`.
- `sales.service.js` solo envia `sold_at` cuando la funcionalidad esta habilitada y la fecha supera validaciones de UI.
- `sp_create_sale` debe validar que la fecha no sea futura y que no sea anterior a la apertura de la caja.
- La retrofecha debe permanecer restringida, auditada y con limite temporal; no debe convertirse en campo libre para todos los roles.

### Fecha manual de venta POS (implementacion 2026-03-13)

- Archivos: `src/views/PointOfSale.vue`, `src/views/TenantConfig.vue`, `src/services/sales.service.js`, `migrations/ADD_POS_MANUAL_SALE_DATETIME.sql`
- Regla funcional:
  - el selector de fecha/hora solo aparece si el tenant lo habilita;
  - ademas, solo lo pueden usar `ADMINISTRADOR` y `GERENTE`;
  - no permite fechas futuras;
  - no permite fecha/hora anterior a la apertura de la caja;
  - respeta un maximo de retrofecha configurable en horas.
- Configuracion tenant:
  - `pos_allow_manual_sale_datetime`
  - `pos_max_backdate_hours`
- Persistencia:
  - `salesService.createSale()` ya envia `p_sold_at`;
  - la migracion extiende `sp_create_sale` para propagar esa fecha efectiva a `sales`, `inventory_moves` y `sale_payments`.

### Compatibilidad transitoria de fecha manual POS (hotfix 2026-03-13)

- Archivos: `src/services/tenantSettings.service.js`, `src/services/sales.service.js`
- Problema resuelto:
  - algunos entornos aun no tienen en Supabase las columnas `pos_allow_manual_sale_datetime`, `pos_max_backdate_hours` ni el parametro RPC `p_sold_at`;
  - eso provocaba errores de schema cache al guardar configuracion o cobrar ventas.
- Solucion aplicada:
  - `tenantSettings.service.js` detecta error de esquema y reintenta con payload legacy sin esos campos;
  - `sales.service.js` detecta RPC legacy sin `p_sold_at` y reintenta la venta sin fecha manual.
- Regla operativa:
  - la app no se rompe mientras falta la migracion;
  - pero la fecha manual solo queda funcional de extremo a extremo cuando se aplica `migrations/ADD_POS_MANUAL_SALE_DATETIME.sql`.

### Pedido por chat IA POS (endurecido)

- Archivos: `src/services/chatOrderAgent.service.js`, `src/views/PointOfSale.vue`
- Cambio de estrategia:
  - parser deterministico local primero;
  - solo si el parser local no alcanza umbral suficiente, se invoca el LLM cloud;
  - el matching a catalogo ahora distingue entre `match confiable`, `sugerencia para revisar` y `sin match`.
- Regla operativa:
  - si la identificacion del item no es suficientemente confiable, no se agrega al carrito;
  - en ese caso se muestran sugerencias de productos candidatos para revision del usuario.
- Cliente sugerido:
  - solo se autoselecciona si el match del cliente es alto;
  - si no, se deja como sugerencia sin cargarlo automaticamente.
- Invalidez / refresh de cache IA:
  - el parser cloud de chat soporta `force_refresh` para saltarse cache server-side y reescribir la respuesta;
  - en POS, si una respuesta vino desde cache y no logra ningun match confiable, se reintenta una vez forzando refresh;
  - el cache IA local ahora soporta limpieza por servicio (`forecast`, `purchase`, `pricing`, etc.) ademas de limpieza total.

### Rendimiento app v3 (implementado 2026-03-13)

1. POS autocomplete y matching IA mas livianos
- Archivos: `src/services/products.service.js`, `src/views/PointOfSale.vue`
- Cambio:
  - `searchVariants()` ahora usa cache corta en memoria por termino/sede;
  - se agrego `getVariantsForChatMatching()` para construir un pool acotado de candidatos desde terminos del chat;
  - el POS deja de bajar `3500` variantes para matching IA y arma un catalogo reducido a partir del parser/texto del chat.
- Efecto:
  - menos roundtrips repetidos;
  - menos payload transferido;
  - menor costo de matching del pedido por chat.

2. Cache de impuestos por variante en POS
- Archivos: `src/services/taxes.service.js`, `src/views/PointOfSale.vue`
- Cambio:
  - `getTaxInfoForVariant()` ahora usa cache en memoria por `tenant + variant_id`;
  - invalidacion por cambios en impuestos o reglas fiscales;
  - los recalculos del carrito (`cantidad`, descuento linea/global) ahora pueden reutilizar tax info ya resuelta.
- Efecto:
  - menos RPCs repetidas durante una venta;
  - mejor respuesta en carritos con varias lineas o ajustes frecuentes.

3. Alertas con carga acotada y paginacion UI
- Archivos: `src/services/alerts.service.js`, `src/composables/useAppAlerts.js`, `src/components/AppAlertsDialog.vue`
- Cambio:
  - el servicio ya no hace `select('*')` indiscriminado;
  - la carga inicial se hace por tipo (`STOCK`, `EXPIRATION`, `LAYAWAY`, `PAYABLE`, `RECEIVABLE`) con limite operativo;
  - el composable mantiene una ventana acotada en memoria;
  - el modal de alertas pagina el render por tab.
- Efecto:
  - menos memoria usada en frontend;
  - menos trabajo reactivo y de render cuando hay muchas alertas;
  - mejor escalabilidad del centro de alertas.

4. Dashboard Home en modo RPC-only
- Archivos: `src/services/reports.service.js`, `src/views/Home.vue`
- Cambio:
  - `getDashboardSummary()` deja de usar fallback legacy y depende de `fn_reports_dashboard_summary`;
  - respuesta cacheada por corto plazo;
  - `Home.vue` maneja fallo de RPC sin romper layout.
- Efecto:
  - se elimina el camino costoso de multiples consultas + agregacion JS;
  - rendimiento mas consistente en Home.
- Nota operativa:
  - este comportamiento exige que la migracion/RPC del dashboard este desplegada en el entorno.

5. Invalidacion de dashboard al cambiar ventas
- Archivo: `src/services/sales.service.js`
- Cambio:
  - crear venta, anular venta y crear devolucion invalidan tags de `reports/dashboard-summary`.
- Efecto:
  - el cache nuevo no deja KPIs de Home desactualizados despues de operaciones comerciales.

6. Recorte de payloads en listas calientes
- Archivos: `src/services/sales.service.js`, `src/services/taxes.service.js`, `src/services/alerts.service.js`
- Cambio:
  - varias consultas que usaban `select('*')` pasaron a columnas explicitas en ventas, devoluciones, impuestos y alertas.
- Efecto:
  - menor ancho de respuesta;
  - menos datos serializados y procesados en cliente.

### UX reciente POS header (implementado 2026-03-13)

- Archivo: `src/views/PointOfSale.vue`
- Cambio:
  - se eliminaron intentos de barra flotante inferior para `Cobrar` / `Limpiar`;
  - ambas acciones quedaron en el header superior del POS junto al estado de caja;
  - layout responsive:
    - desktop: acciones en linea;
    - tablet: dos columnas para botones y estado de caja en fila separada;
    - movil pequeno: stack en una sola columna.
- Motivo:
  - evitar conflictos con scroll, scrollbar overlay y perdida visual de acciones.

## Contexto mas antiguo (resumen historico)

Este bloque conserva el contexto previo a la expansion contable, para no perder continuidad funcional del producto:

1. Base POS multi-tenant
- Aislamiento por tenant, usuarios, roles y permisos por tenant.
- Operacion principal de ventas en POS con caja/sesion.

2. Nucleo operativo previo
- Catalogo: productos, categorias, unidades de medida.
- Inventario y movimientos con ajustes y traslados.
- Compras con ingreso de inventario.
- Reportes operativos de ventas, cajas, inventario y financiero.

3. Capas de evolucion previas
- Facturacion electronica DIAN (modo dual) y configuracion de resoluciones.
- Sistema de lotes y vencimientos con logica FEFO.
- Soportes de IA en modulos operativos (ej. compra asistida / sugerencias).

4. Evolucion de seguridad y menus
- Sistema de menus por rol (plantillas y asignaciones por tenant).
- Guard de rutas basado en menus permitidos.

Nota: este resumen historico se debe mantener y actualizar en cada nuevo `CONTEXTO_ULTIMO.md`.

## Migraciones relacionadas (orden sugerido)

1. `migrations/ADD_ACCOUNTING_CO_MODULE.sql`
2. `migrations/ADD_ACCOUNTING_QUEUE_PROCESSOR.sql`
3. `migrations/FIX_ACCOUNTING_QUEUE_PROCESSOR_SERVICE_ROLE.sql`
4. `migrations/ADD_ACCOUNTING_PHASE1_REPORT_MENUS.sql`
5. `migrations/ADD_ACCOUNTING_PHASE1_OPERATIONAL_MENUS.sql`
6. `migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql`
7. `migrations/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql`
8. `migrations/ADD_ACCOUNTING_PHASE2_PRODUCT_MENUS.sql`
9. `migrations/FIX_ACCOUNTING_CONTROL_IA_ICON.sql`

## Nota operativa

Si se crea una nueva version de este contexto:
- El archivo actual deja de ser `_ULTIMO` y se guarda con fecha.
- El nuevo archivo actualizado toma el nombre `CONTEXTO_ULTIMO.md`.
