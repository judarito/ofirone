export const OPS_DOMAIN_OPTIONS = [
  { id: 'sales', label: 'Ventas' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'purchases', label: 'Compras' },
  { id: 'cash', label: 'Caja' },
  { id: 'portfolio', label: 'Cartera' },
  { id: 'production', label: 'Produccion' },
]

export const AI_INSIGHT_QUICK_ACTIONS = [
  {
    id: 'sales-pulse',
    title: 'Pulso de ventas',
    subtitle: 'Resumen ejecutivo de ventas y tickets.',
    icon: 'mdi-chart-line',
    color: 'primary',
    domains: ['sales'],
    prompt: 'Resume el comportamiento reciente de ventas, ticket promedio y señales de oportunidad.',
  },
  {
    id: 'inventory-alerts',
    title: 'Inventario en riesgo',
    subtitle: 'Stock bajo, sobrestock y rotacion.',
    icon: 'mdi-package-variant-closed-alert',
    color: 'warning',
    domains: ['inventory'],
    prompt: 'Detecta productos con riesgo de quiebre o sobrestock y explica las causas.',
  },
  {
    id: 'purchase-focus',
    title: 'Compras sugeridas',
    subtitle: 'Que deberiamos comprar primero.',
    icon: 'mdi-cart-arrow-down',
    color: 'deep-purple',
    domains: ['purchases', 'inventory'],
    prompt: 'Prioriza compras urgentes y explica impacto operativo y financiero.',
  },
  {
    id: 'cash-check',
    title: 'Salud de caja',
    subtitle: 'Sesiones, diferencias y focos rojos.',
    icon: 'mdi-cash-register',
    color: 'success',
    domains: ['cash'],
    prompt: 'Resume el estado de cajas, diferencias detectadas y acciones sugeridas.',
  },
  {
    id: 'portfolio-watch',
    title: 'Cartera y cobro',
    subtitle: 'Saldos vencidos y seguimiento.',
    icon: 'mdi-account-cash-outline',
    color: 'secondary',
    domains: ['portfolio'],
    prompt: 'Resume cartera vencida, clientes con mayor saldo y acciones de cobro sugeridas.',
  },
  {
    id: 'production-watch',
    title: 'Produccion',
    subtitle: 'Ordenes, cuellos de botella y avance.',
    icon: 'mdi-factory',
    color: 'teal',
    domains: ['production', 'inventory'],
    prompt: 'Resume estado de produccion, insumos criticos y cuellos de botella.',
  },
]

export function resolveAiQuickAction(actionId) {
  return AI_INSIGHT_QUICK_ACTIONS.find((item) => item.id === actionId) || null
}

export function normalizeOpsInsightResult(result = {}) {
  const parsedConfidence = Number(result?.confidence)
  return {
    answer: String(result?.answer || result?.summary || 'Sin respuesta disponible.').trim(),
    summary: String(result?.summary || '').trim(),
    clarifyingQuestion: result?.clarifying_question ? String(result.clarifying_question).trim() : null,
    suggestedActions: (Array.isArray(result?.suggested_actions) ? result.suggested_actions : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    citations: Array.isArray(result?.citations) ? result.citations : [],
    domains: (Array.isArray(result?.domains) ? result.domains : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    filters: result?.filters || null,
    retrievedContext: Array.isArray(result?.retrieved_context) ? result.retrieved_context : [],
    retrievalErrors: Array.isArray(result?.retrieval_errors) ? result.retrieval_errors : [],
    model: result?.model ? String(result.model) : null,
    cacheHit: result?.cache_hit === true,
    confidence: Number.isFinite(parsedConfidence) ? parsedConfidence : null,
  }
}
