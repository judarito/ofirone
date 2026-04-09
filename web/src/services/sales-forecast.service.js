/**
 * Sales Forecast Service with AI (DeepSeek)
 * Genera pronósticos inteligentes de ventas basados en histórico
 * Con sistema de caché inteligente para optimizar costos
 */

import AICacheManager from '../utils/aiCache.js';
import { supabase } from '@/plugins/supabase';

const DEEPSEEK_MODEL = 'deepseek-chat';
const CACHE_TTL_HOURS = 24; // Caché de 24 horas para pronósticos
const AI_EDGE_FUNCTION = 'deepseek-proxy';

class SalesForecastService {
  /**
   * Verifica si el servicio está disponible
   */
  isAvailable() {
    return true;
  }

  /**
   * Genera pronóstico de ventas usando IA
   * @param {string} tenantId - ID del tenant
   * @param {string} locationId - ID de la sede (opcional)
   * @param {Array} historicalData - Datos históricos de ventas
   * @param {Object} options - Opciones adicionales (forceRefresh: boolean)
   */
  async generateForecast(tenantId, locationId, historicalData, options = {}) {
    try {
      // Generar clave de caché
      const cacheParams = {
        locationId,
        dataPoints: historicalData.length,
        latestDate: historicalData[0]?.sale_date
      };
      const cacheKey = AICacheManager.generateKey('forecast', tenantId, cacheParams);

      // Verificar caché (a menos que se fuerce refresh)
      if (!options.forceRefresh) {
        const cached = AICacheManager.get(cacheKey);
        if (cached) {
          console.log('📦 Usando pronóstico desde caché');
          return {
            ...cached,
            from_cache: true,
            cached_at: new Date().toISOString()
          };
        }
      }

      console.log('🚀 Consultando IA vía Edge Function...');

      const prompt = this._buildForecastPrompt(historicalData, options);

      const aiResponse = await this._invokeDeepSeek(
        [
          {
            role: 'system',
            content: this._getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: DEEPSEEK_MODEL,
          temperature: 0.2,
          max_tokens: 3000
        }
      );

      if (!aiResponse) {
        throw new Error('Respuesta vacía de DeepSeek');
      }

      const result = this._parseForecastResponse(aiResponse, historicalData);

      // Guardar en caché
      AICacheManager.set(cacheKey, result, CACHE_TTL_HOURS);

      return {
        ...result,
        from_cache: false
      };
    } catch (error) {
      console.error('Error en Sales Forecast:', error);
      throw error;
    }
  }

  /**
   * Prompt del sistema para pronósticos
   */
  _getSystemPrompt() {
    return `Eres un analista experto en pronóstico de ventas para comercios minoristas. Tu objetivo es analizar datos históricos de ventas y generar pronósticos precisos y accionables.

Debes considerar:
- Tendencias: Crecimiento o decrecimiento sostenido
- Estacionalidad: Patrones semanales (días de mayor/menor venta)
- Eventos especiales: Fechas atípicas que puedan repetirse
- Promedios móviles: Para suavizar fluctuaciones
- Contexto actual: Día de la semana, época del mes

Tu respuesta debe ser en formato JSON estructurado con:
1. "daily_forecast": Pronóstico para hoy
2. "weekly_forecast": Pronóstico para esta semana (7 días)
3. "monthly_forecast": Pronóstico para este mes
4. "confidence": Nivel de confianza (0.0-1.0)
5. "reasoning": Explicación del pronóstico
6. "key_insights": Insights importantes detectados
7. "recommendations": Recomendaciones operativas

Sé preciso con los números y proporciona explicaciones claras y útiles.`;
  }

  /**
   * Construye el prompt con datos históricos
   */
  _buildForecastPrompt(historicalData, options) {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const currentDayName = dayNames[dayOfWeek];

    // Calcular estadísticas del histórico
    const stats = this._calculateStats(historicalData);
    
    // Agrupar por día de la semana
    const byDayOfWeek = this._groupByDayOfWeek(historicalData);
    
    // Últimas 4 semanas
    const last4Weeks = historicalData.slice(0, 28);

    return `Analiza el siguiente histórico de ventas y genera un pronóstico para:
- HOY (${currentDayName}, ${today.toLocaleDateString()})
- ESTA SEMANA (próximos 7 días)
- ESTE MES (del ${today.getDate()} al ${new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()})

## CONTEXTO ACTUAL
- Hoy es: ${currentDayName}
- Día del mes: ${today.getDate()}
- Mes: ${today.getMonth() + 1}

## ESTADÍSTICAS GENERALES (últimos ${historicalData.length} días)
- Venta promedio diaria: $${stats.avgDaily.toLocaleString()}
- Venta total período: $${stats.total.toLocaleString()}
- Transacciones promedio: ${stats.avgTransactions} por día
- Ticket promedio: $${stats.avgTicket.toLocaleString()}
- Mejor día: $${stats.maxDay.toLocaleString()}
- Peor día: $${stats.minDay.toLocaleString()}
- Desviación estándar: $${stats.stdDev.toLocaleString()}

## VENTAS POR DÍA DE LA SEMANA (promedio)
${Object.entries(byDayOfWeek).map(([day, data]) => 
  `${dayNames[day]}: $${data.avg.toLocaleString()} (${data.count} días, ${data.transactions} trans/día)`
).join('\n')}

## ÚLTIMOS 28 DÍAS (4 semanas)
${last4Weeks.map((d, i) => 
  `Día -${i + 1} (${dayNames[d.day_of_week]}): $${d.total_sales?.toLocaleString() || '0'} | ${d.transactions_count || 0} trans | MA7d: $${d.moving_avg_7d?.toLocaleString() || '0'}`
).join('\n')}

## TENDENCIA RECIENTE
- Promedio móvil 7 días: $${stats.ma7.toLocaleString()}
- Promedio móvil 30 días: $${stats.ma30.toLocaleString()}
- Tendencia: ${stats.trend > 0 ? '↗️ Crecimiento' : stats.trend < 0 ? '↘️ Decrecimiento' : '→ Estable'} (${stats.trendPercentage}%)

## ANÁLISIS REQUERIDO

Por favor genera un pronóstico considerando:
1. Patrón semanal detectado (días de mayor/menor venta)
2. Tendencia reciente (últimas 4 semanas)
3. Estacionalidad mensual (si aplica)
4. Eventos especiales detectados
5. Día actual de la semana

Responde ÚNICAMENTE con JSON válido en este formato:
{
  "daily_forecast": {
    "date": "YYYY-MM-DD",
    "day_name": "string",
    "predicted_sales": number,
    "predicted_transactions": number,
    "confidence": 0.0-1.0,
    "reasoning": "string explicando por qué este monto"
  },
  "weekly_forecast": {
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "predicted_total": number,
    "daily_breakdown": [
      {"date": "YYYY-MM-DD", "day": "string", "predicted_sales": number}
    ],
    "confidence": 0.0-1.0
  },
  "monthly_forecast": {
    "month": number,
    "year": number,
    "predicted_total": number,
    "days_remaining": number,
    "confidence": 0.0-1.0
  },
  "key_insights": [
    {
      "type": "trend|pattern|anomaly",
      "title": "string",
      "description": "string",
      "impact": "high|medium|low"
    }
  ],
  "recommendations": [
    {
      "category": "staffing|inventory|marketing|operations",
      "title": "string",
      "description": "string",
      "priority": "high|medium|low"
    }
  ],
  "accuracy_notes": "string explicando limitaciones o consideraciones"
}`;
  }

  /**
   * Calcula estadísticas del histórico
   */
  _calculateStats(data) {
    if (!data || data.length === 0) {
      return {
        avgDaily: 0,
        total: 0,
        avgTransactions: 0,
        avgTicket: 0,
        maxDay: 0,
        minDay: 0,
        stdDev: 0,
        ma7: 0,
        ma30: 0,
        trend: 0,
        trendPercentage: '0.0'
      };
    }

    const sales = data.map(d => d.total_sales || 0);
    const transactions = data.map(d => d.transactions_count || 0);
    
    const total = sales.reduce((sum, val) => sum + val, 0);
    const avgDaily = total / data.length;
    const avgTransactions = transactions.reduce((sum, val) => sum + val, 0) / data.length;
    const avgTicket = avgTransactions > 0 ? avgDaily / avgTransactions : 0;

    // Calcular desviación estándar
    const variance = sales.reduce((sum, val) => sum + Math.pow(val - avgDaily, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);

    // Promedios móviles
    const ma7 = data[0]?.moving_avg_7d || avgDaily;
    const ma30 = data[0]?.moving_avg_30d || avgDaily;

    // Tendencia (comparar primeros 14 días vs últimos 14 días)
    const recentAvg = sales.slice(0, 14).reduce((sum, val) => sum + val, 0) / 14;
    const olderAvg = sales.slice(14, 28).reduce((sum, val) => sum + val, 0) / 14;
    const trend = recentAvg - olderAvg;
    const trendPercentage = olderAvg > 0 ? ((trend / olderAvg) * 100).toFixed(1) : '0.0';

    return {
      avgDaily: Math.round(avgDaily),
      total: Math.round(total),
      avgTransactions: Math.round(avgTransactions),
      avgTicket: Math.round(avgTicket),
      maxDay: Math.round(Math.max(...sales)),
      minDay: Math.round(Math.min(...sales)),
      stdDev: Math.round(stdDev),
      ma7: Math.round(ma7),
      ma30: Math.round(ma30),
      trend: Math.round(trend),
      trendPercentage
    };
  }

  /**
   * Agrupa datos por día de la semana
   */
  _groupByDayOfWeek(data) {
    const grouped = {};
    
    for (let i = 0; i < 7; i++) {
      grouped[i] = { total: 0, count: 0, transactions: 0 };
    }

    data.forEach(d => {
      const day = d.day_of_week;
      grouped[day].total += d.total_sales || 0;
      grouped[day].count += 1;
      grouped[day].transactions += d.transactions_count || 0;
    });

    // Calcular promedios
    Object.keys(grouped).forEach(day => {
      const g = grouped[day];
      g.avg = g.count > 0 ? Math.round(g.total / g.count) : 0;
      g.transactions = g.count > 0 ? Math.round(g.transactions / g.count) : 0;
    });

    return grouped;
  }

  /**
   * Parsea la respuesta de la IA
   */
  _parseForecastResponse(aiResponse, historicalData) {
    try {
      // Extraer JSON de la respuesta
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
      
      const forecast = JSON.parse(jsonStr);

      // Validar estructura mínima
      if (!forecast.daily_forecast || !forecast.weekly_forecast || !forecast.monthly_forecast) {
        throw new Error('Estructura de pronóstico inválida');
      }

      // Agregar metadatos
      forecast.generated_at = new Date().toISOString();
      forecast.data_points = historicalData.length;
      forecast.historical_avg = this._calculateStats(historicalData).avgDaily;

      return {
        success: true,
        forecast,
        raw_response: aiResponse
      };
    } catch (error) {
      console.error('Error parsing forecast response:', error);
      console.error('Raw response:', aiResponse);
      throw new Error(`Error al parsear pronóstico: ${error.message}`);
    }
  }

  /**
   * Genera pronóstico fallback (sin IA, basado en promedios)
   */
  generateFallbackForecast(historicalData) {
    const stats = this._calculateStats(historicalData);
    const byDayOfWeek = this._groupByDayOfWeek(historicalData);
    
    const today = new Date();
    const dayOfWeek = today.getDay();
    
    return {
      success: true,
      forecast: {
        daily_forecast: {
          date: today.toISOString().split('T')[0],
          day_name: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dayOfWeek],
          predicted_sales: byDayOfWeek[dayOfWeek]?.avg || stats.avgDaily,
          predicted_transactions: byDayOfWeek[dayOfWeek]?.transactions || stats.avgTransactions,
          confidence: 0.6,
          reasoning: 'Pronóstico basado en promedio histórico del mismo día de la semana'
        },
        weekly_forecast: {
          predicted_total: stats.avgDaily * 7,
          confidence: 0.5,
          daily_breakdown: []
        },
        monthly_forecast: {
          predicted_total: stats.avgDaily * 30,
          confidence: 0.4
        },
        key_insights: [{
          type: 'info',
          title: 'Pronóstico Simple',
          description: 'Este es un pronóstico básico. Active IA para análisis avanzado.',
          impact: 'medium'
        }],
        recommendations: [],
        generated_at: new Date().toISOString(),
        is_fallback: true
      }
    };
  }

  async _invokeDeepSeek(messages, config) {
    const { data, error } = await supabase.functions.invoke(AI_EDGE_FUNCTION, {
      body: {
        messages,
        ...config
      }
    });

    if (error) {
      throw new Error(`Error invocando Edge Function "${AI_EDGE_FUNCTION}": ${error.message}`);
    }

    if (!data?.content) {
      throw new Error('Respuesta vacía desde Edge Function de IA');
    }

    return data.content;
  }
}

export default new SalesForecastService();
