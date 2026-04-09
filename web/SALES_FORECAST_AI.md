# Sistema de Pronóstico Inteligente de Ventas

## Descripción General

Sistema completo de pronóstico de ventas basado en **Inteligencia Artificial (DeepSeek)** que analiza el histórico de ventas para generar predicciones precisas de ventas diarias, semanales y mensuales, con insights accionables y recomendaciones operativas.

## Características Principales

### 🤖 Análisis con IA
- **DeepSeek API**: Modelo de lenguaje especializado para análisis predictivo
- **Detección de patrones**: Identifica tendencias, estacionalidad y anomalías
- **Razonamiento explícito**: Explica el *por qué* de cada pronóstico
- **Confianza calibrada**: Score de confianza basado en calidad de datos

### 📊 Pronósticos Multi-período
1. **Diario**: Predicción para HOY con consideración del día de la semana
2. **Semanal**: Próximos 7 días con desglose diario
3. **Mensual**: Proyección del mes actual considerando días restantes

### 🎯 Insights Accionables
- **Tendencias**: Crecimiento/decrecimiento sostenido
- **Patrones**: Días de mayor/menor venta
- **Anomalías**: Detección de eventos especiales
- **Recomendaciones**: Acciones sugeridas por categoría

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Vue 3)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │      SalesForecastWidget.vue (Home Dashboard)        │  │
│  │  - Muestra pronósticos diario/semanal/mensual        │  │
│  │  - Visualiza insights y recomendaciones              │  │
│  │  - Gráfico de barras semanal                         │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   Services Layer (JS)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  sales.service.js                                     │  │
│  │  - generateSalesForecast()                            │  │
│  │  - getSalesForecastData()                             │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                      │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  sales-forecast.service.js                            │  │
│  │  - generateForecast() → DeepSeek API                  │  │
│  │  - _buildForecastPrompt()                             │  │
│  │  - _calculateStats()                                  │  │
│  │  - _groupByDayOfWeek()                                │  │
│  │  - generateFallbackForecast() (sin IA)               │  │
│  └────────────────────┬─────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL / Supabase Backend                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  vw_sales_daily_history                               │  │
│  │  - Agregaciones diarias con window functions          │  │
│  │  - Moving averages (7d, 30d)                          │  │
│  │  - Week-over-week comparisons                         │  │
│  │  - Day-of-week patterns                               │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  fn_get_sales_forecast_data(tenant, location, days)  │  │
│  │  - Retorna histórico formateado para IA               │  │
│  │  - Default: 90 días de datos                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    DeepSeek API (Externa)                    │
│  - Modelo: deepseek-chat                                     │
│  - Temperature: 0.2 (determinístico)                         │
│  - Max tokens: 3000                                          │
└─────────────────────────────────────────────────────────────┘
```

## Componentes del Sistema

### 1. Base de Datos (SpVistasFN.sql)

#### Vista: `vw_sales_daily_history`
Agrega ventas por día con análisis temporal:

```sql
-- Columnas clave:
- sale_date: Fecha de venta
- day_of_week: 0=Domingo, 6=Sábado
- total_sales: Venta total del día
- transactions_count: Número de transacciones
- avg_ticket: Ticket promedio
- moving_avg_7d: Promedio móvil 7 días
- moving_avg_30d: Promedio móvil 30 días
- same_day_last_week: Venta del mismo día semana anterior
- week_over_week_diff: Diferencia vs. semana anterior
```

**Features:**
- Window functions para promedios móviles
- LAG para comparaciones temporales
- Filtrado por tenant/location
- Solo ventas completadas

#### Función: `fn_get_sales_forecast_data()`
Retorna histórico formateado para análisis de IA:

```sql
-- Parámetros:
p_tenant_id uuid        -- Obligatorio
p_location_id uuid      -- Opcional (null = todas las sedes)
p_days_back int         -- Default: 90 días

-- Retorna:
TABLE(
  sale_date date,
  day_of_week int,
  total_sales numeric,
  transactions_count bigint,
  avg_ticket numeric,
  moving_avg_7d numeric,
  moving_avg_30d numeric
)
```

### 2. Services (JavaScript)

#### `sales-forecast.service.js`
Servicio principal de IA con DeepSeek:

**Métodos principales:**
- `generateForecast(tenantId, locationId, historicalData, options)`
  - Construye prompt rico con contexto
  - Llama DeepSeek API
  - Parsea respuesta JSON
  - Retorna pronóstico estructurado

- `generateFallbackForecast(historicalData)`
  - Pronóstico simple basado en promedios
  - Usado si IA no está disponible
  - No requiere API key

**Cálculos estadísticos:**
- `_calculateStats()`: Promedio, desv. estándar, tendencias
- `_groupByDayOfWeek()`: Patrones por día de la semana
- Detección de tendencias (últimos 14 vs 14 anteriores)

**Prompt Engineering:**
- Context window amplio (últimos 90 días)
- Estadísticas agregadas (promedios, máx/mín)
- Patrones por día de la semana
- Promedios móviles 7d/30d
- Tendencia reciente
- Instrucciones claras de formato JSON

#### `sales.service.js` (Extensión)
Métodos agregados:

```javascript
// Obtiene datos históricos desde PostgreSQL
async getSalesForecastData(tenantId, locationId, daysBack)

// Orquesta el proceso completo de pronóstico
async generateSalesForecast(tenantId, locationId, options)
```

**Flujo de `generateSalesForecast()`:**
1. Obtiene datos históricos vía RPC
2. Valida datos mínimos (≥14 días)
3. Verifica disponibilidad de IA
4. Genera pronóstico (IA o fallback)
5. Retorna resultado estructurado

### 3. Frontend (Vue 3)

#### `SalesForecastWidget.vue`
Componente de dashboard con visualización completa:

**Estructura:**
- **Header**: Título + badge de IA
- **Cards principales**: HOY, SEMANA, MES
  - Monto pronosticado
  - Barra de confianza
  - Metadata contextual
  
- **Expansion panels**:
  - 🧠 Análisis de IA (reasoning)
  - 💡 Insights clave (tendencias, patrones)
  - ✅ Recomendaciones (por categoría y prioridad)

- **Gráfico semanal**: Mini chart con desglose diario
- **Metadatos**: Timestamp, data points, promedio histórico
- **Acciones**: Botón refresh

**Computed properties:**
- `formatNumber()`: Formato de montos
- `formatDate()`: Formato de fechas
- `getConfidenceColor()`: Colores según confianza
- `getInsightIcon()`: Iconos por tipo
- `getBarHeight()`: Altura de barras proporcional

#### `Home.vue` (Modificado)
Widget integrado en la página principal:

```vue
<!-- Ubicación: Después de CashSessionCard -->
<v-row>
  <v-col cols="12">
    <SalesForecastWidget />
  </v-col>
</v-row>
```

## Configuración

### Variables de Entorno (.env)
```env
VITE_DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

**Nota**: Si no está configurada, usa pronóstico fallback (promedios).

### Requisitos Mínimos
- **Datos históricos**: Mínimo 14 días de ventas
- **PostgreSQL**: Función `fn_get_sales_forecast_data` disponible
- **API Key**: Opcional (fallback sin IA)

## Uso del Sistema

### Para el Usuario Final

1. **Acceso**: Navega a Home/Dashboard
2. **Visualización**: Widget muestra pronósticos automáticamente
3. **Actualización**: Click en "Actualizar" para regenerar
4. **Insights**: Expande paneles para ver análisis detallado

### Para Desarrolladores

#### Llamar pronóstico programáticamente:

```javascript
import salesService from '@/services/sales.service'

// Generar pronóstico
const result = await salesService.generateSalesForecast(
  tenantId,      // UUID del tenant
  locationId,    // UUID de la sede (null = todas)
  {
    daysBack: 90  // Días de histórico (default: 90)
  }
)

if (result.success) {
  const forecast = result.data
  console.log('Hoy:', forecast.daily_forecast.predicted_sales)
  console.log('Semana:', forecast.weekly_forecast.predicted_total)
  console.log('Mes:', forecast.monthly_forecast.predicted_total)
  console.log('Insights:', forecast.key_insights)
  console.log('Recomendaciones:', forecast.recommendations)
}
```

#### Obtener solo datos históricos:

```javascript
const result = await salesService.getSalesForecastData(
  tenantId,
  locationId,
  90  // Últimos 90 días
)

if (result.success) {
  console.log('Datos históricos:', result.data)
}
```

## Estructura de Respuesta

### Objeto `forecast` completo:

```javascript
{
  // Pronóstico diario
  "daily_forecast": {
    "date": "2024-01-15",
    "day_name": "Lunes",
    "predicted_sales": 45000,
    "predicted_transactions": 35,
    "confidence": 0.82,
    "reasoning": "Basado en patrón de lunes con tendencia creciente..."
  },
  
  // Pronóstico semanal
  "weekly_forecast": {
    "start_date": "2024-01-15",
    "end_date": "2024-01-21",
    "predicted_total": 280000,
    "daily_breakdown": [
      {"date": "2024-01-15", "day": "Lunes", "predicted_sales": 45000},
      {"date": "2024-01-16", "day": "Martes", "predicted_sales": 42000},
      // ... resto de días
    ],
    "confidence": 0.75
  },
  
  // Pronóstico mensual
  "monthly_forecast": {
    "month": 1,
    "year": 2024,
    "predicted_total": 850000,
    "days_remaining": 16,
    "confidence": 0.68
  },
  
  // Insights clave
  "key_insights": [
    {
      "type": "trend",  // trend|pattern|anomaly|info
      "title": "Crecimiento sostenido",
      "description": "Ventas han crecido 15% últimas 4 semanas",
      "impact": "high"  // high|medium|low
    }
  ],
  
  // Recomendaciones operativas
  "recommendations": [
    {
      "category": "staffing",  // staffing|inventory|marketing|operations
      "title": "Reforzar personal fin de semana",
      "description": "Sábados tienen 40% más ventas que promedio",
      "priority": "high"  // high|medium|low
    }
  ],
  
  // Metadatos
  "accuracy_notes": "Pronóstico basado en 90 días de datos...",
  "generated_at": "2024-01-15T08:30:00Z",
  "data_points": 90,
  "historical_avg": 38500,
  "is_fallback": false  // true si se usó pronóstico simple
}
```

## Prompt de IA (DeepSeek)

El sistema construye un prompt rico con:

1. **Contexto temporal**: Día actual, día de la semana, época del mes
2. **Estadísticas generales**: Promedios, máx/mín, desviación estándar
3. **Patrones semanales**: Venta promedio por día de la semana
4. **Histórico reciente**: Últimos 28 días detallados
5. **Tendencias**: Moving averages 7d y 30d
6. **Análisis requerido**: Instrucciones específicas de qué considerar

**Temperature**: 0.2 (baja) para pronósticos más determinísticos y consistentes.

## Ventajas del Sistema

### Para el Negocio
- ✅ **Pronósticos precisos**: Basados en patrones reales
- ✅ **Insights accionables**: No solo números, sino *por qué*
- ✅ **Planificación mejorada**: Staff, inventario, marketing
- ✅ **Detección temprana**: Identifica anomalías y cambios

### Técnicas
- ✅ **Escalable**: Funciona por tenant/sede independiente
- ✅ **Eficiente**: SQL optimizado con window functions
- ✅ **Robusto**: Fallback si IA no disponible
- ✅ **Mantenible**: Código modular y documentado
- ✅ **Económico**: DeepSeek tiene pricing competitivo

## Limitaciones y Consideraciones

### Datos Requeridos
- **Mínimo**: 14 días de histórico
- **Recomendado**: 90 días para mayor precisión
- **Calidad**: Requiere ventas completas (status COMPLETED)

### Precisión del Pronóstico
- **Confianza alta (>0.8)**: Patrones estables, datos suficientes
- **Confianza media (0.6-0.8)**: Algunos factores inciertos
- **Confianza baja (<0.6)**: Datos limitados o muy volátiles

### Factores NO Considerados
- ⚠️ Eventos externos (feriados, clima, economía)
- ⚠️ Campañas de marketing no repetitivas
- ⚠️ Cambios en competencia
- ⚠️ Productos nuevos sin histórico

**Recomendación**: Usar pronóstico como guía, no como absoluto.

## Mantenimiento

### Actualización de Datos
- Widget se actualiza al cargar Home
- Botón "Actualizar" regenera pronóstico
- Considerar cache si se llama frecuentemente

### Costos de IA
- DeepSeek: ~$0.27 por millón de tokens de entrada
- Prompt típico: ~2000 tokens
- Respuesta: ~1000 tokens
- **Costo por pronóstico**: ~$0.001 (muy bajo)

### Monitoreo
- Logs en consola para errores
- Verificar disponibilidad de API key
- Validar datos históricos suficientes

## Futuras Mejoras

### Corto Plazo
- [ ] Cache de pronósticos (evitar regenerar cada carga)
- [ ] Comparación real vs. pronosticado (precisión histórica)
- [ ] Filtros por sede en widget
- [ ] Exportar pronóstico a PDF/Excel

### Mediano Plazo
- [ ] Integrar eventos externos (feriados, clima)
- [ ] Análisis de precisión histórica (qué tan bien predijimos)
- [ ] Alertas si real diverge de pronóstico
- [ ] Pronósticos por categoría de producto

### Largo Plazo
- [ ] Modelo ML propio (vs API externa)
- [ ] Pronósticos multi-periodo (trimestral, anual)
- [ ] Simulaciones "what-if" (qué pasa si...)
- [ ] Integración con planning de inventario

## Troubleshooting

### Error: "No hay suficientes datos históricos"
**Causa**: Menos de 14 días de ventas
**Solución**: Esperar más datos o reducir umbral mínimo

### Error: "Servicio de IA no disponible"
**Causa**: VITE_DEEPSEEK_API_KEY no configurado
**Solución**: 
1. Agregar API key en `.env`
2. Reiniciar dev server
3. O usar fallback (promedios simples)

### Pronóstico parece incorrecto
**Diagnóstico**:
1. Verificar datos históricos en BD
2. Revisar prompt enviado a IA (console.log)
3. Validar response parsing
4. Considerar si hubo eventos atípicos

### Widget no carga
**Verificar**:
1. Console logs (F12)
2. Tenant/location configurados
3. Datos en vw_sales_daily_history
4. Función fn_get_sales_forecast_data existe

## Contacto y Soporte

Para issues o mejoras:
1. Revisar logs en consola del navegador
2. Verificar logs de PostgreSQL
3. Validar API key y respuesta de DeepSeek
4. Documentar error con contexto completo

---

**Versión**: 1.0  
**Última actualización**: Enero 2024  
**Estado**: ✅ Producción
