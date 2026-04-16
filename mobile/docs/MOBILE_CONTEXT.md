# Contexto Tecnico - POSLite Mobile

Fecha: 2026-04-16  
Estado: Documento base de contexto para desarrollo diario, actualizado con la regla de backend Supabase compartido

## 0) Actualizacion reciente (2026-04-16)

- `Plan Separe` ya no queda como modulo parcial en mobile.
- La logica compartida del contrato ahora vive en `../shared/utils/layawayContract.js`.
- `mobile/src/screens/LayawayScreen.js` ahora soporta:
  - crear contrato
  - agregar productos
  - abono inicial
  - cuotas
  - expiracion/cancelacion operativa
- `mobile/src/services/layaway.service.js` refresca estado operativo con `fn_expire_due_layaways(...)` antes de listar, abrir detalle, cobrar o completar.
- Backend compartido nuevo:
  - `../shared/supabase/migrations/LAYAWAY_OPERATIONAL_HARDENING.sql`
- Regla de negocio reforzada:
  - `reserve_stock_on_layaway` ya se respeta desde backend
  - solo se libera reserva si realmente existio al crear el contrato
- Cobertura agregada:
  - `mobile/src/__tests__/layaway.service.test.js`
  - `web/src/utils/__tests__/layawayContract.test.js` como base comun de la logica compartida

## 1) Proposito

POSLite Mobile es la app React Native (Expo) para operacion de punto de venta multi-tenant, con soporte offline-first, sincronizacion diferida y consumo de backend Supabase (tablas, vistas y RPC).

## 2) Stack y dependencias clave

- React Native `0.81.x`
- Expo SDK `54`
- Supabase JS `v2`
- SQLite local (`expo-sqlite`) para cache y cola offline
- AsyncStorage para sesion de auth
- Expo Notifications para push/in-app workflow

## 3) Estructura principal de codigo

- `App.js`
  - Orquestador principal (auth, menu, navegacion, dashboard, notificaciones, modo offline).
- `src/screens/*`
  - Pantallas funcionales por modulo.
  - `src/screens/LoginScreen.js`: UI de login desacoplada.
- `src/services/*`
  - Acceso a Supabase (CRUD, vistas, RPC, edge functions).
- `src/storage/sqlite/*`
  - Persistencia local de cache y operaciones pendientes.
- `src/navigation/*`
  - Mapeo de rutas/menu y configuracion de pantallas soportadas.
- `src/lib/*`
  - Cliente Supabase, contexto de tema y utilidades transversales.
- `../shared/supabase/*`
  - Fuente canonica del backend Supabase compartido con `web`.
  - Cuando una migracion o Edge Function compartida cambie, se edita primero ahi.

## 3.1) Regla nueva de backend compartido

- El backend Supabase comun ya no debe mantenerse en paralelo dentro de `mobile/` y `web/`.
- La fuente canonica de lo compartido ahora vive en:
  - `shared/supabase/migrations`
  - `shared/supabase/functions`
- En `mobile/` se conservan rutas historicas para despliegue y referencia, pero los artefactos compartidos ahora apuntan por symlink a `shared/supabase`.
- Script operativo:
  - `scripts/sync-shared-supabase.sh link`
  - `scripts/sync-shared-supabase.sh check`
  - `scripts/sync-shared-supabase.sh sync` como fallback si el entorno no soporta bien symlinks
- Edge Functions compartidas canonizadas:
  - `create-tenant-user`
  - `chat-order-parser`
- Edge Functions que siguen siendo ownership especifico de mobile:
  - `deepseek-ocr-proxy`
  - `ops-rag-agent`
  - `product-photo-analyzer`
  - `product-photo-parser`
  - `push-dispatcher`

## 4) Flujo de inicio (bootstrap)

1. Inicializa DB local.
2. Carga cache local (`auth`, `menu`, `pending ops`).
3. Resuelve tema local (cache usuario -> tenant settings cacheado -> dark).
4. Consulta sesion Supabase.
5. Si hay sesion: hidrata perfil/roles y carga configuracion tenant.
6. Si no hay sesion y existe cache auth: habilita modo offline con contexto cacheado.

## 5) Regla de tema (fuente de verdad)

Regla activa:

1. `user theme` cacheado (`getCachedUserThemePreference`)
2. `tenant_settings.theme` cacheado
3. fallback `dark`

Notas:

- El cambio de tema se controla desde Home (`Tema local`).
- Login no tiene switch de tema adicional (evita doble fuente de control).
- El tema se restablece a `dark` solo al limpiar cache offline manualmente.

## 6) Modulos mobile implementados

- POS
- Historial de ventas
- Plan Separe
- Cartera
- Terceros
- Productos
- Categorias
- Unidades
- Carga masiva
- Inventario
- Lotes y vencimientos
- Compras (consulta/seguimiento)
- Produccion (alcance mobile actual)
- BOMs (alcance mobile actual)
- Sesiones de caja
- Cajas registradoras
- Asignaciones de caja
- Metodos de pago
- Reportes
- Setup / Empresa / Sedes / Impuestos / About

## 7) Pendientes funcionales visibles

- `TaxRules` (placeholder)
- `PricingRules` (placeholder)
- `Users` (placeholder)
- `RolesMenus` (enfoque principal web/superadmin)

## 8) Offline-first (resumen operativo)

- Cola local de operaciones (`pending_ops`) con reintentos.
- Sincronizacion periodica (`syncPendingOperations`).
- Cache de listados y catalogos criticos para continuidad operativa.
- Fallback de lectura desde cache cuando falla red/servidor.

## 9) Integraciones IA y notificaciones

- IA por Edge Functions (OCR, chat-a-venta, importacion por foto).
- Centro de notificaciones in-app + realtime.
- Push notifications registrando token por usuario/tenant.

## 10) Variables de entorno clave (sin valores)

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_CHAT_ORDER_EDGE_FUNCTION`
- `EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL`
- `EXPO_PUBLIC_DEEPSEEK_OCR_EDGE_FUNCTION`
- `EXPO_PUBLIC_DEEPSEEK_TEXT_EDGE_FUNCTION`

## 11) Deuda tecnica prioritaria

- Seguir desacoplando `App.js` por responsabilidades (shell auth/app, dashboard, notificaciones).
- Estandarizar convenciones de estructura por modulo.
- Agregar toolchain de calidad (lint/format) cuando se habilite en roadmap.

## 12) Documentos relacionados

- `docs/MOBILE_IMPLEMENTATION_CHECKLIST.md`
- `docs/MOBILE_RD_REACT_NATIVE.md`
- `docs/CORE_POS_EVOLUTION_SUMMARY.md`
