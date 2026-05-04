# Auditoría de Integración de Configuraciones de Tenant

## 📊 Estado General

De las **23 configuraciones** creadas en `tenant_settings`, solo **~30%** están completamente integradas.

---

## ✅ Configuraciones Integradas (7/23)

### 1. **UI - Interfaz** (2/5)

| Configuración | Estado | Ubicación |
|--------------|--------|-----------|
| `default_page_size` | 🟡 **PARCIAL** | Solo en Users.vue y Products.vue. **Faltan 13 vistas más con ListView** |
| `theme` | ✅ **COMPLETO** | App.vue con watch y aplicación automática |
| `date_format` | ❌ **NO INTEGRADO** | No se usa en ningún lugar |
| `locale` | ❌ **NO INTEGRADO** | No se usa en ningún lugar |
| `session_timeout_minutes` | ❌ **NO INTEGRADO** | No se usa en ningún lugar |

**Vistas con ListView que necesitan `defaultPageSize`:**
- ❌ Categories.vue
- ❌ Customers.vue
- ❌ Sales.vue
- ❌ CashSessions.vue
- ❌ CashRegisters.vue
- ❌ Roles.vue
- ❌ Taxes.vue
- ❌ Locations.vue
- ❌ PaymentMethods.vue
- ❌ PricingRules.vue
- ❌ TaxRules.vue
- ❌ LayawayContracts.vue
- ❌ Purchases.vue (parcial)

---

### 2. **IA - Inteligencia Artificial** (0/4)

| Configuración | Estado | Ubicación Esperada | Problema |
|--------------|--------|-------------------|----------|
| `ai_forecast_days_back` | ❌ **NO INTEGRADO** | sales-forecast.service.js | Usa valor hardcoded o histórico completo |
| `ai_purchase_suggestion_days` | ❌ **NO INTEGRADO** | ai-purchase-advisor.service.js | Usa valor hardcoded |
| `ai_purchase_advisor_enabled` | ❌ **NO INTEGRADO** | Ninguno | No se verifica antes de llamar al servicio |
| `ai_sales_forecast_enabled` | ❌ **NO INTEGRADO** | Ninguno | No se verifica antes de llamar al servicio |

**Impacto**: Los servicios de IA no respetan las preferencias del tenant.

---

### 3. **Inventario** (0/2)

| Configuración | Estado | Ubicación Esperada | Problema |
|--------------|--------|-------------------|----------|
| `expiry_alert_days` | ❌ **NO INTEGRADO** | Inventory.vue, alerts sistema | No se usa para calcular alertas de vencimiento |
| `reserve_stock_on_layaway` | ❌ **NO INTEGRADO** | layaway.service.js | No se verifica al crear plan separé |

**Impacto**: Inventario no reserva stock en plan separé según configuración.

---

### 4. **Ventas y Precios** (0/3)

| Configuración | Estado | Ubicación Esperada | Problema |
|--------------|--------|-------------------|----------|
| `max_discount_without_auth` | 🟡 **IMPORTADO NO USADO** | PointOfSale.vue | Se importa pero NO se valida |
| `rounding_method` | 🟡 **IMPORTADO NO USADO** | PointOfSale.vue | Se importa `applyRounding()` pero NO se llama |
| `rounding_multiple` | 🟡 **IMPORTADO NO USADO** | PointOfSale.vue | Usado en `applyRounding()` pero la función no se llama |

**Crítico**: Los descuentos y redondeos configurados no se aplican en el POS.

---

### 5. **Facturación** (0/5)

| Configuración | Estado | Ubicación Esperada | Problema |
|--------------|--------|-------------------|----------|
| `invoice_prefix` | ❌ **NO INTEGRADO** | sales.service.js | No se genera número de factura |
| `next_invoice_number` | ❌ **NO INTEGRADO** | sales.service.js | No se genera número de factura |
| `electronic_invoicing_enabled` | ❌ **NO INTEGRADO** | sales.service.js | No se verifica para enviar factura electrónica |
| `print_format` | ❌ **NO INTEGRADO** | usePrint.js | No se usa al imprimir tickets |
| `thermal_paper_width` | ❌ **NO INTEGRADO** | usePrint.js | No se usa al imprimir tickets |

**Impacto**: Sistema de facturación no está implementado.

---

### 6. **Notificaciones** (4/4)

| Configuración | Estado | Ubicación Esperada | Problema |
|--------------|--------|-------------------|----------|
| `email_alerts_enabled` | ✅ **INTEGRADO** | `notification_outbox` + triggers SQL | Habilita/deshabilita emails operativos del tenant |
| `alert_email` | ✅ **INTEGRADO** | `notification_outbox` + triggers SQL | Destino de alertas operativas |
| `notify_low_stock` | ✅ **INTEGRADO** | `trg_enqueue_operational_email` | Filtra alertas `STOCK` |
| `notify_expiring_products` | ✅ **INTEGRADO** | `trg_enqueue_operational_email` | Filtra alertas `EXPIRATION` |

**Impacto**: El sistema de email ya existe y se centraliza en `notification_outbox` + `notification-dispatcher`, con deduplicacion por `channel + dedupe_key` para evitar sobrecostos.

---

## 🎯 Prioridades de Integración

### **CRÍTICAS** (Impacto Inmediato en UX)

1. ⚠️ **`maxDiscountWithoutAuth` en PointOfSale.vue**
   - **Problema**: Se pueden aplicar descuentos superiores al límite configurado
   - **Solución**: Validar descuento antes de aplicar, requerir autorización si excede

2. ⚠️ **`applyRounding()` en PointOfSale.vue**
   - **Problema**: Los totales no se redondean según configuración
   - **Solución**: Llamar a `applyRounding(total)` en cálculo de totales

3. ⚠️ **`defaultPageSize` en 13 vistas con ListView**
   - **Problema**: Todas las vistas usan tamaño hardcoded (10 o 20)
   - **Solución**: Importar y usar `defaultPageSize` de `useTenantSettings()`

### **ALTAS** (Funcionalidad Faltante)

4. 📋 **Sistema de Facturación Completo**
   - Generar número de factura con prefijo y consecutivo
   - Incrementar automáticamente `next_invoice_number`
   - Integrar en `sales.service.js` al completar venta

5. 🤖 **Días para IA configurable**
   - `ai_forecast_days_back` en `sales-forecast.service.js`
   - `ai_purchase_suggestion_days` en `ai-purchase-advisor.service.js`

### **MEDIAS** (Mejoras Operativas)

6. 📦 **Reserva de stock en Layaway**
   - Verificar `reserve_stock_on_layaway` al crear plan separé
   - Integrar en `layaway.service.js`

7. 🖨️ **Formato de impresión**
   - Usar `print_format` y `thermal_paper_width` en `usePrint.js`
   - Ajustar ancho de ticket según configuración

### **BAJAS** (Nice to Have)

8. 📅 **Formato de fechas y locale**
   - Aplicar `date_format` en todas las visualizaciones de fechas
   - Usar `locale` para Intl.NumberFormat y DateTimeFormat

9. ⏱️ **Timeout de sesión**
   - Implementar `session_timeout_minutes` en auth.service.js

10. 📧 **Sistema de notificaciones por email**
    - Implementar backend para enviar emails
    - Usar `email_alerts_enabled`, `alert_email`, etc.

---

## 📝 Plan de Acción Recomendado

### Fase 1: Correcciones Críticas (1-2 horas)
1. Integrar validación de `maxDiscountWithoutAuth` en POS
2. Implementar redondeo con `applyRounding()` en POS
3. Integrar `defaultPageSize` en las 13 vistas faltantes

### Fase 2: Funcionalidad Core (2-3 horas)
4. Implementar sistema de facturación con consecutivo
5. Integrar configuración de días IA en servicios

### Fase 3: Mejoras Operativas (1-2 horas)
6. Implementar reserva de stock en layaway
7. Integrar formatos de impresión

### Fase 4: Futuras (Backlog)
8. Formato de fechas y locale
9. Timeout de sesión
10. Afinar plantillas de emails por marca/tenant

---

## 🔧 Archivos que Necesitan Modificación

### Críticas
- `src/views/PointOfSale.vue` - Validación descuentos y redondeo
- `src/views/Categories.vue` - defaultPageSize
- `src/views/Customers.vue` - defaultPageSize
- `src/views/Sales.vue` - defaultPageSize
- `src/views/CashSessions.vue` - defaultPageSize
- `src/views/CashRegisters.vue` - defaultPageSize
- `src/views/Roles.vue` - defaultPageSize
- `src/views/Taxes.vue` - defaultPageSize
- `src/views/Locations.vue` - defaultPageSize
- `src/views/PaymentMethods.vue` - defaultPageSize
- `src/views/PricingRules.vue` - defaultPageSize
- `src/views/TaxRules.vue` - defaultPageSize
- `src/views/LayawayContracts.vue` - defaultPageSize
- `src/views/Purchases.vue` - defaultPageSize

### Altas
- `src/services/sales.service.js` - Facturación
- `src/services/sales-forecast.service.js` - aiForecastDaysBack
- `src/services/ai-purchase-advisor.service.js` - aiPurchaseSuggestionDays

### Medias
- `src/services/layaway.service.js` - reserve_stock_on_layaway
- `src/composables/usePrint.js` - print_format, thermal_paper_width

---

**Última actualización**: 2026-02-13
