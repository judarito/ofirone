# Evaluación del plan maestro de mejoras — OfirOne

> Fecha: análisis sobre el código actual (rama `main`, commit `aa54ad4`).
> Documento evaluado: `docs/OFIRONE_PLAN_MEJORAS.md` (2.770 líneas).
> Método: inspección directa de código (web, mobile, shared, backend, migraciones SQL, CI, Edge Functions) + 3 auditorías delegadas (pila IA mobile, sync/offline, backend gateway/colas/imports) + ejecución local de suites (web 322 ✓, mobile 229 ✓, shared 13 ✓, backend 30 ✓ = 594 tests verdes).
> Ningún archivo del producto fue modificado por esta evaluación.

---

## 1. Veredicto ejecutivo

El plan es **estratégicamente correcto pero operativamente no ejecutable tal como está escrito**.

- **Acierta en lo esencial**: el principio rector `cache → determinístico → IA local → IA cloud → usuario`, la regla de que la IA nunca escribe movimientos críticos, el offline-first como activo estratégico y el backend gateway incremental sin reescritura coinciden con la arquitectura que el código ya construyó a medias.
- **Refleja una app real y grande**: buena parte de lo que el plan marca `[x]` es verificable en código (Command Engine por capas, telemetría, OCR native-first, SQLite + outbox, colas `async_jobs` con locking/retry/dead-letter, import engine, media processing, contratos/adapters con flags).
- **Pero como documento de trabajo tiene fallas serias**: dos secuencias de sprints con números duplicados, checkboxes desincronizados, fases redundantes, decisiones `[x]` que siguen listadas como "pendientes", y ausencia de fechas/owners/esfuerzo. Sin fuente única de verdad no se puede medir progreso.
- **El orden de ejecución tiene dependencias rotas**: Desktop MVP (Sprint 9) depende del Sync Engine (Sprint 8, incompleto) **y** de la UI Vue modularizada (Sprint 10/13), por lo que el orden recomendado no es viable tal cual.
- **Hay reclamos `[x]` que el código contradice** (ver §3.2): el más relevante es que **el costo IA estimado se emite siempre en 0** y **la confidence de venta llega null** por un bug de ruta, pese a marcarse "registrado" en Fase 0.4.1.

**Recomendación principal**: conservar el plan como *norte estratégico* (objetivos, restricciones y arquitectura objetivo son correctos) y convertirlo en ~6 epics medibles, reordenados por dependencias reales (§6), con estado en issues/backlog (no en checkboxes del .md) y aplicando el DoD del §36.

---

## 2. Perfil real de la aplicación (evidencia medida)

| Área | Dato |
|---|---|
| Web | Vue 3 + Vuetify + Supabase directo. `web/src` ~79.900 LOC: 59 vistas, 63 servicios, 14 composables, 68 rutas, 45 utils. Sin store global: `App.vue` (1.407 líneas) centraliza sesión/tema/menús/billing/alerts/i18n. |
| Mobile | React Native / Expo 54 + Supabase + `expo-sqlite` 16 + `llama.rn` + `react-native-vosk` + `expo-text-extractor`. `mobile/src` ~64.000 LOC + `App.js` 2.033 líneas. 36 pantallas, 61 servicios. |
| shared/ | Núcleo común por **rutas relativas** (no es paquete publicable). ~3.100 LOC JS (utils, contracts, jobs, media, sync) + 159 migraciones SQL (~42.500 LOC) + Edge Functions. |
| backend/ | Gateway incremental Node ≥20, HTTP nativo, monolito modular (auth, gateways, repositories, imports, media, workers). ~2.900 LOC, 30 tests verdes. **Sin Dockerfile, sin job CI, sin hosting definido → no está desplegado.** |
| Supabase | Migraciones en 3 copias (`shared/supabase` + `web/migrations` + `mobile/migrations`) con manifiestos y `scripts/sync-shared-supabase.sh` (`link|sync|check`, usado en CI). 14-18 Edge Functions por app; 13 compartidas por manifiesto (`shared-functions.txt`). |
| CI | 3 jobs: web (test+build), mobile (lint `continue-on-error` + test), shared (check). **No corre backend, no build mobile, no lint estricto.** |
| Monolitos | `mobile/src/screens/PointOfSaleScreen.js` 5.678 líneas; `PurchasesScreen.js` 3.789; `web/src/views/Purchases.vue` 3.332; `PointOfSale.vue` 2.678. |
| Duplicación | 22 servicios con el mismo basename en web y mobile; docs duplicados entre `web/docs/` (28) y `mobile/docs/` (41); `chat-order-parser` presente en shared + web + mobile. |

El perfil confirma las tres deudas estructurales que el plan identifica: **pantallas/componentes gigantes, lógica duplicada entre apps y acoplamiento directo a Supabase** desde servicios y vistas.

---

## 3. Coherencia del plan con el código

### 3.1 Reclamos `[x]` verificados como reales

| Reclamo | Evidencia |
|---|---|
| Pipeline por capas en mobile (Fases 0-8) | `commandEngine.service.js` ejecuta `cache_lookup → deterministic_parser → local_llm → (offline gate) → cloud_llm`, guarda caché por acierto y registra métricas/telemetría por capa con `fallback_chain`. El mismo patrón existe para reportes en `reportQueryEngine.service.js`. |
| Telemetría Fase 0.4.1 | Tabla `ai_telemetry_events` (`ADD_AI_TELEMETRY_EVENTS.sql`): tenant_id, user_id, device_id, feature, input_type, engine, model, resolution_source, latency_ms, confidence, tokens, estimated_cost, cache_hit, fallback, success, error, occurred_at + RLS por tenant + cola local AsyncStorage con upsert remoto. *Salvedades en §3.2 (costo=0, confidence null, sin corrección manual).* |
| Fuentes de resolución (4.2) | CHECK constraint con `local_cache / deterministic_parser / local_llm / local_ocr / cloud_llm / manual_resolution / unknown`. `local_ocr` sí se emite; `manual_resolution` nunca. |
| Dashboard IA (4.3) | `web/src/views/AIInsights.vue` + `aiTelemetry.service.js` (error rate, fuentes, errores por modelo, cloud_avoidance_rate, costo, latencias). Sin costo diario/mensual/por tenant (coincide con los `[ ]` del plan). |
| OCR native-first (Fase 1) | `ocrPolicy.service.js`: default `native-first`, offline→native-first, `scoreInvoiceOcrText`/`analyzeInvoiceOcrQuality` (too_short/too_noisy/low_score; minChars=30, maxNoise=0.55), `shouldTryCloudOcr` con razones; compresión <1 MB previa a cloud. |
| IA local (Fase 6) | llama.rn + Qwen2.5-1.5B GGUF **Q4_K_M** descargado bajo demanda con progreso y JSON forzado (`embeddedModel/embeddedLlm.service.js`); Vosk STT integrado con UI real; OCR nativo vía `expo-text-extractor`. |
| Outbox/contrato canónico (15A.2) | `shared/sync/syncContract.js` + SQLite `pending_ops` con columnas canónicas e índice único de `idempotency_key`; retry/backoff real (`retryPolicy.js` max 8, base 15 s, ×2 cap 15 min). *Salvedades en §3.2.* |
| Idempotencia de venta offline | `mobile/migrations/ADD_IDEMPOTENT_MOBILE_SALES.sql`: `mobile_sale_operations` + `sp_create_sale_idempotent` con advisory lock (dedupe real de reintentos). El plan la deja `[ ]`; para ventas ya existe. |
| Colas async (15AA) | `ADD_ASYNC_JOB_QUEUE.sql`: `async_jobs`/`async_job_attempts`, estados `pending/processing/waiting_retry/completed(+warnings)/failed/dead_letter`, `dedupe_key` con índice único parcial, claim `FOR UPDATE SKIP LOCKED`, retry con backoff, dead-letter, grants service_role. Worker en `backend/src/worker.js`. |
| Import Engine / media | `backend/src/imports/*` (parser CSV/XLSX con topes, preview de errores en `bulk_import_errors`, apply de productos/variantes con stock inicial y de terceros vía `fn_upsert_third_party`); `backend/src/media/*` (OCR factura con `deepseek-ocr-proxy`; foto producto con `product-photo-parser`); drafts persistidos en `async_jobs.result`; UI encola con flags y muestra historial. |
| Contratos/adapters piloto (Sprint 4/5) | `shared/contracts/lookupsRepository.js` (`createLookupsRepositoryAdapter` primary/fallback/flag), `web/src/services/lookups.service.js` con `VITE_USE_BACKEND_LOOKUPS`, adapters `supabaseLookups`/`backendLookups`; `gatewayErrors.js` (code/domain/operation/correlationId/retryable/status); `ai.gateway.js`/`import.gateway.js` con allowlist en backend. |

### 3.2 Reclamos `[x]` que el código contradice o matiza

| Reclamo | Realidad (evidencia) |
|---|---|
| "costo estimado" registrado (4.1 `[x]`) | El emisor mobile fija `estimated_cost: 0` (`telemetry.service.js:48`); los agentes no calculan costo ni usage real (tokens = `len/4`). **No se mide costo IA, ni siquiera estimado.** |
| "confidence" registrada (4.1 `[x]`) | Para `command_engine_sale` llega **null**: la confianza vive en `order.confidence` (parser) pero la telemetría lee `intent.confidence ?? result.confidence` (`telemetry.service.js:11-17`). Solo los reportes registran confidence. |
| "Medir % imágenes que requieren cloud" (5.1 `[x]`) | Hay evento con razón de fallback, pero no existe métrica/KPI agregado del porcentaje. |
| "Implementar auto" OCR (5.1 `[x]`) | `auto` no tiene lógica diferencial vs `native-first` en código. |
| Diagrama OCR local-first (Fase 1) | En el flujo de **Compras**, el texto OCR nativo aún se estructura con LLM cloud (`analyzeInvoiceWithText`); solo POS es local-first completo. |
| Mejorar CI/CD / observabilidad / cobertura (objetivos `[x]`) | CI no compila backend ni mobile; lint mobile con `continue-on-error`; sin tests RLS/cross-tenant; sin métricas productivas de RPC/colas/realtime. Las propias Fases 16/17/19 quedan `[ ]`. |
| "Gateway lógico único cloud" (11.1) | Web y mobile siguen invocando Edge Functions directo (`supabase.functions.invoke`). El backend `/ai/functions/*` existe y está probado, pero **no tiene consumidor front**. El LLM cloud de **reportes** además no pasa el gate de billing (sí lo pasa venta/OCR). |
| Límites/cuotas IA por tenant (7.3, 11.3) | No existen presupuestos ni rate-limit ni cuotas diarias/mensuales; solo gating por *feature de plan* (`shared/utils/billingAccess.js` + `ensureTenantBillingFeature`) y topes de payload/max_tokens. |
| Estados outbox `conflict/dead_letter` "ejecutados" (15A.2 `[x]`) | En runtime `pending_ops` usa estados legacy `PENDING/PROCESSING/DONE/FAILED`; `conflict/dead_letter` son solo constantes en `syncContract.js`; dead-letter real = etiqueta `NO_RETRY` sobre `FAILED`. `error_code` está en el schema pero **nunca se escribe**. Índice único sin `ON CONFLICT` (el duplicado revienta el constraint). |
| Estructura `shared/sync/{core,queue,conflict,transport,mapping,idempotency,policies}` (15A.1) | No existe: `shared/sync/` solo tiene `syncContract.js`, `retryPolicy.js` y tests. |
| Media processing "encolable" (19AB.2 `[x]`) | El endpoint acepta 6 tipos, pero **solo 2 tienen worker** (`purchase_invoice_photo`, `product_catalog_photo`); los otros 4 tipos encolados terminan en `dead_letter` (`mediaJobHandlers.js`). Las colas `ai_jobs` y `report_jobs` están en `workerQueues` por default pero sus handlers **lanzan error (stub)** → dead-letter. |
| Import/media con flag activo | Los 3 flags `VITE_USE_BACKEND_*` existen pero **web/.env no define ninguno** → en runtime todo cae al camino directo Supabase/legacy. El "fallback" de imports/media no es un adapter conmutado: es lógica legacy duplicada en cliente. |
| Estados de import (19AB) | `bulk_imports` usa `pending/processing/completed/completed_with_errors/failed` (fase en `summary.phase`), no la lista del plan; el worker nunca emite `completed_with_errors`. |
| Fase 6.3/15C gestión del modelo | Descarga bajo demanda sí; **sin checksum, sin eliminar modelo, sin Wi-Fi-only, sin LOW/MID/HIGH** (`device.service.js` no expone tiers). |
| Feedback / aliases / caché normalizada / retrieval (Fases 3, 4, 5, 9, 10) | **No implementado**: no existe tabla `alias` en SQL ni código; `manual_resolution` jamás se emite; caché = hash exacto del texto normalizado (no canónica ni por intent); sin retrieval Top-K local; sin dataset de regresión. |
| Seguridad multi-tenant (Fase 18) | Auditorías en markdown y varias migraciones RLS; **34 migraciones usan `SECURITY DEFINER`** (por auditar); sin tests automáticos cross-tenant en CI. |
| Feature flags (Fase 23) | Solo flags por build/env; sin flags por tenant/plan/porcentaje ni kill switch. |

### 3.3 Arquitectura IA real (línea base honesta)

```
mobile/src/services/commandEngine/commandEngine.service.js  (+ reportQueryEngine.service.js)
  text → normalizeCommandText → hash(tenant+inputType+catalogFingerprint)
   ├─ local_cache   (TTL 7 d; voz/OCR comparten entrada forzando inputType 'text' → cache cross-input)   HIT → resultado
   ├─ deterministic_parser  (sintaxis: cantidades/unidades/notas/cliente, confidence heurística 0.58-0.93; NO produce product_id)
   ├─ local_llm     (embedded llama.rn Qwen2.5-1.5B Q4_K_M, o endpoint Ollama; JSON forzado)
   ├─ offlineMode   → error "Sin conexión…" (NO existe "¿cloud permitido? → confirmación usuario")
   └─ cloud_llm     → Edge Function chat-order-parser (venta, con gate billing AI_ASSISTANT) / deepseek-proxy (reportes, SIN gate)
Telemetría por capa: metrics.service.js + telemetry.service.js → ai_telemetry_events (pero estimated_cost=0, confidence=null en venta)
OCR: ocrPolicy (native-first) → expo-text-extractor → si insuficiente → deepseek-ocr-proxy (compresión <1 MB previa)
STT: Vosk (vosk-model-small-es-0.42) → command engine (inputType voice)
```

Puntos ciegos frente al objetivo del propio plan (§3 del doc):
1. **No existe la confirmación de usuario antes de cloud** en el motor (solo `offlineMode`). El cloud de reportes ni siquiera tiene gate de plan.
2. El parser no matchea a `product_id`; el matcheo contra catálogo ocurre después, fuera del motor. No hay "caché por intent" ejecutable al nivel del motor.
3. Sin aliases, textos equivalentes ("coca grande" vs "coca 1.5L") jamás comparten caché ni resuelven sin cloud/LLM.
4. Sin corrección manual registrada no hay dataset de regresión ni aprendizaje (Fases 9-10).
5. Vosk: modelo en `mobile/assets` pero **no copiado a los assets nativos de Android** y sin config-plugin → riesgo real de que el STT falle en APK de release; además solo Android/dev-client (no Expo Go).

### 3.4 Sync/offline real (Fases 15/15A/19F)

- **SQLite real** (`expo-sqlite`, DB `poslite_mobile.db`): `pending_ops` (outbox), `sync_state` (KV), `auth_cache`, `menu_cache` y **5 tablas draft sin uso** (`local_sales_draft`, líneas, pagos, cartera, proveedores — se crean y se borran, ningún código las escribe/lee).
- **Venta offline implementada (solo ventas)**: encolado con contrato canónico + puente legacy; retry/backoff; crash-recovery mínimo (`resetStuckProcessingOps`); UI con chip online/offline, modal de cola (reintentar/descartar/bloqueadas) y ventas pendientes en historial. El stock **no se valida offline** (overselling lo rechaza el servidor al sincronizar); los pagos viajan dentro del payload de la venta.
- **Push**: un solo handler `CREATE_SALE` → `sp_create_sale_idempotent`. **Pull incremental: NO** — no hay checkpoint/cursor operativo; el "pull" es **redescarga de snapshots completos** (`warmPosCatalog` limit 2000, clientes 5000, pricing) al entrar a POS, al reconectar y cada 5 min. Realtime solo para alertas/notificaciones/pedidos.
- **Conflictos: NO** (LWW implícito del servidor); **catálogo local persistente: NO** (productos se consultan en vivo); **multi-dispositivo/revocación: NO**.
- La infra `async_jobs` con cola `sync_outbox` existe, pero el sync mobile **no la usa** (RPC directo) y el worker Node lanza error para `sync_outbox`.

---

## 4. Problemas internos del documento

### 4.1 Dos secuencias de sprints con números duplicados (§35, líneas 2488-2663)
Existen dos líneas de ejecución pegadas sin distinguir: Sprint 1-11 (2488-2610: control de costos → determinístico → IA local → contratos → backend → colas → imports → Sync → Desktop MVP → Modularización → Calidad) y Sprint 8-13 (2611-2663: Operación SaaS → Desktop avanzado → Optimización → Expansión offline → Hardening → Arquitectura). "Sprint 8", "9", "10" y "11" aparecen **dos veces** con contenido distinto, y "Sprint 13 — Arquitectura" repite casi literalmente "Sprint 10 — Modularización UI" (App.js, App.vue, consolidar shared, README, Architecture). Imposible trackear progreso con identificadores duplicados.

### 4.2 Checkboxes desincronizados entre fases y sprints
- Sprint 1 deja `[ ]` "Telemetría IA / Dashboard / OCR native-first / CAR / CI" cuando Fases 0, 1 y CI ya los marcan `[x]`.
- Sprint 4/5 marcan todo `[x]` mientras §18A.6 "Decisiones pendientes" sigue `[ ]` en hosting, sesiones/JWT, estándar de errores, versionado API, destino de Edge Functions y monolito modular — decisiones ya tomadas en la práctica (runtime Node 20, monolito modular, `OfironeGatewayError`, correlation_id) o genuinamente abiertas (hosting, destino EF).
- No existe símbolo para "parcial", que es el estado real de la mayoría de los ítems grandes.

### 4.3 Fases redundantes y numeración confusa
- Fase 15 (§19.2/19.3 cola offline + conflictos) queda duplicada por Fase 15A (§19A.2/19A.9). Riesgo de divergencia al editar solo una.
- 15E "MVP Desktop" re-enuncia 15B; 15F "MVP Sync Engine" re-enuncia 15A; ~150 líneas de checklist repetido sin indicar qué queda fuera del MVP.
- Los títulos 19AA/19AB (Fases 15AA/15AB) cuelgan como subsecciones de la sección 19 pero son fases hermanas de 15A-15F: la jerarquía de encabezados no refleja la conceptual.
- §35-38 no son fases pero comparten numeración; "objetivo final" (§37) y "objetivo estratégico" (§38) duplican parcialmente los objetivos globales (§1).

### 4.4 Huecos de contenido
1. **No hay hosting/despliegue definido para el backend gateway** (sin Dockerfile, sin job CI, sin URL productiva) y los flags que activan su uso están apagados en runtime → todo el valor de Fase 14A es latente.
2. **Sin plan de arranque mobile**: `App.js` (2.033 líneas, 69 imports) precarga catálogo/ventas/cajas y hace `warmEmbeddedModelInBackground`.
3. **Sin fecha objetivo para los KPI centrales** (CAR ≥80/90/95%, costo/1.000 ops) ni dueño del dato.
4. Sin estimación de esfuerzo, duración de sprints ni ownership por fase.
5. El backend expone el estándar de errores solo internamente: **el payload HTTP omite `domain/operation/retryable/status`** y no hay rate limiting ni límite de body en el server HTTP.

---

## 5. Evaluación por foco estratégico

### 5.1 Eje IA local-first (Fases 0-10, 28-30)
Lo más maduro. La deuda real no es arquitectura sino **bucle de aprendizaje y medición**: (a) costo estimado siempre 0 → sin esto no hay KPI de ahorro; (b) confidence de venta null (bug de ruta); (c) sin registro de corrección manual; (d) sin aliases; (e) sin caché canónica; (f) sin retrieval Top-K; (g) sin dataset de regresión. Sin esos puntos el CAR no sube de forma demostrable. El plan los lista pero no los trata como bloque prioritario con fecha.

### 5.2 Eje offline/sync (Fases 15-15F)
El cuello de botella real. La promesa "sigue vendiendo aunque Internet se caiga" hoy cubre **solo ventas offline con outbox**; no hay catálogo local persistente, pull incremental, conflictos ni multi-dispositivo. El plan lo sabe, pero lo ubica sin marcar que **bloquea al Desktop** y a la oferta comercial completa.

### 5.3 Eje backend gateway + colas + import/media (14A, 15AA, 15AB)
Lo más ejecutado y de mejor calidad (contratos, locking, retry, dead-letter, allowlists, tests). Pendientes operativos: hosting y despliegue; extender contratos a ventas/pagos/inventario/cartera; **consumir los drafts de media/import desde la UI** (hoy quedan en `async_jobs.result`); resolver los stubs (4/6 media types, `ai_jobs`, `report_jobs`); completar payload de error HTTP, rate limiting y límites de body; sustituir/aislar `xlsx@0.18.5` (vulnerabilidad alta, reconocida en el propio plan).

### 5.4 Eje UI / modularización (Fases 11-13, 25)
Las pantallas de 3.000-5.700 líneas y los 22 servicios duplicados encarecen todo lo demás. El plan pone la modularización **después** del Desktop MVP que promete "reutilizar la UI Vue": orden invertido (ver §6).

### 5.5 Eje SaaS / multi-tenant / costo (Fases 18, 22, 23, 27-30)
Corazón del objetivo #1 sin enforcement. Existe gating por feature de plan (web y mobile) y telemetría con columna de costo, pero sin presupuestos por tenant, sin modo ahorro (`local_only/economy/balanced/quality`), sin alertas 50/75/90/100%, sin flags por plan. El riesgo de subsidio ilimitado de Fase 28 es real: hoy ninguna operación cloud tiene tope de gasto por tenant.

---

## 6. Recomendación: reordenamiento en 6 tracks

1. **Medir para decidir (ahora)** — corregir costo estimado y confidence en telemetría; agregar corrección manual y su consumo; dashboard de costo diario/mensual/por tenant; definir CAR con fórmula auditable; arrancar dataset de regresión. Barato y desbloquea el resto.
2. **Controles de costo IA por tenant** — presupuesto soft/hard, modo ahorro y alertas en Edge Functions/gateway, antes de escalar clientes.
3. **Sync Engine completo** — pull incremental con checkpoint, catálogo local, conflictos por entidad, estado visible, dead-letter real, multi-dispositivo y tests de desconexión. *Bloquea Desktop y la promesa offline.*
4. **Modularización + contratos por dominio (web primero)** — shell/layout; extraer `App.vue` y pantallas gigantes; extender repos/adapters a ventas/pagos/inventario/cartera/sync. *Prerrequisito del Desktop reutilizable.*
5. **Desktop MVP** — solo con 3 y 4 parcialmente listos (scope de 15E).
6. **SaaS/seguridad/hardening** — auditoría RLS + SECURITY DEFINER automatizada, tests cross-tenant en CI, CI de backend y build mobile, flags por plan, cost center, limpieza de duplicación y docs (trabajo continuo).

Regla para el documento: una sola secuencia de sprints numerados de forma única; estado movido a issues (etiqueta por fase); símbolo para "parcial"; MVP con alcance explícito de exclusiones.

---

## Anexo A — Resumen de las auditorías delegadas

### A.1 Pila IA mobile (verificación archivo:línea)
- **Implementado**: pipeline por capas doble (venta y reportes); caché por tenant+input+fingerprint con cross-input; parser determinístico de venta y reportes con confidence calculada (0.58-0.93 venta); LLM local embedded (llama.rn, Qwen 1.5B Q4_K_M, JSON forzado, descarga bajo demanda con progreso); OCR native-first con policy/thresholds; telemetría con ~15 de 17 campos; Vosk activo con UI (pero riesgo de empaquetado Android). Tests: `deterministicParser`, `ocrPolicy`, telemetry bridges.
- **Parcial**: checksum/eliminación del modelo; modo OCR `auto`; métrica % cloud; envío remoto de telemetría sin replay; sin tests del pipeline/LLM local/OCR/STT; en Compras el OCR nativo aún se estructura por LLM cloud.
- **No implementado**: corrección manual/feedback (Fase 9); aliases por tenant (Fase 3); thresholds de confidence como gate; intents quitar/modificar/vaciar; normalización semántica (plurales/homófonos); gate "¿cloud permitido?" con cuotas; router de modelos; límites IA por tenant.

### A.2 Sync/offline (verificación archivo:línea)
- SQLite nativo real; outbox `pending_ops` legacy con columnas canónicas; índice único de idempotency sin `ON CONFLICT`; retry/backoff aplicado (`sync.service.js`, `retryPolicy.js`); push solo `CREATE_SALE` con `sp_create_sale_idempotent`; venta offline con contrato canónico + puente; sin pull incremental (snapshots completos: catálogo 2.000, clientes 5.000, pricing); sin catálogo local; sin conflictos (LWW); 5 tablas draft muertas; UI con chip online/offline, modal de cola y ventas pendientes; falta "última sync" global y contador de conflictos.
- **Tests**: solo contrato/retry/puente; faltan estados del outbox, duplicados, crash/reconexión, conflictos, multi-dispositivo.

### A.3 Backend gateway / colas / imports / media (verificación archivo:línea)
- Rutas reales: `/health`, `/lookups/*`, `/async-jobs` (POST, backlog, history), `/media-processing/jobs`, `/ai/functions/*`, `/imports/functions/*`; JWT validado contra Supabase `/auth/v1/user`; headers `x-correlation-id`, `x-response-time-ms`; allowlists en gateways AI/import con 403.
- Colas: contrato↔tabla↔funciones↔worker↔API consistentes; dedupe, `SKIP LOCKED`, retry con backoff, dead-letter; handlers reales solo para import (3) y media (2); `ai_jobs`/`report_jobs` y 4/6 tipos media = **stub → dead-letter**.
- Import: flujo preview→confirmación→apply real para productos/variantes (con stock inicial) y terceros; headers peligrosos bloqueados; topes `IMPORT_MAX_FILE_BYTES/ROWS`; `xlsx@0.18.5` sigue en uso (backend y web).
- Media: drafts en `async_jobs.result` **sin consumidor UI**; el worker envía la imagen original a la EF (no optimiza local, la ruta legacy web sí).
- Flags: 3 (`LOOKUPS`, `IMPORT_JOBS`, `MEDIA_JOBS`), default `false`, sin valor en `web/.env` → runtime = Supabase directo/legacy. Fallback solo con patrón adapter para lookups; en imports/media el fallback es lógica duplicada.
- Carencias: payload de error HTTP incompleto, sin rate limiting ni límite de body; `GET /async-jobs/backlog` sin consumidor UI; sin orden validado de migraciones (solo manifiesto).

*Todas las suites ejecutadas localmente pasan: web 322, mobile 229, shared 13, backend 30.*
