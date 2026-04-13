import { supabase } from '../lib/supabase';

const AI_EDGE_FUNCTION =
  process.env.EXPO_PUBLIC_PURCHASE_AI_EDGE_FUNCTION
  || process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_EDGE_FUNCTION
  || 'deepseek-proxy';
const AI_MODEL =
  process.env.EXPO_PUBLIC_PURCHASE_AI_MODEL
  || process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL
  || 'deepseek-chat';

class AIPurchaseAdvisorService {
  isAvailable() {
    return true;
  }

  async generatePurchaseRecommendations(tenantId, rotationData, suggestions, options = {}) {
    const prompt = this._buildPrompt(rotationData || [], suggestions || [], options);
    const aiResponse = await this._invokeLlm([
      { role: 'system', content: this._getSystemPrompt() },
      { role: 'user', content: prompt },
    ]);

    if (!aiResponse) {
      throw new Error('Respuesta vacía del asesor de compras.');
    }

    return this._parseAIResponse(aiResponse, suggestions || []);
  }

  generateExecutiveSummary(aiAnalysis) {
    const suggestions = aiAnalysis?.suggestions || [];
    const insights = aiAnalysis?.insights || [];
    const warnings = aiAnalysis?.warnings || [];

    const criticalProducts = suggestions.filter((item) => item.ai_priority === 1 || item.priority === 1);
    const totalInvestment = suggestions.reduce(
      (sum, item) => sum + Number(item.ai_suggested_qty || item.suggested_order_qty || 0) * Number(item.unit_cost || 0),
      0,
    );
    const highConfidence = suggestions.filter((item) => Number(item.ai_confidence || 0) > 0.8);

    return {
      critical_products_count: criticalProducts.length,
      total_investment: totalInvestment,
      high_confidence_count: highConfidence.length,
      key_insight: insights.find((item) => item.impact === 'high')?.description || 'Sin insights de alto impacto.',
      top_warning: warnings.find((item) => item.severity === 'critical')?.message || 'Sin alertas críticas.',
      recommendation: this._generateTopRecommendation(suggestions, insights),
    };
  }

  _getSystemPrompt() {
    return `Eres un asesor experto en gestión de inventario para PYMES. Analiza ventas, rotación y stock para proponer compras accionables.

Responde SOLO JSON válido con:
{
  "enhanced_suggestions": [],
  "insights": [],
  "warnings": [],
  "optimization_tips": []
}`;
  }

  _buildPrompt(rotationData, suggestions, options) {
    const summary = {
      totalProducts: rotationData.length,
      totalSuggestions: suggestions.length,
      totalInvestment: suggestions.reduce((sum, item) => sum + Number(item.estimated_cost || 0), 0),
      criticalCount: suggestions.filter((item) => item.priority === 1).length,
      highPriorityCount: suggestions.filter((item) => item.priority === 2).length,
    };

    const topByDemand = [...rotationData]
      .filter((item) => Number(item.sold_last_30d || 0) > 0)
      .sort((left, right) => Number(right.sold_last_30d || 0) - Number(left.sold_last_30d || 0))
      .slice(0, 10);

    return `Analiza estos datos de compras e inventario.

Contexto del negocio: ${options.businessContext || 'Retail general'}
Prioridad mínima: ${Number(options.priorityLevel || 3)}
${options.maxBudget ? `Presupuesto máximo: ${Number(options.maxBudget)}` : 'Sin presupuesto máximo declarado'}

Resumen:
- Productos analizados: ${summary.totalProducts}
- Sugerencias base: ${summary.totalSuggestions}
- Críticos: ${summary.criticalCount}
- Alta prioridad: ${summary.highPriorityCount}
- Inversión estimada: ${Math.round(summary.totalInvestment)}

Top demanda:
${topByDemand.map((item, index) => `${index + 1}. ${item.product_name || 'Producto'} ${item.variant_name || ''} | vendidas 30d=${item.sold_last_30d || 0} | stock=${item.current_stock || 0}`).join('\n') || 'Sin datos'}

Sugerencias base:
${suggestions.slice(0, 20).map((item) => `- ${item.product_name || 'Producto'} ${item.variant_name || ''} | prioridad=${item.priority || '-'} | sugerido=${item.suggested_order_qty || 0} | costo=${item.estimated_cost || 0} | motivo=${item.reason || '-'}`).join('\n') || 'Sin sugerencias'}

Devuelve JSON con:
- enhanced_suggestions: variant_id, product_name, ai_priority, ai_suggested_qty, ai_reasoning, confidence, estimated_roi_days
- insights: type, title, description, impact
- warnings: severity, product_name, message
- optimization_tips: title, description, expected_benefit`;
  }

  _parseAIResponse(aiResponse, originalSuggestions) {
    let parsed;
    try {
      const match = String(aiResponse || '').match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : aiResponse);
    } catch (error) {
      throw new Error(`No se pudo interpretar el JSON del análisis IA: ${error.message}`);
    }

    const enhancedSuggestions = (originalSuggestions || []).map((original) => {
      const enhancement = (parsed.enhanced_suggestions || []).find(
        (item) => item.variant_id === original.variant_id,
      );

      if (!enhancement) return original;

      return {
        ...original,
        ai_priority: enhancement.ai_priority,
        ai_suggested_qty: enhancement.ai_suggested_qty,
        ai_reasoning: enhancement.ai_reasoning,
        ai_confidence: enhancement.confidence,
        ai_estimated_roi_days: enhancement.estimated_roi_days,
        has_ai_analysis: true,
      };
    });

    return {
      suggestions: enhancedSuggestions,
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      optimization_tips: Array.isArray(parsed.optimization_tips) ? parsed.optimization_tips : [],
      raw_response: parsed,
    };
  }

  _generateTopRecommendation(suggestions, insights) {
    const urgentProducts = (suggestions || []).filter(
      (item) => (item.ai_priority === 1 || item.priority === 1) && Number(item.ai_confidence || 0) > 0.7,
    );

    if (urgentProducts.length > 0) {
      return `Atiende primero ${urgentProducts.length} productos críticos con riesgo alto de quiebre.`;
    }

    const growthOpportunity = (insights || []).find((item) => item.type === 'opportunity');
    if (growthOpportunity?.description) return growthOpportunity.description;

    return 'Mantén monitoreo continuo y prioriza reabastecimiento por rotación.';
  }

  async _invokeLlm(messages) {
    const { data, error } = await supabase.functions.invoke(AI_EDGE_FUNCTION, {
      body: {
        model: AI_MODEL,
        temperature: 0.25,
        max_tokens: 2400,
        messages,
      },
    });

    if (error) {
      throw new Error(`Error invocando Edge Function "${AI_EDGE_FUNCTION}": ${error.message}`);
    }

    if (!data?.content) {
      throw new Error('Respuesta vacía desde la Edge Function de IA.');
    }

    return data.content;
  }
}

export default new AIPurchaseAdvisorService();
