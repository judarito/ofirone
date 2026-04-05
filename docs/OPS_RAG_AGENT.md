# OPS RAG Agent

Fecha: 2026-04-04
Estado: base operativa inicial

## Objetivo

Exponer una sola Edge Function reusable desde mobile y web para consultas operativas en lenguaje natural, grounded en datos reales del tenant.

No es un chat general. Es un `RAG operativo`:

1. enruta la consulta por dominio
2. recupera contexto SQL real del tenant
3. llama al modelo solo con ese contexto
4. responde con citas a bloques recuperados

## Function

- Nombre sugerido de deploy: `ops-rag-agent`
- Archivo: `supabase/functions/ops-rag-agent/index.ts`

## Dominios iniciales soportados

- `sales`
- `inventory`
- `purchases`
- `cash`
- `portfolio`
- `production`

## Fuentes de datos actuales

- `sales`, `sale_lines`
- `stock_balances`, `inventory_moves`, `inventory_batches`
- `purchases`
- `cash_sessions`, `cash_movements`
- `customer_credit_accounts`, `customer_credit_movements`
- `production_orders`
- `locations`
- `users`

## Contrato de entrada

```json
{
  "tenant_id": "uuid|null",
  "query": "como van las ventas y el inventario de la sede centro",
  "domains": ["sales", "inventory"],
  "from_date": "2026-04-01",
  "to_date": "2026-04-04",
  "location_id": null,
  "location_name": "Sede Centro",
  "include_debug": false,
  "max_items_per_block": 5,
  "use_cache": true
}
```

Notas:

- `tenant_id` es opcional si el usuario autenticado pertenece a un solo tenant.
- `domains` es opcional. Si no llega, la function intenta inferirlos desde la consulta.
- `from_date` y `to_date` son opcionales. Si no llegan, la function intenta inferir un rango simple desde el texto.
- `location_id` y `location_name` son opcionales. Si no llegan, la function intenta resolver sede por nombre dentro de la consulta.

## Contrato de salida

```json
{
  "success": true,
  "data": {
    "answer": "Ventas estables, pero inventario con riesgo en 3 referencias.",
    "summary": "Ventas bien, inventario con alertas.",
    "clarifying_question": null,
    "suggested_actions": [
      "Revisar productos sin disponible.",
      "Validar reposicion de referencias criticas."
    ],
    "citations": ["sales_summary", "inventory_stock_risks"],
    "confidence": 0.82,
    "domains": ["sales", "inventory"],
    "filters": {
      "tenant_id": "uuid",
      "location_id": "uuid|null",
      "location_name": "string|null",
      "range": {
        "fromDate": "2026-04-01",
        "toDate": "2026-04-04",
        "fromIso": "2026-04-01T00:00:00.000Z",
        "toIso": "2026-04-04T23:59:59.999Z",
        "label": "rango explicito",
        "source": "body"
      }
    },
    "retrieval_errors": [],
    "retrieved_context": [
      {
        "block_id": "sales_summary",
        "domain": "sales",
        "title": "Resumen de ventas",
        "source": "public.sales",
        "rows_count": 42
      }
    ],
    "model": "deepseek-chat",
    "usage": {},
    "cache_hit": false
  }
}
```

## Cache

Migracion incluida:

- `migrations/ADD_OPS_RAG_AGENT_CACHE.sql`

Tabla:

- `public.ops_ai_query_cache`

Uso:

- cachea por `tenant + query_hash`
- la respuesta cacheada ya viene lista para ser reutilizada por mobile/web
- la lectura/escritura se hace desde la Edge Function con `service role`

## Secrets requeridos

```bash
supabase secrets set DEEPSEEK_API_KEY=tu_api_key --project-ref <project-ref>
```

Opcionales:

```bash
supabase secrets set OPS_RAG_AGENT_MODEL=deepseek-chat --project-ref <project-ref>
supabase secrets set OPS_RAG_AGENT_CACHE_TTL_HOURS=6 --project-ref <project-ref>
```

## Deploy

```bash
supabase functions deploy ops-rag-agent --project-ref <project-ref>
```

## Consumo desde app mobile

Servicio incluido:

- `src/services/opsRagAgent.service.js`

Ejemplo:

```js
import { askOpsRagAgent } from '../services/opsRagAgent.service';

const result = await askOpsRagAgent({
  tenantId,
  query: 'como va la cartera y las ventas de esta semana',
  domains: ['portfolio', 'sales'],
  includeDebug: true,
});
```

## Prueba desde UI mobile

Pantalla disponible:

- `Centro IA`

Flujo:

1. Inicia sesion con un usuario del tenant.
2. Entra a `Centro IA`.
3. Usa la tarjeta `Agente operativo RAG`.
4. Opcionalmente marca uno o varios dominios.
5. Escribe una consulta como `como van las ventas e inventario de la sede centro esta semana`.
6. Presiona `Preguntar al agente`.

Validaciones esperadas:

- respuesta en lenguaje natural
- acciones sugeridas
- citas (`block_id`)
- bloques de contexto recuperado
- dominios y filtros aplicados
- indicador de `cache`

## Consumo desde web

La web puede invocarla con el mismo body via:

- `supabase.functions.invoke('ops-rag-agent', { body })`

o por HTTP directo enviando:

- `Authorization: Bearer <jwt>`
- `Content-Type: application/json`

## Alcance actual

Esta primera version no hace:

- generacion de SQL libre desde LLM
- escritura transaccional
- acciones automáticas sobre ventas/inventario/compras
- embeddings/vector store
- retrieval de documentos largos fuera de la base operativa

## Siguiente evolucion recomendada

1. Agregar `knowledge blocks` documentales para reglas de negocio y setup.
2. Agregar `follow-up memory` por sesion de chat.
3. Crear `playbooks` accionables por dominio.
4. Unificar este agente con reportes, insights y soporte contextual de POS.
