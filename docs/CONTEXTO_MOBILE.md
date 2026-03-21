# CONTEXTO_MOBILE

Fecha: 2026-03-20
Proyecto: POSLite Mobile / OfirOne
Estado: Contexto operativo consolidado para trabajo diario

## Mantenimiento del archivo

Este archivo debe actualizarse en cada modificacion relevante del proyecto mobile.

Regla de trabajo:

- toda modificacion funcional, arquitectonica o tecnica que cambie el estado real de la app debe reflejarse aqui
- si se crea, migra, elimina o cambia el alcance de un modulo, este documento debe ajustarse
- si cambia el flujo de navegacion, offline, sincronizacion, IA, tema o integraciones, este documento debe ajustarse
- este archivo debe tratarse como fuente de contexto vivo para onboarding y desarrollo diario

## Actualizacion reciente

- Se inicio una pasada transversal de ortografia y consistencia visual de textos en la app mobile.
- Se centralizaron textos reutilizables en `src/constants/uiText.js` para componentes compartidos, autenticacion y etiquetas comunes.
- `PaginatedList`, `SearchableSelectField`, `MultiSelectField` y parte del shell principal (`App.js`) ya consumen esa base comun.
- Tambien se alineo el copy visible de multiples modulos para usar mejor espanol en labels, placeholders, validaciones y estados de cache offline.

## 1. Proposito

POSLite Mobile es la app mobile de punto de venta multi-tenant construida con React Native + Expo. Su objetivo es permitir operacion comercial, administrativa y de consulta con soporte offline-first, sincronizacion diferida y consumo de backend Supabase.

La app no es un MVP pequeno: hoy cubre una parte importante del flujo operativo del negocio, incluyendo POS, inventario, terceros, cartera, cajas, reportes, configuracion e integraciones asistidas por IA.

## 2. Stack principal

- React `19.1.0`
- React Native `0.81.5`
- Expo SDK `54`
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
- push remoto para barra del sistema via Expo Push API + Edge Function `push-dispatcher` + Supabase Cron

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

## 6. Estrategia offline-first

La app ya tiene una estrategia offline real, no solo mensajes de error.

Puntos importantes:

- operaciones pendientes se encolan localmente
- existe sincronizacion diferida con reintentos y backoff exponencial
- hay lectura desde cache cuando la red o el backend fallan
- el conteo de pendientes se expone en la experiencia de usuario

Limitacion actual visible:

- el flujo de sync diferido esta claramente centrado en `CREATE_SALE`
- otras operaciones aun no muestran el mismo nivel de soporte offline

Archivo clave:

- `src/services/sync.service.js`

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
- en este proyecto, como el dispatcher envia a Expo Push API, Android tambien requiere credencial FCM V1 cargada en Expo/EAS; `google-services.json` por si solo no garantiza entrega a la barra del sistema
- la ruta de diagnostico cuando solo funciona la campanita es: permiso SO -> token en `user_push_devices` -> filas en `notification_push_queue` -> `push-dispatcher`/cron -> credenciales Expo/EAS

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

## 16. Resumen ejecutivo

POSLite Mobile ya es una app operativa amplia, con backend Supabase, base offline consistente y una capa diferencial de IA/OCR/voz. El proyecto esta avanzado funcionalmente, pero aun arrastra deuda estructural importante, especialmente por el tamano de `App.js`, la falta de tooling de calidad y la mezcla entre documentacion actualizada y documentacion historica.

La lectura correcta del estado del proyecto hoy es:

- funcionalmente: avanzado
- arquitectonicamente: util y productivo, pero tensionado
- mantenibilidad: media, con necesidad clara de modularizacion
