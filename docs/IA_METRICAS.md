# Métricas IA de OfirOne — definición auditable (Sprint 1)

> Objetivo: que el **Cloud Avoidance Rate (CAR)**, el **costo por operación** y el
> **dataset de regresión** tengan definiciones operativas únicas, auditables contra
> `ai_telemetry_events`, y dueños de dato. Complementa las secciones 2 (KPI) y 36
> (DoD) de `docs/OFIRONE_PLAN_MEJORAS.md`.

---

## 1. Cloud Avoidance Rate (CAR) — fórmula auditable

```text
operaciones resueltas SIN cloud
CAR = ──────────────────────────── × 100
      operaciones inteligentes totales
```

### 1.1 Definición de "operación inteligente"
Una operación inteligente = **un evento de `ai_telemetry_events`** que cumpla:

- `feature` ∈ {`command_engine_sale`, `command_engine_report`, `invoice_ocr_text`,
  `invoice_ocr_image`, `product_photo_parser`, `ops_rag_agent`, `purchase_advisor`,
  `sales_forecast`, `chat_order_sale`, …} (catálogo central, no textos).
- `resolution_source` ∈ fuentes normalizadas de la sección 4.2 del plan.
- Se **excluyen** del denominador los eventos de diagnóstico/corrección:
  `command_engine_sale_correction` (`manual_resolution`) no es una operación nueva.

### 1.2 Definición de "resuelta sin cloud"
Un evento cuenta como **sin cloud** si su `resolution_source` ∈
{`local_cache`, `deterministic_parser`, `local_llm`, `local_ocr`, `manual_resolution`}.
Cuenta como **cloud** si `resolution_source = cloud_llm`.

Reglas de auditoría:
- Un HIT de caché proveniente de una resolución cloud previa cuenta como **sin cloud**
  (no hubo llamada ni costo nuevo). Se audita con `fallback`/`engine.source` si se requiere el detalle.
- Un fallback que terminó en cloud (ej. `native_low_score → cloud`) cuenta como cloud.
- Un evento fallido (`success = false`) **no** cuenta como resuelta (ni en numerador ni denominador
  de "resuelta"); se reporta por separado como tasa de error.

### 1.3 Ventanas y cortes
- Global (rolling 7/30 días) y **por feature** y **por vertical** cuando exista el campo.
- Metas: global ≥ 80% (primer hito), ≥ 90% (segundo), **POS rutinario ≥ 95%**.
- El corte POS rutinario = `feature = command_engine_sale` + `input_type IN (text, voice)`
  (excluye imagen/OCR de la meta POS).

### 1.4 SQL de referencia
```sql
WITH scope AS (
  SELECT resolution_source, success
  FROM ai_telemetry_events
  WHERE tenant_id = :tenant
    AND occurred_at >= now() - interval '30 days'
    AND feature <> 'command_engine_sale_correction'
),
resolved AS (
  SELECT * FROM scope WHERE success AND resolution_source <> 'unknown'
)
SELECT
  count(*) FILTER (WHERE resolution_source NOT IN ('cloud_llm'))::numeric
    / NULLIF(count(*), 0) * 100 AS cloud_avoidance_rate,
  count(*) FILTER (WHERE resolution_source = 'cloud_llm') AS cloud_events,
  count(*) AS resolved_events
FROM resolved;
```

### 1.5 Dueño y frecuencia
- **Dueño del dato**: equipo producto/backend (rol fijo) — responsable de que las metas
  se calculen sobre esta definición y de revisar desviaciones cada semana.
- **Frecuencia de cálculo**: diaria (job) + vista en vivo en el dashboard interno.

---

## 2. Costo por operación (auditable)

- `costo = SUM(estimated_cost)` de eventos cloud; `estimated_cost` se calcula con
  `shared/utils/aiCostEstimator.js` (tokens reales del `usage` de la EF, tasas por modelo).
- Métricas: costo/1.000 operaciones inteligentes, costo por venta (con el corte del punto 1),
  costo por tenant/mes. Agregación server-side: `fn_ai_telemetry_cost_summary`.

---

## 3. Dataset de regresión — esquema base

Ubicación futura sugerida: `shared/ai/dataset/*.jsonl` (anonimizado). Un registro:

```jsonc
{
  "id": "r0001",
  "input_text": "dos coca colas y una bolsa",
  "input_type": "text",               // text | voice | ocr
  "vertical": "POS_RETAIL",
  "source": "real_anonymized",        // real_anonymized | vosk | ocr | synthetic
  "tags": ["quantity", "plural", "typo"],   // typo | homophone | variant | color | size | ambiguous | no_match | multilingual
  "expected_intent": "add_product",   // add_product | remove_product | modify_qty | clear_cart | other
  "expected_customer_name": null,
  "expected_notes": null,
  "expected_products": [
    { "product_name": "Coca-Cola 1.5L", "product_id": null, "sku": null,
      "quantity": 2, "unit_hint": null }
  ],
  "expected_resolution_layer": "deterministic",  // cache | deterministic | local_llm | cloud | none
  "corrected_from": null               // llenar cuando el dataset sale de una corrección manual
}
```

Reglas:
- No incluir PII ni datos sensibles; los comandos reales se anonimizan antes de incorporarse.
- Cada corrección manual registrada en `ai_telemetry_events` (columna `corrected_payload`)
  es candidata a generar un registro con `source = real_anonymized` + `corrected_from`.

### Ejemplos sintéticos base (arranque)

| input_text | input_type | expected_intent | expected_resolution_layer |
|---|---|---|---|
| "dos cocacolas" | text | add_product | deterministic (tras alias) |
| "coca grande x2" | text | add_product | local_llm → cache |
| "quita la gaseosa" | text | remove_product | local_llm |
| "vacia el carrito" | text | clear_cart | local_llm |
| "una talla M de la camisa azul" | text | add_product (variante) | local_llm + variante |
| "dame 3 arroz y 2 frijol" | voice (Vosk) | add_product | local_llm |
| "bolsa de 5 kilos de arroz diamante" | ocr | add_product | cloud (con OCR) |
| "comprame algo raro sin nombre" | text | add_product sin match | none (requiere intervención) |

> Estado: **esquema + ejemplos base** (este documento). Pendiente: fixtures reales
> anonimizados, harness de ejecución contra parser determinístico / LLM local /
> modelo cloud (económico y superior) y reporte de precisión por capa (Fase 10 del plan).
