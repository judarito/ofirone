# Plan maestro de mejoras — OfirOne

> Objetivo: evolucionar OfirOne hacia una plataforma SaaS POS/ERP sostenible, segura, modular, offline-first y con un uso de IA optimizado por costo.
>
> Principio rector en mobile:
>
> **Cache → Determinístico → IA local → IA cloud → intervención del usuario**
>
> La IA cloud debe ser siempre el último recurso, no el camino predeterminado.
>
> **Convención de estado usada en este documento** (revisión de auditoría 2026, ver `docs/EVALUACION_PLAN_MEJORAS.md`):
>
> - `[x]` = implementado y verificado en código.
> - `[~]` = parcial / implementado con salvedades (leer la nota asociada).
> - `[ ]` = pendiente.
>
> **Fuente de verdad de ejecución**: la hoja de ruta única de la sección 35 (sprints con números únicos y puertas de dependencia). Las fases 0-34 son el backlog detallado por feature.

---

# 1. Objetivos globales

- [ ] Reducir el costo mensual de IA cloud.
- [ ] Aumentar el porcentaje de operaciones resueltas sin cloud.
- [ ] Mantener capacidades offline en mobile.
- [ ] Modularizar web y mobile por dominio.
- [ ] Consolidar `shared/` como núcleo común del producto.
- [ ] Crear backend gateway gradual para reducir acoplamiento a Supabase.
- [ ] Introducir colas para procesos asíncronos críticos.
- [ ] Crear motor de importaciones para Excel, CSV y fotos.
- [x] Mejorar CI/CD.
- [x] Mejorar observabilidad.
- [x] Aumentar cobertura de pruebas.
- [ ] Fortalecer seguridad multi-tenant.
- [ ] Reducir duplicación técnica.
- [ ] Mejorar documentación.
- [ ] Preparar OfirOne para crecimiento SaaS sin introducir microservicios innecesarios.

---

# 2. KPI principales

## 2.1 IA

- [x] Implementar `Cloud Avoidance Rate`.

```text
operaciones resueltas sin cloud
────────────────────────────── × 100
operaciones inteligentes totales
```

Objetivos:

- [ ] Primera meta: `>= 80%`.
- [ ] Segunda meta: `>= 90%`.
- [ ] POS rutinario: aspirar a `>= 95%`.

## 2.2 Costos

- [x] Medir costo IA por tenant.
- [ ] Medir costo IA por usuario.
- [x] Medir costo IA por función.
- [ ] Medir costo IA por venta.
- [ ] Medir costo IA por 1.000 operaciones.
- [x] Medir tokens promedio de entrada.
- [x] Medir tokens promedio de salida.
- [ ] Medir costo promedio por inferencia cloud.
- [ ] Medir ahorro estimado generado por cache.
- [ ] Medir ahorro estimado generado por parser determinístico.
- [ ] Medir ahorro estimado generado por IA local.

## 2.3 Calidad

- [ ] Precisión del parser determinístico.
- [ ] Precisión del LLM local.
- [ ] Precisión del LLM cloud.
- [ ] Tasa de corrección manual.
- [ ] Latencia p50.
- [ ] Latencia p95.
- [ ] Errores por motor.
- [ ] Fallbacks entre capas.

---

# 3. Arquitectura objetivo de IA mobile

```text
Entrada
   │
   ▼
Normalización
   │
   ▼
Cache local
   │
   ├── HIT ───────────────► Resultado
   │
   ▼
Motor determinístico
   │
   ├── confianza alta ────► Resultado
   │
   ▼
IA local
   │
   ├── confianza alta ────► Resultado
   │
   ▼
¿Cloud permitido?
   │
   ├── NO ────────────────► Confirmación usuario
   │
   ▼
IA cloud
   │
   ▼
Validación determinística
   │
   ▼
Resultado
```

Regla obligatoria:

- [ ] Ninguna IA puede escribir directamente movimientos críticos.
- [ ] La IA debe producir datos estructurados.
- [ ] Toda salida IA debe pasar por validación determinística.
- [ ] Stock, impuestos, precios, permisos y movimientos contables deben seguir siendo determinísticos.

Pipeline crítico:

```text
IA
 ↓
JSON estructurado
 ↓
Validador
 ↓
Reglas de negocio
 ↓
Servicio
 ↓
Base de datos
```

---

# 4. Fase 0 — Baseline y observabilidad de IA

**Prioridad: crítica**

## 4.1 Telemetría

Registrar por inferencia:

- [x] `tenant_id`.
- [x] `user_id`.
- [x] `device_id`.
- [x] funcionalidad.
- [x] tipo de entrada.
- [x] motor.
- [x] modelo.
- [x] capa que resolvió.
- [x] latencia.
- [~] confidence (en eventos de venta llega `null` por ruta de lectura; corregir en Sprint 1).
- [~] tokens input (estimación por caracteres, no `usage` real).
- [~] tokens output (estimación por caracteres, no `usage` real).
- [~] costo estimado (los emisores mobile registran `0`; corregir en Sprint 1).
- [x] cache hit/miss.
- [x] fallback utilizado.
- [x] error.
- [ ] corrección manual posterior.
- [x] timestamp.

## 4.2 Fuentes de resolución

Normalizar valores:

- [x] `local_cache`.
- [x] `deterministic_parser`.
- [x] `local_llm`.
- [x] `local_ocr`.
- [x] `cloud_llm`.
- [x] `manual_resolution`.

## 4.3 Dashboard

- [x] Crear dashboard interno de uso IA.
- [x] Mostrar Cloud Avoidance Rate.
- [ ] Mostrar costo diario.
- [ ] Mostrar costo mensual.
- [ ] Mostrar costo por tenant.
- [x] Mostrar top funcionalidades consumidoras.
- [ ] Mostrar top tenants consumidores.
- [x] Mostrar porcentaje por fuente de resolución.
- [x] Mostrar latencia p95 por fuente.
- [x] Mostrar errores por modelo.

---

# 5. Fase 1 — Corregir OCR para priorizar ahorro

**Prioridad: crítica**

Actualmente el objetivo debe ser:

```text
Foto
 ↓
Preprocesamiento local
 ↓
OCR local
 ↓
Parser determinístico
 ↓
IA local
 ↓
OCR/IA cloud
```

## 5.1 Política OCR

- [x] Cambiar default a `native-first`.
- [x] Mantener `cloud-first` solo para diagnóstico.
- [~] Implementar `auto` (hoy equivale a `native-first`; sin lógica diferencial).
- [x] Definir threshold mínimo de OCR.
- [x] Ejecutar cloud solo si OCR local es insuficiente.
- [x] Registrar motivo del fallback a cloud.
- [~] Medir porcentaje de imágenes que requieren cloud (existen eventos con motivo de fallback; falta el KPI agregado).

## 5.2 Preprocesamiento local

- [ ] Auto-crop.
- [ ] Deskew.
- [ ] Corrección de perspectiva.
- [ ] Grayscale.
- [ ] Contraste.
- [ ] Binarización.
- [ ] Sharpening.
- [ ] Reducción de ruido.
- [ ] Corrección de orientación.
- [x] Compresión antes de cualquier envío cloud.

## 5.3 Calidad

- [x] Confidence OCR global.
- [ ] Confidence por línea.
- [x] Detectar texto insuficiente.
- [x] Detectar OCR con demasiado ruido.
- [x] Evitar inferencia IA cuando no hay contenido útil.

---

# 6. Fase 2 — Fortalecer parser determinístico

**Prioridad: crítica**

El parser determinístico debe resolver la mayor parte de las operaciones comunes.

## 6.1 Casos mínimos

- [ ] Cantidades.
- [ ] Producto.
- [ ] SKU.
- [ ] Código de barras.
- [ ] Variantes.
- [ ] Tallas.
- [ ] Colores.
- [ ] Unidades.
- [ ] Marcas.
- [ ] Cliente.
- [ ] Agregar producto.
- [ ] Quitar producto.
- [ ] Modificar cantidad.
- [ ] Reemplazar producto.
- [ ] Vaciar carrito.
- [ ] Notas.

## 6.2 Normalización

- [ ] Singular/plural.
- [ ] Números escritos.
- [ ] Abreviaciones.
- [ ] Acentos.
- [ ] Puntuación.
- [ ] Espacios.
- [ ] Errores ortográficos comunes.
- [ ] Homófonos frecuentes de STT.
- [ ] Variantes regionales de nombres.

## 6.3 Confidence

- [ ] Definir confidence determinístico.
- [ ] No escalar a LLM cuando confidence sea alto.
- [ ] Definir threshold por tipo de comando.
- [ ] Definir threshold por vertical.
- [ ] Registrar falsos positivos.
- [ ] Registrar falsos negativos.

---

# 7. Fase 3 — Diccionario inteligente por tenant

**Prioridad: alta**

## 7.1 Alias

Crear entidad equivalente a:

```text
tenant_product_alias
```

Campos sugeridos:

- [ ] `tenant_id`.
- [ ] `product_id`.
- [ ] `alias`.
- [ ] `normalized_alias`.
- [ ] `source`.
- [ ] `confidence`.
- [ ] `usage_count`.
- [ ] `last_used_at`.
- [ ] `active`.

## 7.2 Aprendizaje

- [ ] Aprender alias tras corrección explícita.
- [ ] No aprender automáticamente sin validación.
- [ ] Priorizar alias usados frecuentemente.
- [ ] Permitir eliminar alias erróneos.
- [ ] Sincronizar aliases relevantes entre dispositivos.

Ejemplo:

```text
"coca grande"
→ Coca-Cola 1.5L
```

Debe resolverse sin IA después de ser aprendido.

---

# 8. Fase 4 — Cache inteligente

**Prioridad: crítica**

## 8.1 Cache exacta

- [ ] Mantener hash exacto.

## 8.2 Cache normalizada

Normalizar:

```text
"dos coca colas"
"2 coca-cola"
"2 cocas"
```

hacia una representación común.

- [ ] Implementar canonical text.
- [ ] Ignorar diferencias irrelevantes.
- [ ] Incorporar tenant.
- [ ] Incorporar fingerprint de catálogo.
- [ ] Invalidar cuando el catálogo relevante cambie.

## 8.3 Cache por intent

Guardar estructura:

```json
{
  "intent": "add_product",
  "product_id": "...",
  "quantity": 2
}
```

- [ ] Separar interpretación de ejecución.
- [ ] Revalidar producto antes de ejecutar.
- [ ] Revalidar stock.
- [ ] Revalidar precio.
- [ ] Revalidar permisos.

## 8.4 Cache multimodal

- [ ] Compartir cache entre texto.
- [ ] Compartir cache entre voz.
- [ ] Compartir cache entre OCR.
- [ ] Convertir todas las entradas a canonical command.

---

# 9. Fase 5 — Retrieval local antes del LLM

**Prioridad: alta**

Nunca enviar catálogo completo al modelo.

Pipeline:

```text
texto
 ↓
normalización
 ↓
búsqueda local
 ↓
top candidatos
 ↓
LLM local
```

## Acciones

- [ ] Crear índice local de productos.
- [ ] Buscar por nombre.
- [ ] Buscar por alias.
- [ ] Buscar por SKU.
- [ ] Buscar por marca.
- [ ] Buscar por variante.
- [ ] Buscar por categoría.
- [ ] Limitar candidatos a Top-K.
- [ ] Configurar K dinámico.
- [ ] Medir precisión según K.

Objetivo:

- [ ] Mantener contexto local pequeño.
- [ ] Mejorar velocidad.
- [ ] Reducir RAM.
- [ ] Reducir tokens en fallback cloud.

---

# 10. Fase 6 — IA local optimizada

**Prioridad: alta**

## 10.1 Responsabilidades correctas

IA local sí debe:

- [ ] Interpretar lenguaje flexible.
- [ ] Detectar intención.
- [ ] Resolver frases ambiguas.
- [ ] Convertir texto a JSON.
- [ ] Ayudar con matching entre pocos candidatos.

IA local no debe:

- [ ] Calcular impuestos.
- [ ] Determinar stock real.
- [ ] Decidir permisos.
- [ ] Escribir contabilidad.
- [ ] Modificar directamente DB.
- [ ] Buscar catálogo completo.

## 10.2 Modelos según dispositivo

Clasificar:

- [ ] `LOW`.
- [ ] `MID`.
- [ ] `HIGH`.

LOW:

- [ ] Parser determinístico.
- [ ] Cache.
- [ ] Modelo pequeño opcional.
- [ ] Cloud cuando sea necesario.

MID:

- [ ] Modelo ~1B–2B cuantizado.

HIGH:

- [ ] Modelo superior solo si mejora métricas.

## 10.3 Gestión del modelo

- [ ] Descarga bajo demanda.
- [ ] Mostrar tamaño.
- [ ] Permitir eliminar modelo.
- [ ] Verificar checksum.
- [ ] Versionar modelo.
- [ ] Rollback.
- [ ] Descargar solo por Wi-Fi opcionalmente.
- [ ] No actualizar modelos durante operación POS.

---

# 11. Fase 7 — IA cloud como último recurso

**Prioridad: crítica**

## 11.1 Gateway lógico

Centralizar toda inferencia cloud.

- [ ] Un único servicio cloud AI.
- [ ] No permitir llamadas directas desde pantallas.
- [ ] No exponer API keys.
- [ ] Usar Edge Function/backend.
- [ ] Registrar costo.
- [ ] Aplicar rate limiting.
- [ ] Aplicar cuotas.

## 11.2 Router de modelos

Implementar selección según complejidad:

```text
simple
→ modelo económico

complejo
→ modelo superior
```

- [ ] Clasificar dificultad antes de inferencia.
- [ ] Usar modelo más barato que cumpla objetivo.
- [ ] Evitar modelos premium para tareas estructurales simples.
- [ ] Permitir configuración central de modelos.

## 11.3 Límites por tenant

- [ ] Presupuesto mensual.
- [ ] Límite diario.
- [ ] Límite por usuario.
- [ ] Límite por funcionalidad.
- [ ] Alertas de consumo.
- [ ] Hard limit opcional.
- [ ] Soft limit.
- [ ] Modo degradado local-only.

## 11.4 Protección contra loops

- [ ] Máximo de reintentos.
- [ ] No reenviar indefinidamente.
- [ ] Circuit breaker.
- [ ] Backoff.
- [ ] Deduplicación de solicitudes.

---

# 12. Fase 8 — Optimización de prompts y tokens

**Prioridad: alta**

## 12.1 Entrada

- [ ] No enviar historial innecesario.
- [ ] No enviar catálogo completo.
- [ ] No enviar documentación completa.
- [ ] Recortar metadata irrelevante.
- [ ] Enviar solo candidatos relevantes.
- [ ] Usar IDs compactos.
- [ ] Eliminar descripciones redundantes.

## 12.2 Salida

- [ ] Forzar JSON.
- [ ] Limitar `max_tokens`.
- [ ] Evitar explicaciones.
- [ ] Evitar markdown.
- [ ] Pedir únicamente campos requeridos.

## 12.3 Prompts

- [ ] Versionar prompts.
- [ ] Medir costo por versión.
- [ ] Medir precisión por versión.
- [ ] A/B test controlado.
- [ ] Rollback de prompts.

---

# 13. Fase 9 — Feedback loop

**Prioridad: alta**

Cada corrección de usuario debe mejorar resolución futura.

- [ ] Registrar comando original.
- [ ] Registrar resultado generado.
- [ ] Registrar resultado corregido.
- [ ] Registrar capa que falló.
- [ ] Alimentar aliases.
- [ ] Alimentar reglas determinísticas.
- [ ] Generar dataset de evaluación.
- [ ] No entrenar/aprender automáticamente datos sensibles.

---

# 14. Fase 10 — Dataset de regresión de IA

**Prioridad: alta**

Crear dataset interno:

```text
input
expected_intent
expected_products
expected_quantities
vertical
source
```

Incluir:

- [ ] Comandos reales anonimizados.
- [ ] Errores ortográficos.
- [ ] Texto de Vosk.
- [ ] OCR ruidoso.
- [ ] Tallas.
- [ ] Colores.
- [ ] Variantes.
- [ ] Productos similares.
- [ ] Casos ambiguos.
- [ ] Casos sin match.

Ejecutar contra:

- [ ] parser determinístico.
- [ ] LLM local.
- [ ] modelo cloud económico.
- [ ] modelo cloud superior.

---

# 15. Fase 11 — Modularizar web por dominio

**Prioridad: alta**

Migrar progresivamente de:

```text
components/
views/
services/
```

hacia:

```text
modules/
  auth/
  products/
  inventory/
  sales/
  customers/
  billing/
  accounting/
  manufacturing/
  ecommerce/
  notifications/
  ai/
```

Por módulo:

```text
components/
views/
services/
composables/
tests/
domain/
```

## Acciones

- [ ] Extraer responsabilidades de `App.vue`.
- [ ] Crear shell/layout.
- [ ] Extraer navegación.
- [ ] Extraer alertas.
- [ ] Extraer tema.
- [ ] Extraer sesión.
- [ ] Extraer permisos.
- [ ] Evitar lógica de negocio en componentes UI.

---

# 16. Fase 12 — Modularizar mobile por dominio

**Prioridad: alta**

Estructura objetivo:

```text
mobile/src/modules/
  auth/
  pos/
  products/
  inventory/
  sales/
  customers/
  manufacturing/
  ecommerce/
  notifications/
  ai/
  sync/
```

## Acciones

- [ ] Reducir `App.js`.
- [ ] Extraer bootstrap.
- [ ] Extraer navegación.
- [ ] Extraer sesión.
- [ ] Extraer tema.
- [ ] Extraer sincronización.
- [ ] Mantener Command Engine aislado del UI.
- [ ] Crear APIs internas estables entre módulos.

---

# 17. Fase 13 — Consolidar shared

**Prioridad: alta**

Estructura recomendada:

```text
shared/
  domain/
  schemas/
  constants/
  utils/
  supabase/
```

## Compartir

- [ ] enums.
- [ ] estados.
- [ ] reglas puras.
- [ ] schemas.
- [ ] validadores.
- [ ] contratos Edge Functions.
- [ ] nombres de eventos.
- [ ] permisos.
- [ ] tipos de notificación.

Ejemplos:

- [ ] `SaleStatus`.
- [ ] `OrderStatus`.
- [ ] `PaymentStatus`.
- [ ] `SubscriptionStatus`.
- [ ] `NotificationType`.
- [ ] `ProductType`.

---

# 18. Fase 14 — Backend Supabase

**Prioridad: alta**

## 18.1 Migraciones

- [ ] Mantener fuente canónica en `shared/supabase`.
- [ ] Validar symlinks/sync.
- [ ] Agregar checker CI.
- [ ] Detectar divergencias.
- [ ] Definir naming estándar.
- [ ] Definir orden.
- [ ] Evitar migraciones destructivas sin estrategia.

## 18.2 Edge Functions

- [ ] Shared functions en `shared`.
- [ ] Funciones específicas permanecen por app.
- [ ] Documentar secretos.
- [ ] Implementar timeouts.
- [ ] Implementar retries controlados.
- [ ] Implementar idempotencia.
- [ ] Aplicar dedupe donde corresponda.

---

# 18A. Fase 14A — Backend Gateway / capa anti-acoplamiento

**Prioridad: crítica**

Objetivo: reducir llamados directos desde Web/Mobile/Desktop a Supabase sin desarmar la app existente ni dejar flujos críticos sin funcionar.

No se debe hacer una reescritura completa. El cambio debe ser gradual:

```text
Estado actual

Web / Mobile
     ↓
Supabase directo

Estado objetivo incremental

Web / Mobile / Desktop
        ↓
Domain API / Backend Gateway
        ↓
Repositories / Adapters
        ↓
Supabase Adapter
```

## 18A.1 Principios

- [ ] Mantener la app funcionando durante toda la migración.
- [ ] Migrar por dominio, no por tecnología.
- [ ] No eliminar llamadas directas a Supabase hasta que exista contrato equivalente.
- [ ] No usar `service_role` para operaciones de usuario sin autorización explícita.
- [ ] Validar JWT del usuario en el backend.
- [ ] Mantener RLS como defensa adicional mientras exista Supabase.
- [ ] Diseñar contratos portables que no expongan nombres de tablas.
- [ ] Medir latencia antes/después por endpoint migrado.
- [ ] Mantener feature flags para volver temporalmente a Supabase directo.

## 18A.2 Qué debe pasar primero por backend

- [ ] Ventas.
- [ ] Pagos.
- [ ] Movimientos de inventario.
- [ ] Compras.
- [ ] Abonos/cartera.
- [ ] Facturación electrónica.
- [ ] Webhooks de pagos.
- [ ] Notificaciones.
- [ ] IA cloud/OCR cloud.
- [ ] Sync Engine push/pull.
- [ ] Operaciones batch/importaciones.

## 18A.3 Qué puede seguir directo temporalmente

- [ ] Auth básica.
- [ ] Lecturas simples con RLS fuerte.
- [ ] Catálogos administrativos no críticos.
- [ ] Realtime donde siga aportando valor.
- [ ] Storage no sensible con URLs firmadas.

## 18A.4 Contratos por dominio

Crear interfaces antes de mover implementación:

```text
AuthGateway
SalesRepository
PaymentRepository
InventoryRepository
PurchaseRepository
CustomerRepository
SyncTransport
NotificationGateway
AiGateway
ImportGateway
StorageGateway
```

- [x] Definir primer contrato piloto en `shared/contracts` (`LookupsRepository`).
- [x] Crear primera implementación actual `SupabaseRepository` (`supabaseLookupsRepository`).
- [x] Crear primera implementación futura `BackendRepository` (`backendLookupsRepository`).
- [x] Permitir cambiar implementación por feature flag/config (`VITE_USE_BACKEND_LOOKUPS`).
- [ ] Extender contratos a dominios críticos: ventas, pagos, inventario, compras, cartera y sync.
- [ ] Evitar que pantallas conozcan tablas, RPCs o Edge Functions.
- [ ] Documentar payloads y errores esperados.

## 18A.5 Estrategia de migración segura

Orden recomendado:

1. Crear contratos TypeScript/JS sin cambiar comportamiento.
2. Envolver llamadas existentes en adapters.
3. Migrar un flujo pequeño no crítico.
4. Medir errores/latencia.
5. Migrar flujo crítico con feature flag.
6. Mantener fallback temporal a Supabase directo.
7. Retirar fallback cuando haya estabilidad.

Checklist por endpoint migrado:

- [ ] Contrato definido.
- [ ] Validación de entrada.
- [ ] Validación de permisos/tenant.
- [ ] Idempotencia cuando aplique.
- [ ] Correlation ID.
- [ ] Logs estructurados.
- [ ] Tests unitarios.
- [ ] Tests de integración.
- [ ] Métricas.
- [ ] Fallback o rollback documentado.

Protocolo de rollback por dominio:

1. Cada dominio migrado debe tener feature flag propio o agrupado por adapter.
2. El valor por defecto en producción debe conservar el adapter Supabase hasta validar el backend.
3. Si el backend falla, el adapter puede caer a Supabase directo solo durante la etapa de transición.
4. Todo error normalizado debe incluir `code`, `domain`, `operation`, `correlationId`, `retryable` y `status` cuando aplique.
5. Cada request al backend debe enviar `x-correlation-id` para cruzar logs cliente/backend.
6. El rollback operativo consiste en apagar el feature flag, revisar errores por `correlationId` y mantener el contrato público sin cambios.
7. Cuando un dominio lleve estabilidad suficiente, se retira el fallback y se actualiza el plan.

## 18A.6 Decisiones pendientes

- [x] Elegir runtime backend: Node.js 20 HTTP nativo para el primer gateway incremental.
- [ ] Definir hosting.
- [ ] Definir estrategia de sesiones/JWT.
- [ ] Definir estándar de errores.
- [ ] Definir versionado de API.
- [ ] Definir si Edge Functions siguen como workers o se migran al backend.
- [ ] Definir si el backend será monolito modular inicialmente.

---

# 19. Fase 15 — Offline-first mobile

**Prioridad: crítica**

Convertir SQLite en una capacidad estratégica.

Arquitectura:

```text
Supabase
   │
   ▼
Sync Engine
   │
   ▼
SQLite
   │
   ▼
Mobile
```

## 19.1 Datos locales prioritarios

- [ ] Productos.
- [ ] Variantes.
- [ ] Precios.
- [ ] Clientes frecuentes.
- [ ] Configuración POS.
- [ ] Aliases.
- [ ] Inventario necesario.
- [ ] Pendientes de sincronización.

## 19.2 Cola offline

- [ ] Operaciones con UUID local.
- [ ] Idempotency key.
- [ ] Estado pendiente.
- [ ] Estado enviado.
- [ ] Estado confirmado.
- [ ] Estado error.
- [ ] Retry exponencial.
- [ ] Dead-letter local.

## 19.3 Conflictos

- [ ] Estrategia por entidad.
- [ ] Evitar last-write-wins genérico.
- [ ] Definir conflictos de stock.
- [ ] Definir conflictos de clientes.
- [ ] Definir conflictos de precios.

---



# 19A. Fase 15A — Motor de sincronización compartido

**Prioridad: crítica**

El Sync Engine debe convertirse en una capacidad central de OfirOne y ser reutilizado por:

- [ ] Mobile.
- [ ] Desktop.
- [ ] Procesos futuros que requieran operación local.

Arquitectura objetivo:

```text
                    Supabase
                       │
                       ▼
                 Sync Protocol
                       │
              ┌────────┴────────┐
              │                 │
        Mobile Sync        Desktop Sync
              │                 │
              ▼                 ▼
           SQLite            SQLite
```

El objetivo es evitar dos motores diferentes.

## 19A.1 Paquete compartido

Crear una estructura equivalente a:

```text
shared/
  sync/
    core/
    queue/
    conflict/
    transport/
    mapping/
    idempotency/
    policies/
```

- [x] Definir contratos independientes de UI.
- [x] Separar lógica de sincronización del almacenamiento.
- [ ] Separar transporte Supabase.
- [ ] Separar políticas por entidad.
- [ ] Permitir adapters específicos para React Native y Tauri.

Estado ejecutado:

- [x] Crear núcleo inicial `shared/sync/syncContract.js`.
- [x] Definir entidades, operaciones y estados canónicos de outbox.
- [x] Crear generación estándar de `idempotency_key`.
- [x] Agregar helpers de retry/no-retry para outbox local.
- [x] Extraer política de retry/backoff/no-retry a `shared/sync/retryPolicy.js`.
- [x] Agregar puente compatible con `pending_ops` mobile legacy sin migrar todavía la tabla.
- [x] Conectar POS mobile para encolar ventas offline con contrato canónico y compatibilidad legacy.
- [x] Cubrir contrato con tests unitarios.

## 19A.2 Outbox local

Cada operación offline debe generar una entrada en una cola local.

Campos mínimos:

- [x] `operation_id`.
- [x] `tenant_id`.
- [x] `device_id`.
- [x] `entity_type`.
- [x] `entity_id`.
- [x] `operation_type`.
- [x] `payload`.
- [x] `idempotency_key`.
- [x] `created_at`.
- [x] `attempt_count`.
- [x] `last_attempt_at`.
- [x] `status`.
- [x] `error_code`.
- [x] `error_message`.

Estados:

- [x] `pending`.
- [x] `processing`.
- [x] `synced`.
- [x] `conflict`.
- [x] `failed`.
- [x] `dead_letter`.

Estado ejecutado:

- [x] `pending_ops` mobile ya funciona como outbox SQLite local.
- [x] Se agregaron columnas canónicas compatibles: `entity_type`, `entity_id`, `idempotency_key`, `last_attempt_at`, `error_code`.
- [x] Se agregó migración local tolerante para instalaciones existentes.
- [x] Se agregó índice único local por `idempotency_key` cuando exista.
- [x] El adapter web/AsyncStorage conserva los mismos campos para paridad de pruebas y Expo web.

Nota de verificación (auditoría 2026): el runtime SQLite solo persiste los estados legacy `PENDING/PROCESSING/DONE/FAILED`; `conflict` y `dead_letter` existen en el contrato pero se degradan a `FAILED` (dead-letter real = etiqueta `NO_RETRY` sobre `FAILED`). `error_code` está en el esquema pero ningún flujo lo escribe todavía, y el enqueue no maneja duplicados por `ON CONFLICT`. Ver Sprint 5 de la hoja de ruta.

## 19A.3 Idempotencia

- [x] Cada operación debe tener `idempotency_key`.
- [ ] Backend debe rechazar duplicados lógicamente equivalentes.
- [ ] Reintentos no deben duplicar ventas.
- [ ] Reintentos no deben duplicar movimientos de inventario.
- [ ] Reintentos no deben duplicar pagos o abonos.
- [ ] Mantener historial de operaciones procesadas cuando sea necesario.

## 19A.4 Pull incremental

Implementar sincronización incremental:

- [ ] `updated_at`.
- [ ] cursor de sincronización.
- [ ] versión por entidad cuando aplique.
- [ ] lotes paginados.
- [ ] checkpoint persistente.
- [ ] reanudación después de cierre inesperado.

Evitar:

```text
descargar toda la base
```

Usar:

```text
último checkpoint
      ↓
cambios posteriores
      ↓
merge local
```

## 19A.5 Push incremental

- [ ] Procesar outbox por lotes.
- [ ] Priorizar operaciones críticas.
- [ ] Aplicar retry exponencial.
- [ ] Detectar errores permanentes.
- [ ] Mover errores no recuperables a dead-letter.
- [ ] Evitar bloquear toda la cola por una operación fallida.

## 19A.6 Orden de sincronización

Definir dependencias.

Ejemplo:

```text
cliente
   ↓
venta
   ↓
líneas
   ↓
movimientos inventario
```

- [ ] Crear grafo simple de dependencias.
- [ ] No enviar hijos antes del padre.
- [ ] Resolver IDs locales vs IDs remotos.

## 19A.7 Identificadores

- [ ] Usar UUID generado localmente.
- [ ] Evitar depender de IDs autoincrementales.
- [ ] Mantener ID estable entre offline y cloud.
- [ ] Evitar remapeos innecesarios.

## 19A.8 Inventario

Nunca sincronizar simplemente:

```text
stock = 5
```

Preferir movimientos:

```text
SALE
product_id
-2
device_id
timestamp
operation_id
```

- [ ] Registrar movimientos.
- [ ] Recalcular stock servidor.
- [ ] Detectar overselling.
- [ ] Generar alertas de reconciliación.
- [ ] Mantener trazabilidad.

## 19A.9 Conflictos

Definir política por entidad.

### Productos

- [ ] Server-wins para configuración administrativa sensible.
- [ ] Detectar cambios simultáneos.

### Clientes

- [ ] Merge cuando sea seguro.
- [ ] Resolver duplicados por reglas.

### Ventas

- [ ] Append-only siempre que sea posible.
- [ ] No sobrescribir ventas confirmadas.

### Inventario

- [ ] Basado en movimientos.
- [ ] Nunca last-write-wins genérico.

### Precios

- [ ] Definir versión/vigencia.
- [ ] Registrar precio usado en la venta.

## 19A.10 Estado de sincronización visible

Mostrar al usuario:

- [ ] Online/offline.
- [ ] Última sincronización.
- [ ] Operaciones pendientes.
- [ ] Operaciones con error.
- [ ] Conflictos.
- [ ] Botón de reintento cuando aplique.

Estados visuales sugeridos:

```text
🟢 Sincronizado
🟠 12 operaciones pendientes
🔴 2 errores de sincronización
```

## 19A.11 Detección de conectividad

- [ ] No confiar únicamente en "hay Wi-Fi".
- [ ] Verificar acceso real al backend.
- [ ] Detectar degradación.
- [ ] Evitar loops de reconexión.
- [ ] Aplicar debounce.

## 19A.12 Sync selectivo

No sincronizar todo.

Prioridad local:

- [ ] Productos activos.
- [ ] Variantes.
- [ ] Precios vigentes.
- [ ] Clientes recientes/frecuentes.
- [ ] Configuración POS.
- [ ] Métodos de pago.
- [ ] Aliases.
- [ ] Inventario relevante.
- [ ] Ventas pendientes.
- [ ] Movimientos pendientes.

Evitar por defecto:

- [ ] Logs históricos completos.
- [ ] Auditorías antiguas.
- [ ] Reportes precalculados.
- [ ] Historial contable completo.

## 19A.13 Multi-dispositivo

- [ ] Identificar cada instalación con `device_id`.
- [ ] Registrar `device_name`.
- [ ] Registrar versión app.
- [ ] Registrar último sync.
- [ ] Poder revocar dispositivo.
- [ ] Poder detectar dispositivo obsoleto.

## 19A.14 Seguridad local

- [ ] Cifrar secretos.
- [ ] No guardar service-role keys.
- [ ] Usar token de usuario.
- [ ] Evaluar cifrado SQLite.
- [ ] Bloqueo por sesión.
- [ ] Borrado seguro al cerrar sesión cuando aplique.

## 19A.15 Tests del Sync Engine

- [x] Retry.
- [ ] Duplicados.
- [x] Idempotencia.
- [ ] Pérdida de conexión.
- [ ] Reconexión.
- [ ] Orden de dependencias.
- [ ] Conflictos.
- [ ] Sync parcial.
- [ ] Crash durante sync.
- [ ] Dos dispositivos.
- [ ] Overselling.

---

# 19AA. Fase 15AA — Procesos asíncronos y colas

**Prioridad: crítica**

Objetivo: mover a colas todo proceso que sea lento, reintentable, externo, costoso o que no deba bloquear la operación principal.

Regla:

```text
Operación crítica local
        ↓
Confirmación inmediata
        ↓
Evento / job en cola
        ↓
Worker con reintentos
        ↓
Estado visible
```

## 19AA.1 Cuándo usar cola

Un proceso debe ser asíncrono si:

- [ ] Llama servicios externos.
- [ ] Puede fallar por red/proveedor.
- [ ] Requiere reintentos.
- [ ] Tarda demasiado para una pantalla.
- [ ] Puede ejecutarse por lotes.
- [ ] No debe bloquear ventas/compras.
- [ ] Necesita idempotencia.
- [ ] Necesita auditoría de estados.
- [ ] Puede terminar en `dead_letter`.

## 19AA.2 Modelo estándar de job

Crear un contrato común:

```text
job_id
tenant_id
user_id
device_id
type
payload
idempotency_key
correlation_id
priority
status
attempt_count
max_attempts
next_attempt_at
locked_at
locked_by
last_error_code
last_error_message
created_at
updated_at
processed_at
metadata
```

Estados:

- [ ] `pending`.
- [ ] `processing`.
- [ ] `waiting_retry`.
- [ ] `completed`.
- [ ] `completed_with_warnings`.
- [ ] `failed`.
- [ ] `dead_letter`.
- [ ] `cancelled`.

## 19AA.3 Workers

- [ ] Workers deben ser idempotentes.
- [ ] Workers deben tomar lock por job.
- [ ] Workers deben aplicar retry exponencial.
- [ ] Workers deben distinguir error temporal vs permanente.
- [ ] Workers deben mover fallos definitivos a dead-letter.
- [ ] Workers deben registrar métricas por tipo de job.
- [ ] Workers deben propagar `correlation_id`.
- [ ] Workers no deben depender de UI.

## 19AA.4 Procesos que deben ser async

- [ ] Sync push/pull.
- [ ] Emisión de facturación electrónica.
- [ ] Envío de emails.
- [ ] Envío de push notifications.
- [ ] WhatsApp/SMS.
- [ ] Webhooks de pagos.
- [ ] Renovaciones de suscripción.
- [ ] Recordatorios de pago.
- [ ] Procesamiento contable automático.
- [ ] Recalculo de alertas.
- [ ] Imports masivos.
- [ ] OCR/IA sobre fotos.
- [ ] Procesamiento de imágenes.
- [ ] Limpieza de órdenes online expiradas.
- [ ] Reconciliaciones.
- [ ] Reportes pesados.

## 19AA.5 Procesos que NO deben depender de cola

Estos procesos deben ser inmediatos/determinísticos:

- [ ] Crear venta local.
- [ ] Calcular totales.
- [ ] Validar caja abierta.
- [ ] Validar permisos.
- [ ] Registrar pago local.
- [ ] Reservar/aplicar movimiento local.
- [ ] Guardar borrador local.
- [ ] Validar reglas de negocio críticas.

Si una cola falla, la operación local crítica debe permanecer auditada y recuperable.

## 19AA.6 Colas por dominio

- [ ] `sync_outbox`.
- [ ] `notification_outbox`.
- [ ] `accounting_event_queue`.
- [ ] `billing_job_queue`.
- [ ] `payment_webhook_queue`.
- [ ] `ai_job_queue`.
- [ ] `import_job_queue`.
- [ ] `media_processing_queue`.
- [ ] `report_job_queue`.

No todas deben ser tablas separadas inicialmente. Puede existir una tabla común `background_jobs` con tipos y handlers, siempre que el diseño permita separar después.

## 19AA.7 Observabilidad de colas

- [ ] Backlog por cola.
- [ ] Jobs fallidos por tipo.
- [ ] Tiempo promedio de procesamiento.
- [ ] Edad del job más viejo pendiente.
- [ ] Reintentos promedio.
- [ ] Dead-letter por tenant.
- [ ] Botón de reintento controlado.
- [ ] Vista soporte/admin.

---

# 19AB. Fase 15AB — Import Engine asíncrono para Excel, CSV y fotos

**Prioridad: crítica**

Objetivo: todo cargue masivo o cargue por foto debe procesarse con cola, validación, revisión y confirmación. La IA/OCR o el parser nunca deben escribir directamente en tablas críticas sin pasar por validación.

```text
Archivo / foto
      ↓
import_job
      ↓
parse / OCR / IA
      ↓
draft normalizado
      ↓
validación determinística
      ↓
revisión del usuario
      ↓
comando de dominio
      ↓
base de datos
```

## 19AB.1 Excel / CSV

Casos prioritarios:

- [x] Productos.
- [x] Variantes.
- [ ] Códigos de barras.
- [x] Terceros.
- [ ] Clientes.
- [ ] Proveedores.
- [ ] Inventario inicial.
- [ ] Ajustes de stock.
- [ ] Listas de precios.
- [ ] Catálogo proveedor.
- [ ] BOM/manufactura.
- [ ] Compras desde factura estructurada.

Flujo:

- [x] Subir archivo.
- [x] Crear `import_job`.
- [x] Guardar archivo original.
- [x] Parsear en worker.
- [x] Normalizar columnas.
- [ ] Detectar plantilla.
- [ ] Mapear columnas.
- [x] Validar filas.
- [ ] Detectar duplicados.
- [ ] Detectar referencias faltantes.
- [x] Generar preview.
- [x] Permitir confirmación.
- [x] Aplicar por lotes desde worker.
- [x] Reportar resultado final en `bulk_imports.summary`.
- [ ] Permitir corrección manual de filas antes de confirmar.

Estado ejecutado:

- [x] Backend worker procesa `bulk_import_process` hasta fase `preview_ready`.
- [x] Preview se guarda en `bulk_imports.summary`.
- [x] Errores de validación se guardan en `bulk_import_errors`.
- [x] Se mantienen feature flags para no romper el flujo web actual.
- [x] Se agregaron límites `IMPORT_MAX_FILE_BYTES` e `IMPORT_MAX_ROWS`.
- [x] Se bloquean headers peligrosos (`__proto__`, `prototype`, `constructor`) antes de usar filas parseadas.
- [x] La UI muestra acción `Aplicar preview` cuando `summary.phase = preview_ready` y encola `bulk_import_apply_products`.
- [x] El encolado de aplicación usa `dedupe_key = bulk-import-apply:{import_id}` para evitar dobles confirmaciones.
- [x] El worker aplica cargues de terceros con `bulk_import_apply_third_parties` reutilizando `fn_upsert_third_party`.
- [ ] Sustituir o aislar `xlsx@0.18.5` antes de exponer cargues masivos no confiables a gran escala; `npm audit` reporta vulnerabilidad alta sin fix disponible.

Estados:

- [x] `uploaded`.
- [x] `parsing`.
- [ ] `mapping_required`.
- [x] `validating`.
- [x] `ready_for_review`.
- [x] `importing`.
- [x] `completed`.
- [ ] `completed_with_errors`.
- [ ] `failed`.
- [ ] `cancelled`.

Tablas sugeridas:

```text
import_jobs
import_job_files
import_job_rows
import_job_errors
import_job_mappings
import_drafts
```

Campos mínimos por fila:

- [ ] `row_number`.
- [ ] `raw_payload`.
- [ ] `normalized_payload`.
- [ ] `validation_status`.
- [ ] `errors`.
- [ ] `warnings`.
- [ ] `target_entity_type`.
- [ ] `target_entity_id`.
- [ ] `applied_at`.

## 19AB.2 Fotos / OCR

Casos prioritarios:

- [ ] Foto de factura de compra.
- [ ] Foto de producto para crear catálogo.
- [ ] Foto de lista de precios.
- [ ] Foto de inventario físico.
- [ ] Foto de pedido escrito a mano.
- [ ] Foto de documento soporte.

Flujo:

- [x] Subir foto.
- [x] Crear `media_processing_job`.
- [ ] Optimizar imagen local cuando aplique.
- [x] Guardar original.
- [ ] Generar preview/thumbnail.
- [ ] Ejecutar OCR local cuando exista.
- [ ] Validar calidad OCR.
- [x] Usar OCR/IA cloud para factura de compra en worker.
- [x] Guardar texto extraído en resultado del job.
- [x] Crear draft revisable en resultado del job.
- [ ] Aplicar solo con confirmación o reglas explícitas.

Tablas sugeridas:

```text
media_processing_jobs  -> implementado inicialmente como contrato sobre async_jobs.queue = media_processing
media_processing_files
ocr_results
parsed_media_drafts
media_job_errors
```

Estado ejecutado:

- [x] Crear contrato compartido `shared/media/mediaProcessingContract.js`.
- [x] Crear endpoint backend `POST /media-processing/jobs`.
- [x] Encolar tipos iniciales: factura de compra, foto de producto, lista de precios, inventario físico, pedido escrito y documento soporte.
- [x] Usar `dedupe_key = media-processing:{type}:{file_key}` para evitar trabajos duplicados por archivo.
- [x] Foto de factura en web puede subir original y encolar `purchase_invoice_photo` con `VITE_USE_BACKEND_MEDIA_JOBS`.
- [x] Processor OCR de `purchase_invoice_photo` en worker.
- [x] Persistir resultado OCR/draft revisable para factura en `async_jobs.result`.
- [x] Foto de producto en web puede subir original y encolar `product_catalog_photo` con `VITE_USE_BACKEND_MEDIA_JOBS`.
- [x] Processor de `product_catalog_photo` en worker invoca `product-photo-parser`.
- [x] Persistir draft de productos por foto en `async_jobs.result`.
- [x] Agregar historial unificado de `import_jobs` y `media_processing` desde `async_jobs` vía backend y UI de importaciones.
- [ ] Consumir el draft de factura desde la UI de compras o historial de media jobs.
- [ ] Consumir el draft de productos desde la UI de importaciones o historial de media jobs.

Nota de verificación (auditoría 2026): el endpoint encola 6 tipos de media job pero solo 2 tienen procesador en el worker (`purchase_invoice_photo`, `product_catalog_photo`); los otros 4 tipos encolados terminan en `dead_letter`. Las colas `ai_jobs` y `report_jobs` están en `workerQueues` por default pero sus handlers lanzan error (stub). El worker envía la imagen original a la EF (no la optimiza localmente; la ruta legacy web sí). Ver Sprint 6 de la hoja de ruta.

## 19AB.3 Reglas de seguridad

- [ ] No guardar imágenes sensibles indefinidamente sin política.
- [ ] No enviar a IA cloud si OCR local es suficiente.
- [ ] No escribir directo en ventas, inventario, compras o productos.
- [ ] No mezclar datos entre tenants.
- [ ] Guardar auditoría de usuario que confirma.
- [ ] Registrar modelo/OCR usado.
- [ ] Registrar costo IA.
- [ ] Registrar fallback a cloud.

## 19AB.4 UX requerida

- [ ] Barra de progreso por job.
- [ ] Estado visible por archivo/foto.
- [ ] Descarga de errores.
- [ ] Reintento por job.
- [ ] Cancelación cuando sea segura.
- [ ] Vista de filas válidas/invalidas.
- [ ] Confirmación antes de aplicar cambios masivos.
- [ ] Historial de cargues.

## 19AB.5 Orden de implementación

1. Definir tablas y contratos.
2. Crear worker de parsing CSV/XLSX.
3. Crear preview de errores.
4. Migrar import de productos.
5. Migrar import de terceros.
6. Migrar inventario/listas de precio.
7. Crear worker de media/OCR.
8. Migrar foto de factura.
9. Migrar foto de producto.
10. Unificar observabilidad.

---

# 19B. Fase 15B — OfirOne Desktop multiplataforma

**Prioridad: alta**

Objetivo:

Crear una aplicación de escritorio para clientes que operan principalmente desde PC y que necesitan conservar las capacidades offline-first.

Tecnología objetivo:

```text
Tauri
+
Vue 3
+
Vuetify
+
SQLite
+
Shared Sync Engine
+
Supabase
```

Plataformas:

- [ ] Windows.
- [ ] Linux.
- [ ] macOS.

## 19B.1 Principio de reutilización

No crear una tercera UI independiente.

Reutilizar:

```text
Web Vue
   │
   ├── Browser
   │
   └── Desktop/Tauri
```

Compartir:

- [ ] Componentes Vue.
- [ ] Servicios.
- [ ] Validadores.
- [ ] Schemas.
- [ ] Dominio.
- [ ] Permisos.
- [ ] Traducciones.
- [ ] Lógica de negocio pura.

Desktop agrega:

- [ ] SQLite.
- [ ] Sync Engine.
- [ ] Hardware local.
- [ ] IA local.
- [ ] Filesystem.
- [ ] Integración SO.

## 19B.2 Estructura sugerida

```text
apps/
  web/
  desktop/
  mobile/

shared/
  domain/
  schemas/
  constants/
  sync/
  ai/
  supabase/
```

Alternativamente mantener `web/` actual y crear:

```text
desktop/
```

como shell Tauri que consuma el frontend Vue compartido.

## 19B.3 Repositorios de datos

La UI no debe saber si está ejecutándose en navegador o desktop.

Definir interfaz:

```text
ProductRepository
SalesRepository
CustomerRepository
InventoryRepository
```

Implementaciones:

```text
Web
→ SupabaseRepository

Desktop
→ LocalRepository(SQLite)
→ Sync Engine
→ Supabase
```

- [ ] Crear interfaces.
- [ ] Extraer llamadas Supabase directas de componentes.
- [ ] Implementar adapter web.
- [ ] Implementar adapter desktop.

## 19B.4 Operaciones offline desktop

### Offline seguro

- [ ] Venta POS.
- [ ] Cotización.
- [ ] Pedido.
- [ ] Consulta catálogo.
- [ ] Clientes.
- [ ] Impresión.
- [ ] IA local.
- [ ] Lectura de precios cacheados.

### Offline con reconciliación

- [ ] Inventario.
- [ ] Devoluciones.
- [ ] Abonos.
- [ ] Cartera.
- [ ] Recepciones.

### Online obligatorio

- [ ] Mercado Pago / gateways.
- [ ] Administración SuperAdmin.
- [ ] Gestión de suscripción SaaS.
- [ ] Operaciones sensibles definidas por política.
- [ ] Procesos que requieran validación remota inmediata.

## 19B.5 Base local desktop

SQLite debe incluir al menos:

- [ ] products.
- [ ] product_variants.
- [ ] prices.
- [ ] customers.
- [ ] tenant_config.
- [ ] payment_methods.
- [ ] aliases.
- [ ] local_sales.
- [ ] local_sale_lines.
- [ ] inventory_movements.
- [ ] sync_outbox.
- [ ] sync_state.
- [ ] device_state.

## 19B.6 Venta offline

Flujo:

```text
Venta
 ↓
UUID local
 ↓
SQLite
 ↓
Impresión
 ↓
Outbox
 ↓
Pendiente de sync
```

Cuando vuelve Internet:

```text
Outbox
 ↓
Sync Engine
 ↓
Backend
 ↓
Validación idempotente
 ↓
Confirmación
 ↓
synced
```

- [ ] La venta no debe bloquearse por falta de Internet.
- [ ] La impresión debe funcionar offline.
- [ ] Mostrar estado de sincronización.

## 19B.7 Hardware POS

Desktop debe preparar adapters para:

- [ ] Impresora térmica.
- [ ] Cajón monedero.
- [ ] Lector de código de barras.
- [ ] Balanza.
- [ ] Puerto serial.
- [ ] USB.
- [ ] Scanner.
- [ ] Impresora convencional.

Crear capa:

```text
hardware/
  printer/
  barcode/
  scale/
  cashdrawer/
```

No acoplar componentes Vue directamente al hardware.

## 19B.8 Impresión

- [ ] Tickets.
- [ ] Facturas.
- [ ] Cotizaciones.
- [ ] Cierres.
- [ ] Reimpresión.
- [ ] Impresión offline.
- [ ] Plantillas por tenant.
- [ ] Configuración de impresora por caja.

## 19B.9 Actualizaciones

- [ ] Auto-update.
- [ ] Canal stable.
- [ ] Canal beta.
- [ ] Rollback.
- [ ] Firma de releases.
- [ ] Validar integridad.
- [ ] No actualizar durante operación de caja.

## 19B.10 Instalación

- [ ] Installer Windows.
- [ ] Paquete Linux.
- [ ] Paquete macOS.
- [ ] Configuración inicial.
- [ ] Registro del dispositivo.
- [ ] Descarga inicial de datos.
- [ ] Prueba de impresora.

## 19B.11 Modo kiosco/caja

- [ ] Inicio automático opcional.
- [ ] Fullscreen opcional.
- [ ] Bloqueo de navegación no autorizada.
- [ ] Reconexión automática.
- [ ] Recuperación después de crash.

---

# 19C. Fase 15C — IA local en Desktop

**Prioridad: alta**

Desktop puede reducir aún más el uso cloud porque normalmente dispone de más RAM, CPU y almacenamiento.

Pipeline:

```text
cache
 ↓
determinístico
 ↓
IA local desktop
 ↓
IA cloud
```

## 19C.1 Device capability

Clasificar PC:

- [ ] `LOW`.
- [ ] `MID`.
- [ ] `HIGH`.

### LOW

- [ ] Determinístico.
- [ ] Cache.
- [ ] Modelo pequeño opcional.
- [ ] Cloud excepcional.

### MID

- [ ] Modelo local ~1B–3B cuantizado.

### HIGH

- [ ] Evaluar 3B–7B solo si mejora suficientemente precisión.

## 19C.2 Modelo

- [ ] Descargar bajo demanda.
- [ ] No incluir modelo pesado en instalador inicial.
- [ ] Versionado.
- [ ] Checksum.
- [ ] Rollback.
- [ ] Gestión de espacio.

## 19C.3 Candidate retrieval

Igual que mobile:

```text
input
 ↓
candidate retrieval local
 ↓
Top-K
 ↓
LLM
```

- [ ] No enviar catálogo completo.
- [ ] Reutilizar aliases.
- [ ] Reutilizar cache.
- [ ] Reutilizar contratos de Command Engine.

## 19C.4 Cloud avoidance

Medir por plataforma:

- [ ] Cloud Avoidance mobile.
- [ ] Cloud Avoidance desktop.
- [ ] Costo IA mobile.
- [ ] Costo IA desktop.

Objetivo desktop:

- [ ] Buscar Cloud Avoidance `>= 95%` en operaciones rutinarias.

---

# 19D. Fase 15D — Arquitectura compartida offline

**Prioridad: crítica**

El objetivo final:

```text
                     shared/domain
                     shared/schemas
                     shared/sync
                     shared/ai
                          │
          ┌───────────────┼────────────────┐
          │               │                │
         Web            Mobile          Desktop
      Vue/Supabase      RN/SQLite      Vue/Tauri/SQLite
```

## Acciones

- [ ] Extraer dominio compartido.
- [ ] Extraer contratos.
- [ ] Extraer Sync Engine.
- [ ] Extraer políticas de conflicto.
- [ ] Extraer modelo de outbox.
- [ ] Compartir lógica de IA cuando sea portable.
- [ ] Mantener adapters de plataforma aislados.

---

# 19E. Fase 15E — MVP Desktop

**Prioridad: alta**

Primera versión debe ser pequeña.

## MVP 1

- [ ] Login.
- [ ] Descarga inicial de catálogo.
- [ ] SQLite local.
- [ ] POS.
- [ ] Clientes básicos.
- [ ] Venta offline.
- [ ] Impresión.
- [ ] Outbox.
- [ ] Sync al recuperar conexión.
- [ ] Estado de sincronización.

No incluir inicialmente:

- [ ] Todo contabilidad offline.
- [ ] Todo manufacturing offline.
- [ ] Todos los reportes.
- [ ] Toda administración SaaS.

## Criterio de éxito MVP

Escenario obligatorio:

```text
1. Login online.
2. Sincronizar catálogo.
3. Cortar Internet.
4. Crear varias ventas.
5. Imprimir tickets.
6. Cerrar y abrir app.
7. Ventas siguen presentes.
8. Recuperar Internet.
9. Sincronizar.
10. No crear duplicados.
```

---

# 19F. Fase 15F — MVP Sync Engine

**Prioridad: crítica**

Primera versión:

- [ ] UUID local.
- [ ] SQLite.
- [ ] Outbox.
- [ ] Push.
- [ ] Pull incremental.
- [ ] Checkpoint.
- [ ] Idempotencia.
- [ ] Retry.
- [ ] Estado visible.
- [ ] Ventas.
- [ ] Clientes.
- [ ] Productos.
- [ ] Precios.

Segunda versión:

- [ ] Inventario por movimientos.
- [ ] Conflictos.
- [ ] Multi-device.
- [ ] Dead-letter.
- [ ] Métricas.

Tercera versión:

- [ ] Reconciliación avanzada.
- [ ] Sync selectivo.
- [ ] Priorización.
- [ ] Administración remota de dispositivos.


# 20. Fase 16 — CI/CD obligatorio

**Prioridad: crítica**

Crear workflows de PR.

## Web

- [ ] Install.
- [ ] Lint.
- [ ] Tests.
- [ ] Build.

## Mobile

- [ ] Install.
- [ ] Lint.
- [ ] Format check.
- [ ] Jest.
- [ ] Tests de Command Engine.

## Shared

- [ ] Validar migraciones.
- [ ] Validar Edge Functions.
- [ ] Validar sync.
- [ ] Buscar divergencias.
- [ ] Buscar secretos accidentales.

## Merge

- [ ] Bloquear merge si CI falla.
- [ ] Branch protection.
- [ ] Require PR.
- [ ] Require checks.

---

# 21. Fase 17 — Testing

**Prioridad: alta**

## Unitarios

- [ ] Dominio.
- [ ] Parsers.
- [ ] Pricing.
- [ ] Inventario.
- [ ] Aliases.
- [ ] Command Engine.

## Integración

- [ ] RPC.
- [ ] Edge Functions.
- [ ] Supabase.
- [ ] RLS.
- [ ] Checkout.
- [ ] Suscripciones.

## E2E

- [ ] Login.
- [ ] Venta.
- [ ] Inventario.
- [ ] Tienda.
- [ ] Pedido online.
- [ ] Pago.
- [ ] Suscripción.
- [ ] Flujo IA sin cloud.
- [ ] Fallback cloud.

---

# 22. Fase 18 — Seguridad multi-tenant

**Prioridad: crítica**

- [ ] Auditar todas las tablas con `tenant_id`.
- [ ] Validar RLS.
- [ ] Tests automáticos cross-tenant.
- [ ] Evitar confiar en `tenant_id` enviado por cliente.
- [ ] Obtener tenant desde sesión/contexto.
- [ ] Auditar RPC SECURITY DEFINER.
- [ ] Aplicar mínimo privilegio.
- [ ] Registrar cambios administrativos.
- [ ] Proteger SuperAdmin.
- [ ] Revisar Storage policies.
- [ ] Rotación de secretos.

Test obligatorio:

```text
Tenant A
NO puede leer
Tenant B
```

---

# 23. Fase 19 — Observabilidad general

**Prioridad: alta**

## Métricas

- [ ] Errores web.
- [ ] Errores mobile.
- [ ] Edge Function failures.
- [ ] RPC latency.
- [ ] Realtime.
- [ ] Queue backlog.
- [ ] Notification failures.
- [ ] Payment failures.
- [ ] Sync failures.
- [ ] IA cost.

## Correlation ID

- [ ] Generar `correlation_id`.
- [ ] Propagar mobile/web.
- [ ] Propagar Edge Function.
- [ ] Propagar DB cuando aplique.
- [ ] Mostrarlo en soporte.

---

# 24. Fase 20 — Notificaciones

**Prioridad: media-alta**

- [ ] Mantener outbox central.
- [ ] Mantener dedupe.
- [ ] Retry.
- [ ] Dead-letter.
- [ ] Métricas de entrega.
- [ ] Separar email/push/in-app.
- [ ] Preferencias por usuario.
- [ ] Preferencias por tenant.
- [ ] Evitar enviar eventos duplicados.

---

# 25. Fase 21 — Pagos y ecommerce

**Prioridad: alta**

- [ ] Mantener idempotencia.
- [ ] Revalidar pagos server-side.
- [ ] No confiar en callback frontend.
- [ ] Deduplicar webhooks.
- [ ] Registrar payload sanitizado.
- [ ] Alertar inconsistencias.
- [ ] Timeout de reservas.
- [ ] Liberar reservas vencidas.
- [ ] Reconciliación automática.

---

# 26. Fase 22 — Suscripciones SaaS

**Prioridad: alta**

- [ ] Límite por plan.
- [ ] Enforcement en DB.
- [ ] Enforcement amigable en UI.
- [ ] Grace period.
- [ ] Reintento de cobro.
- [ ] Suspensión controlada.
- [ ] Renovación.
- [ ] Downgrade.
- [ ] Upgrade.
- [ ] Auditoría.
- [ ] Métricas MRR.
- [ ] Churn.
- [ ] ARPU.
- [ ] LTV.
- [ ] CAC cuando exista marketing medible.

---

# 27. Fase 23 — Feature flags

**Prioridad: media**

- [ ] Flags por tenant.
- [ ] Flags por plan.
- [ ] Flags por porcentaje.
- [ ] Flags por dispositivo.
- [ ] Rollout de modelos IA.
- [ ] Rollout de OCR.
- [ ] Kill switch cloud.
- [ ] Kill switch funciones experimentales.

---

# 28. Fase 24 — Documentación

**Prioridad: media-alta**

Crear:

- [ ] `README.md`.
- [ ] `ARCHITECTURE.md`.
- [ ] `CONTRIBUTING.md`.
- [ ] `SECURITY.md`.
- [ ] `AI_ARCHITECTURE.md`.
- [ ] `OFFLINE_ARCHITECTURE.md`.
- [ ] `SUPABASE_DEPLOYMENT.md`.

Mover documentos a:

```text
docs/
  architecture/
  features/
  security/
  ai/
  operations/
  historical/
  adr/
```

## ADR

- [ ] Backend Supabase.
- [ ] Multi-tenant.
- [ ] Shared backend.
- [ ] Offline-first.
- [ ] Notification outbox.
- [ ] Mercado Pago.
- [ ] IA local-first.
- [ ] Cloud fallback.
- [ ] Estrategia de modelos.

---

# 29. Fase 25 — Limpieza técnica

**Prioridad: media**

- [ ] Identificar archivos obsoletos.
- [ ] Eliminar documentación duplicada.
- [ ] Eliminar código muerto.
- [ ] Detectar dependencias no usadas.
- [ ] Reducir componentes gigantes.
- [ ] Reducir servicios gigantes.
- [ ] Revisar TODO/FIXME.
- [ ] Revisar warnings de build.
- [ ] Homogeneizar linting.
- [ ] Homogeneizar formato.

---

# 30. Fase 26 — Performance

**Prioridad: media-alta**

## Web

- [ ] Lazy routes.
- [ ] Lazy components pesados.
- [ ] Bundle analysis.
- [ ] Reducir JS inicial.
- [ ] Optimizar consultas Supabase.

## Mobile

- [ ] Reducir renders.
- [ ] Virtualización.
- [ ] Lazy load.
- [ ] Optimizar SQLite.
- [ ] Evitar cargar modelo IA innecesariamente.
- [ ] Controlar memoria llama.rn.
- [ ] Liberar contextos LLM.
- [ ] Medir batería.

---

# 31. Fase 27 — Control de costo global

**Prioridad: crítica**

Crear panel:

```text
Cost Center OfirOne
```

Medir:

- [ ] Supabase.
- [ ] IA.
- [ ] Resend.
- [ ] Mercado Pago.
- [ ] Storage.
- [ ] Egress.
- [ ] Functions.
- [ ] Builds.
- [ ] Servicios externos.

Por tenant:

```text
ingreso mensual
-
costo variable
=
margen bruto
```

---

# 32. Fase 28 — Política de IA por plan

**Prioridad: media**

Evitar subsidio ilimitado de cloud AI.

Ejemplo:

## Basic

- [ ] Determinístico.
- [ ] IA local.
- [ ] Cloud limitado.

## Pro

- [ ] Mayor cuota cloud.
- [ ] OCR avanzado.
- [ ] Insights.

## Enterprise

- [ ] Cuotas personalizadas.
- [ ] Modelos especiales opcionales.

---

# 33. Fase 29 — Modo ahorro

Crear configuración:

```text
AI Cost Mode
```

Modos:

- [ ] `local_only`.
- [ ] `economy`.
- [ ] `balanced`.
- [ ] `quality`.

### local_only

```text
cache
→ deterministic
→ local LLM
→ usuario
```

### economy

```text
cache
→ deterministic
→ local LLM
→ modelo cloud barato
```

### balanced

```text
cache
→ deterministic
→ local LLM
→ cloud router
```

### quality

Solo para casos donde negocio justifique mayor costo.

---

# 34. Fase 30 — Alertas de costo

- [ ] Alerta 50% presupuesto.
- [ ] Alerta 75%.
- [ ] Alerta 90%.
- [ ] Alerta 100%.
- [ ] Activar modo economy automáticamente.
- [ ] Posibilidad de activar local-only.

---

# 35. Hoja de ruta — foco: Backend Gateway + Core Sync Engine

> **Foco declarado (revisión 2026):** prioridad a **operar el Backend Gateway** y a
> construir el **Core Sync Engine compartido** (`shared/sync`, mobile-first y preparado
> para Desktop). Motivos: (1) el backend ya está codificado pero sin hosting/CI/consumidores
> → su valor es latente; (2) el sync actual solo cubre ventas offline con push → bloquea la
> promesa comercial "OfirOne sigue vendiendo aunque Internet se caiga" y a Desktop;
> (3) la medición IA del Sprint 1 quedó casi cerrada, y el resto de IA/costos pasa a un
> **track posterior o paralelo** (no bloquea Backend + Sync).
>
> Convención de estado: `[x]` implementado y verificado · `[~]` parcial · `[ ]` pendiente
> (evidencia en `docs/EVALUACION_PLAN_MEJORAS.md`; métricas IA en `docs/IA_METRICAS.md`).
> Las fases 0-34 siguen siendo el backlog detallado por feature; esta sección es la
> **fuente de verdad de ejecución**.

---

## Núcleo A — Backend Gateway operativo (fases 14A, 15AA, 15AB)

### A1. Puesta en producción
- [~] Elegir hosting y desplegar el backend (`backend/`, Node ≥20 HTTP nativo) con dominio/URL estable. **Avance**: despliegue preparado — `backend/Dockerfile` (contexto raíz, incluye `shared/`), `backend/.dockerignore`, workflow `deploy-backend.yml` (test + imagen GHCR con deploy comentado) y guía `docs/BACKEND_DEPLOYMENT.md` (variables, healthcheck, worker, opciones de hosting). **Pendiente**: elegir plataforma y activar el deploy. **Opción lista: Cloudflare Workers para el gateway** (`backend/src/cloudflare/worker-entry.js` + `backend/wrangler.toml`, sin `node:http`/`Buffer`; `npx wrangler deploy`). El worker de colas (imports/media con `xlsx`) se mantiene en runtime Node: **opción Google Cloud Run Jobs + Cloud Scheduler** (gratis/low-cost, `worker --once` con scale-to-zero) → `docs/GOOGLE_CLOUD_RUN_DEPLOY.md` con `cloudbuild.yaml` + `scripts/deploy-gcp.sh` (crea service gateway + job worker + Cloud Scheduler de un tirón) + workflow `.github/workflows/deploy-cloudrun.yml` (requiere secrets: `GCP_SA_KEY`, `GCP_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`). Alternativa sin GCP: GitHub Actions cron (`worker --once`).
- [x] CI del backend (job `backend`: `npm ci` + `npm test`) y job `shared-js` (`node --test`) en `.github/workflows/ci.yml`. Build/smoke de healthcheck quedan para el despliegue (A1).
- [ ] Decidir destino de las Edge Functions (mantener como workers o migrar al backend) y documentar secretos.
- [ ] Activar flags `VITE_USE_BACKEND_*` por entorno controlado (hoy default OFF y ausentes en `.env` real).
- [ ] Definir estándar de sesiones/JWT (hoy: validación contra `/auth/v1/user`) y versionado de API.

### A2. Endurecimiento del gateway
- [x] Payload de error HTTP con `domain/operation/retryable/status` (+ `details` si aplica) en `errorResponse`; el 404 genérico ya incluye `correlationId`. Tests cubren el estándar completo.
- [x] Rate limiting en memoria por cliente (`createRateLimiter`, ventana fija, 429 + `retry-after`, exento `/health` y OPTIONS) y límite de body (`MAX_BODY_BYTES`, 413 `PAYLOAD_TOO_LARGE`) + JSON inválido → 400 `VALIDATION_ERROR`. Inyectable para tests.
- [ ] Observabilidad: consumir `GET /async-jobs/backlog` y `history` en una vista soporte/admin.
- [ ] Correlación productiva (`x-correlation-id` en cliente → backend → worker → DB).
- [~] Migraciones: resuelta la divergencia de `ADD_ASYNC_JOB_QUEUE.sql` (symlinks añadidos; `sync-shared-supabase.sh check` en verde). Pendiente: validar orden de aplicación en el checker.

### A3. Contratos por dominio crítico (fase 18A)
- [~] Extender el patrón piloto `lookups` (contrato + adapters + flag + fallback) a: ventas, pagos, inventario, compras, cartera y sync. **Avance**: contratos base en `shared/contracts/domainContracts.js` (con tests) + **primeros endpoints de dominio en el backend**: `GET /customers` y `GET /inventory/stock-balances` (JWT, RLS del usuario, `count=exact` vía Content-Range, filtros `location_id/variant_id/low_stock/search`, paginación) con repositorios `customers.repository.js`/`inventory.repository.js` y tests (backend 38 ✓). **Primer adapter web por dominio**: `web/src/services/backendCustomersClient.js` + flag `VITE_USE_BACKEND_CUSTOMERS` — el listado de **Clientes** (`customers.service.getCustomers`) usa `GET /customers` si el flag está activo, con **fallback a Supabase directo** si falla; `_mapThirdPartyToCustomer` se reutiliza. Tests del cliente (4) y web 330 ✓. **Clientes de dominio listos**: `web/src/services/backendDomainClient.js` con `listBackendSales/listBackendPurchases/listBackendStockBalances` (token + paginación + filtros opcionales, devuelven `{data,total}`) y 5 tests (web 335 ✓). **Inventario cableado**: `inventory.service.getStockBalances` usa `listBackendStockBalances` con flag `VITE_USE_BACKEND_INVENTORY` + fallback a Supabase (el backend replica el mismo `select` con joins → mismo shape). Web 335 ✓ + build ✓. Pendiente: cablear sales/purchases (mismo patrón) y endpoints de escritura. **El piloto lookups quedó alcanzable desde la UI**: el wizard de terceros ahora carga los tipos de documento vía `lookupsService` (`ThirdPartyWizardDialog.vue`), con fallback a la constante — con `VITE_USE_BACKEND_LOOKUPS=true` se ve `GET /lookups/document-types` hacia el gateway. Nota: `ThirdPartyForm.vue` (formulario clásico) no tiene consumidores → candidato a limpieza (Fase 25).
- [ ] Evitar que pantallas conozcan tablas/RPC/EF; documentar payloads y errores.
- [ ] Rollback por dominio con feature flag (default Supabase directo hasta validar backend).

### A4. Cerrar stubs y consolidar colas (fase 15AA)
- [~] Media sin procesador falla rápido y sin reintentos (código `MEDIA_HANDLER_NOT_IMPLEMENTED`, `retryable=false` → no agota intentos hasta dead-letter). Pendiente: implementar los 4 procesadores (lista precios, inventario físico, pedido manuscrito, doc. soporte).
- [x] Colas `ai_jobs` y `report_jobs` retiradas de `workerQueues` por defecto (solo `import_jobs,media_processing`); si se activan por config, fallan rápido con `AI_HANDLER_NOT_IMPLEMENTED`/`REPORT_HANDLER_NOT_IMPLEMENTED` (`retryable=false`). Tests cubren el fail-fast.
- [ ] Consolidar `notification_outbox` y `accounting_event_queue`.

### A5. Consumir los flujos migrados (fase 15AB)
- [x] Consumir drafts de media/import desde la UI. **Ver borrador** en el historial de `BulkImports` (jobs `draft_ready`: filas, proveedor, advertencias, OCR) + **\"Usar en compra\"** para factura: lleva el draft a Compras (`purchaseDraftBridge`, sessionStorage) y `Purchases.vue` lo aplica reutilizando `matchInvoiceLinesToCatalog → buildPurchaseLinesFromInvoiceMatches → mergeInvoiceLinesIntoDraft` + `maybeAutofillSupplierFromInvoice`. Web 337 ✓ + build ✓.
- [ ] Migrar por dominio: facturación electrónica, webhooks de pagos, notificaciones, batch/importaciones.
- [ ] Optimizar imagen antes de enviar a la EF desde el worker (hoy envía el original).
- [ ] Aislar/sustituir `xlsx@0.18.5` (vulnerabilidad alta sin fix, en backend y web legacy).

---

## Núcleo B — Core Sync Engine compartido (fases 15, 15A, 19F)

Objetivo: **un solo motor** en `shared/sync`, mobile-first, reutilizable por Desktop (Tauri) y web.

### B0. Estructura del paquete compartido (fase 15A.1)
- [~] Reorganizar `shared/sync/` en `core/ queue/ conflict/ transport/ mapping/ idempotency/ policies/` conservando la API existente (`syncContract`, `retryPolicy`) y sus tests. **Avance**: `shared/sync/core/outboxState.js` como fuente única de estados canónicos (mapeo legacy, pendientes/terminales, dead-letter, `error_code`) + `syncContract.js` re-exporta desde `core/`; tests en `core/outboxState.test.js`. Pendiente: mover el resto y crear `queue/ conflict/ transport/ mapping/ idempotency/ policies/`.
- [ ] Contratos de transporte y políticas por entidad independientes de UI y de Supabase.

### B1. Outbox canónico real (fase 15A.2)
- [~] Outbox SQLite para ventas existe (columna canónicas + índice de `idempotency_key`).
- [~] Persistir estados `pending/processing/synced/conflict/failed/dead_letter` reales. **Avance**: el storage SQLite nativo (y su mirror web) ya persiste estados canónicos (`pending/processing/synced/failed/dead_letter`), con migración idempotente de estados legacy en `initOfflineDatabase` y normalización en lecturas (`normalizeOutboxStatus`). `conflict` sigue sin productor (pendiente en B5).
- [x] Escribir `error_code` en cada fallo (códigos explícitos `MAX_RETRIES_REACHED`/`UNSUPPORTED_OP_TYPE` desde sync.service y derivación `BLOCKED`/`SYNC_FAILED` en storage).
- [~] Manejar duplicados en el enqueue. **Avance**: dedupe por `idempotency_key` + `INSERT OR IGNORE` como red de seguridad (devuelve `duplicate: true` si no insertó).
- [~] Mover operaciones no recuperables a `dead_letter` con razón y vista de "bloqueadas". **Avance**: storage escribe `dead_letter` para errores `NO_RETRY:`; `getAllQueuedOps` las incluye como bloqueadas y el modal muestra el `error_code` como chip visible (razón).
- [x] Migración SQLite tolerante para instalaciones existentes (`migratePendingOpsStatuses`, idempotente).

### B2. Pull incremental (fase 15A.4)
- [x] Checkpoint persistente (tabla `sync_state` ya existe) + cursor por entidad (`updated_at`/versión): módulo puro `shared/sync/core/pullState.js` + motor `shared/sync/pull/pullDriver.js` (`runIncrementalPull`: full→incremental, lotes paginados, persiste checkpoint, cortes de seguridad `max_batches`/`no_cursor_progress`/`cursor_stalled`), agnóstico del transporte, con tests.
- [~] Descargar solo cambios posteriores al último checkpoint, en lotes paginados: el motor ya lo hace contra un transporte inyectado; falta conectarlo al transporte real de catálogo (Supabase RPC/query con `updated_at > cursor`) y al warm.
- [ ] Reanudación tras cierre inesperado (el checkpoint se persiste por entidad; verificar reanudación end-to-end).
- [ ] Reemplazar la redescarga de snapshots completos (`warmPosCatalog` 2000, clientes 5000, pricing cada 5 min).

### B3. Catálogo local (fase 15.1, 15A.12)
- [~] Almacén local de catálogo: tabla `local_catalog` (PK `tenant_id+entity_type+entity_id`, `updated_at`, `payload` JSON, `fetched_at`) + `upsertLocalCatalogRows`, `listLocalCatalogSince`, `countLocalCatalog`, `clearLocalCatalog` en storage SQLite nativo y mirror web (paridad). Pendiente: mapear los catálogos reales (productos/variantes/precios/clientes/config POS/métodos de pago) a filas y usarlo en el warm + lecturas offline.
- [ ] Warm selectivo (activos/vigentes/recientes); evitar logs históricos y reportes pesados.
- [ ] Consultas offline con paridad de comportamiento online.

### B3. Catálogo local (fase 15.1, 15A.12)
- [ ] Tablas locales: productos, variantes, precios, clientes frecuentes, configuración POS, métodos de pago.
- [ ] Warm selectivo (activos/vigentes/recientes); evitar logs históricos y reportes pesados.
- [ ] Consultas offline con paridad de comportamiento online.

### B4. Push multi-entidad + inventario por movimientos (fase 15A.5/8)
- [ ] Handlers: pagos/abonos, movimientos de inventario, retornos (hoy solo `CREATE_SALE`).
- [ ] Registro de movimientos desde el cliente y recálculo server-side; detectar overselling; alertas de reconciliación.
- [ ] Priorizar operaciones críticas; no bloquear la cola por una operación fallida.

### B5. Conflictos por entidad (fase 15A.9)
- [ ] Productos: server-wins para configuración administrativa sensible + detección de cambios simultáneos.
- [ ] Clientes: merge cuando sea seguro + reglas de duplicados.
- [ ] Ventas: append-only; nunca sobrescribir ventas confirmadas.
- [ ] Inventario: basado en movimientos (nunca last-write-wins genérico).
- [ ] Precios: versión/vigencia y precio usado registrado en la venta.

### B6. Estado visible y multi-dispositivo (fase 15A.10/13)
- [ ] Indicador global de última sincronización y contador de conflictos (hoy solo chip online/offline + modal de cola).
- [ ] `device_id`/`device_name`, versión de app, último sync; revocación y detección de dispositivos obsoletos.

### B7. Transporte desacoplado (fase 15A.1, 19F)
- [ ] Adapter Supabase (hoy RPC directo `sp_create_sale_idempotent`).
- [ ] Adapter backend gateway (cola `sync_outbox` en `async_jobs`) como alternativa cuando el backend esté operativo (A1).
- [ ] Preparar adapters React Native / Tauri para Desktop sin duplicar el motor.

### B8. Tests de durabilidad del Sync (fase 15A.15)
- [x] Retry/backoff e idempotencia de venta (tests existentes).
- [ ] Duplicados por `idempotency_key`, pérdida/reconexión, orden de dependencias, conflictos, sync parcial, crash durante sync, dos dispositivos, overselling.

---

## Orden de ejecución (secuencia única)

1. **A1-A2**: Backend en producción + endurecimiento (no depende de Sync; puede iniciar ya).
2. **B0-B2**: estructura `shared/sync` + outbox canónico + pull incremental.
3. **B3-B4**: catálogo local + push multi-entidad (inventario por movimientos).
4. **B5-B6**: conflictos + estado visible + multi-dispositivo.
5. **A3-A5** (en paralelo con B): contratos por dominio, consumo de drafts, cierre de stubs.
6. **B7-B8**: transporte desacoplado (backend como opción) + tests de durabilidad.
7. **Puerta Desktop MVP**: requiere avance de B (B1-B4 + parte B5), A3 (contratos) y la modularización web (fases 11-13). Luego Desktop avanzado (fases 15B-15F, 19B-19F).
8. **Track IA posterior/paralelo** (no bloquea lo anterior): restos del Sprint 1 (fixtures + harness del dataset, consumo de correcciones → aliases), determinístico + aliases + retrieval (fases 2-5), control de costo IA por tenant (fases 7.3, 28-30), router de modelos.
9. **SaaS / seguridad / calidad continua** (fases 16-30): CI completo, tests RLS/cross-tenant, auditoría `SECURITY DEFINER`, cost center, feature flags por plan, limpieza técnica y documentación.

> La medición IA ya avanzada (Sprint 1: costo real, confidence, corrección manual con emisor POS, replay, dashboard con RPC server-side, CAR y dataset base) queda disponible para el track 8.

---

# 36. Definition of Done global

Una mejora se considera terminada cuando:

- [ ] Tiene tests.
- [ ] Tiene métricas.
- [ ] Tiene manejo de errores.
- [ ] Respeta multi-tenant.
- [ ] Respeta offline cuando aplica.
- [ ] No expone secretos.
- [ ] Tiene documentación mínima.
- [ ] Pasa CI.
- [ ] No incrementa cloud AI sin justificación.
- [ ] Puede medir su impacto en costo.
- [ ] Si opera offline, soporta reintentos e idempotencia.
- [ ] Si sincroniza datos, define política de conflictos.
- [ ] Si afecta desktop/mobile, evita duplicar lógica compartible.
- [ ] Tiene pruebas de pérdida y recuperación de conectividad cuando aplique.

---

# 37. Objetivo final

La arquitectura de OfirOne debe lograr que la gran mayoría de operaciones inteligentes sigan este camino:

```text
usuario
 ↓
cache
 ↓
determinístico
 ↓
resultado
```

Y solamente los casos difíciles:

```text
usuario
 ↓
cache MISS
 ↓
determinístico insuficiente
 ↓
IA local insuficiente
 ↓
IA cloud
```

La IA cloud debe convertirse en una **excepción medible**.

La meta no es eliminarla, sino utilizarla únicamente donde su valor sea superior a su costo.


---

# 38. Objetivo estratégico Desktop + Offline

OfirOne debe poder operar con la siguiente propuesta:

> **OfirOne sigue vendiendo aunque Internet se caiga.**

Arquitectura final deseada:

```text
                         Supabase
                            │
                            ▼
                     Sync Engine
                       compartido
                      /          \
                     /            \
              Mobile SQLite    Desktop SQLite
                   │                 │
              React Native       Vue + Tauri
```

Principios:

- [ ] La web sigue siendo cloud-first.
- [ ] Mobile es offline-first.
- [ ] Desktop es offline-first.
- [ ] Mobile y Desktop comparten el mismo modelo de sincronización.
- [ ] Desktop reutiliza la UI Vue en la mayor medida posible.
- [ ] No crear tres implementaciones independientes del negocio.
- [ ] IA cloud sigue siendo último recurso.
- [ ] IA local desktop debe aprovechar mayor capacidad del PC.
- [ ] Hardware POS debe estar desacoplado de UI.
- [ ] Las ventas offline deben ser idempotentes y auditables.

El activo estratégico no será solamente la aplicación desktop.

Será:

```text
Shared Domain
+
Shared Sync Engine
+
Offline Data Model
+
Local AI
```

Esto permitirá reutilizar la misma base tecnológica en futuros clientes, cajas, terminales y escenarios de conectividad limitada.
