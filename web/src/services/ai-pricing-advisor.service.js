import AICacheManager from '../utils/aiCache.js'
import { supabase } from '@/plugins/supabase'

const DEEPSEEK_MODEL = 'deepseek-chat'
const AI_EDGE_FUNCTION = 'deepseek-proxy'
const CACHE_TTL_HOURS = 12

class AIPricingAdvisorService {
  isAvailable() {
    return true
  }

  async getPricingSuggestions(tenantId, options = {}) {
    const cfg = {
      targetMargin: Number(options.targetMargin || 35),
      minMargin: Number(options.minMargin || 15),
      maxMargin: Number(options.maxMargin || 60),
      locationId: options.locationId || null,
      maxItems: Number(options.maxItems || 100),
      useAI: options.useAI !== false,
      forceRefresh: Boolean(options.forceRefresh)
    }

    const cacheKey = AICacheManager.generateKey('pricing', tenantId, cfg)
    if (!cfg.forceRefresh) {
      const cached = AICacheManager.get(cacheKey)
      if (cached) {
        return { ...cached, from_cache: true }
      }
    }

    const rows = await this._loadRotationData(tenantId, cfg)
    const suggestions = this._buildRuleBasedSuggestions(rows, cfg)
    let insights = this._buildDefaultInsights(suggestions, cfg)

    if (cfg.useAI && suggestions.length > 0) {
      try {
        const aiInsights = await this._getAIInsights(suggestions, cfg)
        if (Array.isArray(aiInsights) && aiInsights.length > 0) {
          insights = aiInsights
        }
      } catch (error) {
        // Keep deterministic suggestions even if AI fails.
        console.warn('AI pricing insights unavailable:', error.message)
      }
    }

    const result = {
      generated_at: new Date().toISOString(),
      filters: cfg,
      summary: this._buildSummary(suggestions),
      suggestions,
      insights
    }

    AICacheManager.set(cacheKey, result, CACHE_TTL_HOURS)
    return { ...result, from_cache: false }
  }

  async _loadRotationData(tenantId, cfg) {
    let query = supabase
      .from('vw_inventory_rotation_analysis')
      .select(`
        tenant_id,
        variant_id,
        product_id,
        product_name,
        variant_name,
        sku,
        current_stock,
        sold_last_30d,
        days_of_stock_remaining,
        trend_percentage,
        avg_daily_demand,
        unit_cost,
        unit_price
      `)
      .eq('tenant_id', tenantId)
      .order('sold_last_30d', { ascending: false })
      .limit(cfg.maxItems)

    if (cfg.locationId) {
      // The view is consolidated; keep this parameter for future location-specific view.
      void cfg.locationId
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data || []
  }

  _buildRuleBasedSuggestions(rows, cfg) {
    const filtered = rows.filter((row) => Number(row.unit_cost || 0) > 0 && Number(row.unit_price || 0) > 0)
    const mapped = filtered.map((row) => this._mapSuggestion(row, cfg))
    return mapped
      .filter((item) => item.action !== 'KEEP')
      .sort((a, b) => b.impact_score - a.impact_score)
      .slice(0, cfg.maxItems)
  }

  _mapSuggestion(row, cfg) {
    const cost = Number(row.unit_cost || 0)
    const price = Number(row.unit_price || 0)
    const sold30 = Number(row.sold_last_30d || 0)
    const rawStockDays = row.days_of_stock_remaining == null ? null : Number(row.days_of_stock_remaining)
    const trend = Number(row.trend_percentage || 0)
    const avgDailyDemand = Number(row.avg_daily_demand || 0)
    const marginNow = price > 0 ? ((price - cost) / price) * 100 : 0
    const stockDaysMeta = this._normalizeStockDays(rawStockDays, sold30, avgDailyDemand)
    const stockDays = stockDaysMeta.value

    let suggestedMargin = marginNow
    let action = 'KEEP'
    let reason = 'Margen y rotacion estables'

    if (sold30 <= 0 && (stockDays == null || stockDays > 45)) {
      suggestedMargin = Math.max(cfg.minMargin, marginNow - 8)
      action = suggestedMargin < marginNow ? 'DECREASE' : 'KEEP'
      reason = 'Sin ventas recientes; se sugiere ajuste para mejorar salida'
    } else if (stockDays != null && stockDays < 7) {
      const plus = trend > 15 ? 12 : trend > 5 ? 8 : 5
      suggestedMargin = Math.min(cfg.maxMargin, Math.max(cfg.targetMargin, marginNow + plus))
      action = suggestedMargin > marginNow ? 'INCREASE' : 'KEEP'
      reason = 'Alta rotacion y bajo stock; hay espacio para capturar margen'
    } else if (stockDays != null && stockDays > 45 && sold30 < 10) {
      suggestedMargin = Math.max(cfg.minMargin, marginNow - 6)
      action = suggestedMargin < marginNow ? 'DECREASE' : 'KEEP'
      reason = 'Cobertura alta con demanda lenta; conviene mejorar competitividad'
    } else if (trend > 20 && sold30 > 20) {
      suggestedMargin = Math.min(cfg.maxMargin, Math.max(marginNow + 4, cfg.targetMargin))
      action = suggestedMargin > marginNow ? 'INCREASE' : 'KEEP'
      reason = 'Demanda acelerada; ajuste de precio sugerido'
    } else if (marginNow < cfg.minMargin) {
      suggestedMargin = Math.max(cfg.minMargin, cfg.targetMargin)
      action = suggestedMargin > marginNow ? 'INCREASE' : 'KEEP'
      reason = 'Margen actual por debajo del umbral minimo'
    }

    const suggestedPrice = this._round2(cost / (1 - (suggestedMargin / 100)))
    const deltaPrice = this._round2(suggestedPrice - price)
    const deltaPct = price > 0 ? this._round2((deltaPrice / price) * 100) : 0
    const impact = this._impactScore({ action, sold30, trend, stockDays, deltaPct })

    return {
      variant_id: row.variant_id,
      product_name: row.product_name,
      variant_name: row.variant_name,
      sku: row.sku,
      current_cost: this._round2(cost),
      current_price: this._round2(price),
      current_margin_pct: this._round2(marginNow),
      suggested_price: this._round2(suggestedPrice),
      suggested_margin_pct: this._round2(suggestedMargin),
      delta_price: deltaPrice,
      delta_pct: deltaPct,
      sold_last_30d: sold30,
      avg_daily_demand: this._round2(avgDailyDemand),
      days_of_stock_remaining: stockDays,
      days_of_stock_raw: rawStockDays,
      stock_days_reliability: stockDaysMeta.reliability,
      stock_days_note: stockDaysMeta.note,
      trend_percentage: this._round2(trend),
      action,
      reason,
      impact_score: impact
    }
  }

  _impactScore({ action, sold30, trend, stockDays, deltaPct }) {
    const direction = action === 'KEEP' ? 0 : 15
    const sales = Math.min(50, sold30)
    const trendWeight = Math.min(20, Math.max(0, trend))
    const stockWeight = stockDays == null ? 5 : stockDays < 7 ? 20 : stockDays > 45 ? 12 : 8
    const priceWeight = Math.min(15, Math.abs(deltaPct))
    return Math.round(direction + sales + trendWeight + stockWeight + priceWeight)
  }

  _buildSummary(suggestions) {
    const inc = suggestions.filter((s) => s.action === 'INCREASE')
    const dec = suggestions.filter((s) => s.action === 'DECREASE')
    return {
      total_suggestions: suggestions.length,
      increase_count: inc.length,
      decrease_count: dec.length,
      avg_delta_pct: suggestions.length > 0
        ? this._round2(suggestions.reduce((sum, s) => sum + Number(s.delta_pct || 0), 0) / suggestions.length)
        : 0
    }
  }

  _buildDefaultInsights(suggestions, cfg) {
    const highImpact = suggestions.filter((s) => s.impact_score >= 70).length
    return [
      {
        title: 'Foco inmediato',
        detail: `Productos de alto impacto detectados: ${highImpact}.`,
        level: highImpact > 5 ? 'high' : 'medium'
      },
      {
        title: 'Politica de margen',
        detail: `Rango objetivo aplicado: ${cfg.minMargin}% a ${cfg.maxMargin}%.`,
        level: 'info'
      }
    ]
  }

  async _getAIInsights(suggestions, cfg) {
    const top = suggestions.slice(0, 20).map((s) => ({
      sku: s.sku,
      product_name: s.product_name,
      sold_last_30d: s.sold_last_30d,
      avg_daily_demand: s.avg_daily_demand,
      stock_days_estimated: s.days_of_stock_remaining,
      stock_days_reliability: s.stock_days_reliability,
      stock_days_note: s.stock_days_note,
      trend: s.trend_percentage,
      current_margin: s.current_margin_pct,
      suggested_margin: s.suggested_margin_pct,
      action: s.action
    }))

    const prompt = `Analiza estas sugerencias de precios para un POS.
Genera maximo 4 insights accionables, en JSON valido:
{
  "insights": [
    { "title": "string", "detail": "string", "level": "high|medium|info" }
  ]
}

REGLAS OBLIGATORIAS:
- Usa SOLO los datos numericos provistos.
- NO inventes antiguedad de producto ni historial mayor a 30 dias.
- "stock_days_estimated" es COBERTURA ESTIMADA (stock / demanda 30d), NO edad del producto.
- Si "stock_days_reliability" es "low", tratala como dato incierto y mencionalo.

Datos:
${JSON.stringify({ config: cfg, metrics_definition: { sample_window_days: 30 }, top }, null, 2)}`

    const { data, error } = await supabase.functions.invoke(AI_EDGE_FUNCTION, {
      body: {
        model: DEEPSEEK_MODEL,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content: 'Eres un analista senior de pricing retail. Responde solo JSON valido.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      }
    })

    if (error) throw new Error(error.message)
    const content = data?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Invalid AI response format')
    const parsed = JSON.parse(jsonMatch[0])
    return parsed.insights || []
  }

  _round2(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
  }

  _normalizeStockDays(rawStockDays, sold30, avgDailyDemand) {
    if (rawStockDays == null || !Number.isFinite(rawStockDays)) {
      return {
        value: null,
        reliability: 'low',
        note: 'Sin cobertura calculable'
      }
    }

    if (sold30 <= 2 || avgDailyDemand < 0.1) {
      return {
        value: null,
        reliability: 'low',
        note: 'Muestra insuficiente en ventana de 30 dias'
      }
    }

    // Evita lecturas desproporcionadas por demanda muy baja.
    const capped = Math.min(rawStockDays, 120)
    return {
      value: this._round2(capped),
      reliability: rawStockDays > 120 ? 'medium' : 'high',
      note: rawStockDays > 120
        ? 'Cobertura estimada truncada a 120 dias para evitar sobreinterpretacion'
        : 'Cobertura estimada sobre demanda 30 dias'
    }
  }
}

export default new AIPricingAdvisorService()
