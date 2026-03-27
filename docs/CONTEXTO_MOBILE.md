# CONTEXTO_MOBILE

Fecha: 2026-03-24
Proyecto: POSLite Mobile / OfirOne
Estado: Contexto operativo consolidado para trabajo diario

## Mantenimiento del archivo

Este archivo debe actualizarse en cada modificacion relevante del proyecto mobile.

Regla de trabajo:

- toda modificacion funcional, arquitectonica o tecnica que cambie el estado real de la app debe reflejarse aqui
- si se crea, migra, elimina o cambia el alcance de un modulo, este documento debe ajustarse
- si cambia el flujo de navegacion, offline, sincronizacion, IA, tema o integraciones, este documento debe ajustarse
- este archivo debe tratarse como fuente de contexto vivo para onboarding y desarrollo diario

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
