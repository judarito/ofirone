# Sistema de Facturación Implementado

## ✅ Lo que se Completó

### 1. Configuraciones de Tenant (Ya Existen)
- ✅ `invoice_prefix` - Prefijo para facturas (ej: "FAC", "INV")  
- ✅ `next_invoice_number` - Consecutivo de facturas
- ✅ `electronic_invoicing_enabled` - Bandera para facturación electrónica

### 2. Composable useTenantSettings (Ya Existe)
- ✅ `getNextInvoiceNumber()` - Genera número con prefijo: "FAC-000001"
- ✅ `incrementInvoiceNumber()` - Incrementa el consecutivo

### 3. Integración de Días IA (Completado)
- ✅ `aiForecastDaysBack` integrado en SalesForecastWidget
- ✅ Usa configuración en lugar de 90 días hardcoded

---

## 🟡 Pendiente: Integración en Ventas

Para completar el sistema de facturación, se necesita:

### Paso 1: Agregar Columna a la Base de Datos

```sql
-- migrations/ADD_INVOICE_NUMBER_TO_SALES.sql

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS invoice_number text;

-- Índice para búsqueda rápida
CREATE INDEX IF NOT EXISTS ix_sales_invoice_number 
  ON sales(tenant_id, invoice_number);

-- Poblar ventas existentes (opcional)
UPDATE sales
SET invoice_number = 'FAC-' || LPAD(sale_number::text, 6, '0')
WHERE invoice_number IS NULL;
```

### Paso 2: Modificar sp_create_sale

```sql
-- En migrations/SpVistasFN.sql, modificar sp_create_sale

CREATE OR REPLACE FUNCTION sp_create_sale(
  p_tenant uuid,
  p_location uuid,
  p_cash_session uuid,
  p_customer uuid,
  p_sold_by uuid,
  p_lines jsonb,
  p_payments jsonb,
  p_note text,
  p_invoice_number text DEFAULT NULL  -- NUEVO PARÁMETRO
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number bigint;
  -- ... resto de variables ...
BEGIN
  -- ... código existente ...
  
  INSERT INTO sales (
    tenant_id, location_id, cash_session_id, 
    sale_number, invoice_number,  -- AGREGAR invoice_number
    status, customer_id, sold_by,
    subtotal, discount_total, tax_total, total, note
  ) VALUES (
    p_tenant, p_location, p_cash_session,
    v_sale_number, p_invoice_number,  -- AGREGAR
    'COMPLETED', p_customer, p_sold_by,
    v_subtotal, v_discount, v_tax, v_total, p_note
  ) RETURNING sale_id INTO v_sale_id;
  
  -- ... resto del código ...
  
  RETURN v_sale_id;
END;
$$;
```

### Paso 3: Modificar sales.service.js

```javascript
// src/services/sales.service.js

import { useTenantSettings } from '@/composables/useTenantSettings'

class SalesService {
  async createSale(tenantId, saleData) {
    try {
      // Generar número de factura
      const { getNextInvoiceNumber, incrementInvoiceNumber } = useTenantSettings()
      const invoiceNumber = getNextInvoiceNumber()
      
      const { data, error } = await supabaseService.client.rpc('sp_create_sale', {
        p_tenant: tenantId,
        p_location: saleData.location_id,
        p_cash_session: saleData.cash_session_id || null,
        p_customer: saleData.customer_id || null,
        p_sold_by: saleData.sold_by,
        p_lines: saleData.lines,
        p_payments: saleData.payments,
        p_note: saleData.note || null,
        p_invoice_number: invoiceNumber  // NUEVO
      })

      if (error) throw error
      
      // Incrementar consecutivo
      await incrementInvoiceNumber()
      
      return { success: true, data: { sale_id: data, invoice_number: invoiceNumber } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}
```

### Paso 4: Mostrar en UI

```vue
<!-- src/views/Sales.vue -->
<template #subtitle="{ item }">
  {{ item.invoice_number || `#${item.sale_number}` }} — 
  {{ formatDate(item.sold_at) }}
</template>
```

```vue
<!-- src/views/PointOfSale.vue - Mostrar después de venta -->
<div v-if="lastSale">
  <v-alert type="success">
    Venta completada
    <br>
    <strong>Factura: {{ lastSale.invoice_number }}</strong>
  </v-alert>
</div>
```

---

## 📋 Checklist de Implementación

- [ ] Ejecutar migración ADD_INVOICE_NUMBER_TO_SALES.sql
- [ ] Modificar función sp_create_sale
- [ ] Actualizar sales.service.js para generar invoice_number
- [ ] Modificar sales.service.js para incrementar consecutivo
- [ ] Actualizar Sales.vue para mostrar invoice_number
- [ ] Actualizar PointOfSale.vue para mostrar factura al completar venta
- [ ] Actualizar tickets de impresión para incluir invoice_number
- [ ] Probar flujo completo de facturación

---

## 🎯 Configuración Recomendada

Para configurar el sistema de facturación:

1. **TenantConfig → Facturación:**
   - `invoice_prefix`: "FAC" (o "INV", "FC", etc.)
   - `next_invoice_number`: 1 (o el número donde quieras empezar)
   - `electronic_invoicing_enabled`: false (por ahora)

2. **Ejemplo de número generado:**
   - Prefijo: "FAC"  
   - Consecutivo: 1
   - Resultado: **"FAC-000001"**

---

## 🔮 Futuras Mejoras

1. **Facturación Electrónica:**
   - Integración con DIAN (Colombia)
   - Generación de CUFE
   - Envío automático por email

2. **Múltiples Series:**
   - Series diferentes por tipo (venta, devolución, nota crédito)
   - Series por sede

3. **Anulación de Facturas:**
   - Nota crédito automática
   - Ajuste de consecutivos

---

**Estado Actual**: Sistema configurado pero no integrado en ventas  
**Esfuerzo Estimado**: 2-3 horas para completar integración  
**Prioridad**: Alta (funcionalidad legal requerida)
