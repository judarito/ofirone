# ANÁLISIS DE IMPACTO: Sistema de Manufactura y Producción

## 📋 RESUMEN EJECUTIVO

**Proyecto**: Extensión POS → ERP con capacidades de manufactura  
**Alcance**: Agregar soporte para productos ensamblados, servicios, producción bajo demanda y producción a inventario  
**Complejidad**: ALTA - Requiere cambios arquitectónicos significativos  
**Estimación Preliminar**: 120-160 horas de desarrollo  
**Fases**: 6 fases incrementales  

---

## 🔍 ANÁLISIS DEL SISTEMA ACTUAL

### Estado Actual (✅ Implementado)
El sistema es un **POS multi-tenant con control de inventario** que incluye:

1. **Productos de Reventa Simple**
   - Tabla `products` + `product_variants`
   - Control de inventario por lotes (`inventory_batches`)
   - FEFO implementado para productos con vencimiento
   - Stock reservado para Plan Separé
   - Vista materializada `stock_balances`

2. **Gestión de Lotes y Vencimientos**
   - `requires_expiration` jerárquico (producto → variante)
   - Función `fn_variant_requires_expiration()` para configuración efectiva
   - Alertas de vencimiento en tiempo real
   - Trazabilidad lote → venta vía `sale_line_batches`

3. **Multi-tenant + Multi-sede**
   - Aislamiento completo por tenant
   - RLS policies activas
   - Stock por sede (location_id)

4. **Ventas y Pagos**
   - POS con múltiples métodos de pago
   - Descuentos flexibles (AMOUNT/PERCENT)
   - Impuestos jerárquicos
   - Devoluciones parciales/totales
   - Plan Separé (layaway)

### Lo que NO existe (❌ Requiere implementación)

1. **Lista de Materiales (BOM)**
   - No existe tabla `bill_of_materials`
   - No existe tabla `bom_components`
   - No hay relación producto → componentes

2. **Comportamiento de Inventario**
   - No existe columna `inventory_behavior` (RESELL/MANUFACTURED/SERVICE/BUNDLE)
   - Todos los productos se manejan como RESELL actualmente

3. **Tipos de Producción**
   - No existe columna `production_type` (ON_DEMAND/TO_STOCK)
   - No hay concepto de producto terminado vs componente

4. **Órdenes de Producción**
   - No existe tabla `production_orders`
   - No hay proceso de conversión componentes → producto terminado
   - No hay tracking de costos de producción

5. **Servicios**
   - No hay diferenciación de servicios sin inventario
   - No hay separación en reportes

6. **Bundles/Kits**
   - No hay descuento automático de múltiples productos

---

## 🎯 REQUERIMIENTOS VS. SISTEMA ACTUAL

| Requerimiento | Estado Actual | Gap | Prioridad |
|---------------|---------------|-----|-----------|
| RESELL | ✅ Implementado | Renombrar lógica existente | Baja |
| SERVICE | ❌ No existe | Crear comportamiento nuevo | Media |
| BUNDLE/KIT | ❌ No existe | Crear descuento múltiple | Media |
| MANUFACTURED ON_DEMAND | ❌ No existe | **CRÍTICO - Cambio arquitectónico** | ALTA |
| MANUFACTURED TO_STOCK | ❌ No existe | **CRÍTICO - Nuevas entidades** | ALTA |
| BOM y Componentes | ❌ No existe | Tablas + relaciones nuevas | ALTA |
| Órdenes de Producción | ❌ No existe | Workflow completo nuevo | ALTA |
| FEFO en ON_DEMAND | ⚠️ Parcial | Aplicar a componentes | Media |
| Configuración Jerárquica | ✅ Existe para `requires_expiration` | Extender a `inventory_behavior` | Media |
| Trazabilidad Lote Componente | ❌ No existe | Rastreo componente → producto | Alta |

---

## 💥 IMPACTO EN BASE DE DATOS

### Nuevas Tablas (8 tablas)

```sql
1. bill_of_materials (BOM)
   - Define receta para producto MANUFACTURED
   - 1 BOM por product/variant
   - Versionado opcional

2. bom_components
   - Lista componentes de cada BOM
   - quantity, unit, waste_percentage
   - Soporte para alternativas (future)

3. production_orders
   - Órdenes de fabricación TO_STOCK
   - Estados: DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED → CANCELLED
   - Tracking de costos

4. production_order_lines
   - Componentes consumidos por orden
   - Trazabilidad lote consumido

5. production_outputs
   - Productos terminados generados
   - Asignación de lote
   - Costo calculado

6. bundle_compositions
   - Define qué productos incluye un BUNDLE/KIT
   - Similar a BOM pero sin producción

7. service_deliveries (opcional)
   - Registro de servicios prestados
   - Para trazabilidad y reportes

8. component_allocations (temporal)
   - Pre-asignación componentes para ON_DEMAND
   - Se limpia después de venta
```

### Modificaciones a Tablas Existentes

```sql
-- products
ALTER TABLE products 
ADD COLUMN inventory_behavior TEXT DEFAULT 'RESELL' 
  CHECK (inventory_behavior IN ('RESELL', 'MANUFACTURED', 'SERVICE', 'BUNDLE')),
ADD COLUMN production_type TEXT 
  CHECK (production_type IN ('ON_DEMAND', 'TO_STOCK', NULL)),
ADD COLUMN is_component BOOLEAN DEFAULT FALSE,
ADD COLUMN default_bom_id UUID REFERENCES bill_of_materials(bom_id);

-- product_variants (mismos campos, override)
ALTER TABLE product_variants
ADD COLUMN inventory_behavior TEXT 
  CHECK (inventory_behavior IN ('RESELL', 'MANUFACTURED', 'SERVICE', 'BUNDLE', NULL)),
ADD COLUMN production_type TEXT
  CHECK (production_type IN ('ON_DEMAND', 'TO_STOCK', NULL)),
ADD COLUMN bom_id UUID REFERENCES bill_of_materials(bom_id);

-- sale_lines (para ON_DEMAND tracking)
ALTER TABLE sale_lines
ADD COLUMN bom_snapshot JSONB,  -- BOM usado en venta ON_DEMAND
ADD COLUMN production_cost NUMERIC(14,2),  -- Costo calculado componentes
ADD COLUMN components_consumed JSONB;  -- Detalle componentes usados

-- inventory_moves (nuevos tipos)
-- Agregar tipos: PRODUCTION_IN, PRODUCTION_OUT, COMPONENT_CONSUMPTION, BUNDLE_OUT
```

### Nuevas Funciones (12 funciones)

```sql
1. fn_get_effective_inventory_behavior(p_tenant, p_variant) → TEXT
2. fn_get_effective_production_type(p_tenant, p_variant) → TEXT
3. fn_validate_bom_availability(p_tenant, p_location, p_bom, p_quantity) → BOOLEAN
4. fn_calculate_bom_cost(p_tenant, p_bom, p_quantity) → NUMERIC
5. fn_consume_bom_components(p_tenant, p_location, p_bom, p_quantity, p_source, p_source_id) → JSONB
6. fn_allocate_fefo_for_component(p_tenant, p_location, p_variant, p_quantity) → TABLE
7. fn_create_production_order(p_tenant, p_bom, p_quantity, p_due_date, ...) → UUID
8. fn_start_production(p_production_order) → VOID
9. fn_complete_production(p_production_order) → VOID
10. fn_explode_bundle(p_tenant, p_bundle_id, p_quantity) → TABLE
11. fn_validate_manufactured_sale(p_tenant, p_variant, p_quantity, p_location) → JSONB
12. fn_get_product_cost_breakdown(p_tenant, p_variant) → JSONB
```

### Stored Procedures Modificados (4 procedures)

```sql
1. sp_create_sale()
   ANTES: Solo valida stock disponible
   DESPUÉS: 
   - Detectar inventory_behavior
   - RESELL: comportamiento actual
   - SERVICE: skip inventario
   - BUNDLE: explotar componentes
   - MANUFACTURED ON_DEMAND: consumir componentes
   - MANUFACTURED TO_STOCK: consumir producto terminado

2. sp_create_purchase()
   DESPUÉS:
   - Validar que componentes no tengan BOM activo
   - Crear lote con cálculo de costo diferenciado

3. sp_complete_layaway_to_sale()
   DESPUÉS:
   - Aplicar misma lógica ON_DEMAND que ventas directas

4. sp_process_sale_return()
   DESPUÉS:
   - ON_DEMAND: ¿reversar consumos? (regla negocio)
   - BUNDLE: reversar componentes
```

---

## ⚙️ IMPACTO EN LÓGICA DE NEGOCIO

### Cambios CRÍTICOS en flow de venta

#### Actual (RESELL)
```
1. Buscar producto
2. Validar stock available >= cantidad
3. Agregar a carrito
4. Cobrar
5. Descontar inventory_batches (FEFO)
6. Crear inventory_move (SALE_OUT)
7. Actualizar stock_balances
```

#### Nuevo (MANUFACTURED ON_DEMAND - Ejemplo: Restaurante)
```
1. Buscar producto (ej: "Pizza Margarita")
2. Obtener BOM del producto
3. Validar disponibilidad de componentes:
   - Harina: 200g disponible? ✓
   - Queso: 100g disponible? ✓
   - Tomate: 50g disponible? ✓
4. Pre-reservar componentes (temporal)
5. Agregar a carrito (mostrar si faltan componentes)
6. Cobrar
7. Consumir componentes (FEFO aplicado a cada uno):
   - Descontar harina del lote más próximo a vencer
   - Descontar queso del lote más próximo a vencer
   - Descontar tomate del lote más próximo a vencer
8. Crear inventory_move (COMPONENT_CONSUMPTION) × 3
9. Calcular costo de venta = suma(costo componentes)
10. NO crear stock del producto terminado
11. Guardar snapshot BOM en sale_lines.bom_snapshot
```

#### Nuevo (MANUFACTURED TO_STOCK - Ejemplo: Panadería)
```
PRODUCCIÓN:
1. Crear orden de producción "Pan Integral - 50 unidades"
2. Validar componentes disponibles
3. Iniciar producción
4. Consumir componentes:
   - Harina integral: 5kg
   - Levadura: 100g
   - Sal: 50g
5. Crear inventory_move (PRODUCTION_OUT) para componentes
6. Generar 50 unidades de "Pan Integral"
7. Crear lote nuevo con fecha vencimiento
8. Crear inventory_move (PRODUCTION_IN)
9. Calcular costo unitario = (suma costos componentes + MOD + CIF) / 50
10. Actualizar stock_balances

VENTA:
1. Buscar producto "Pan Integral"
2. Validar stock disponible (producto terminado)
3. Agregar a carrito
4. Cobrar
5. Descontar del lote de producto terminado (FEFO)
6. NO tocar componentes
7. Crear inventory_move (SALE_OUT)
```

### Reglas de Validación Nuevas

```javascript
// Pseudo-código de validación en sp_create_sale()

effective_behavior = fn_get_effective_inventory_behavior(tenant, variant)
effective_production_type = fn_get_effective_production_type(tenant, variant)

SWITCH effective_behavior:
  
  CASE 'RESELL':
    IF stock_available < quantity THEN
      RAISE 'Stock insuficiente'
    END IF
    // Lógica actual
  
  CASE 'SERVICE':
    // NO validar stock
    // NO crear movimientos inventario
    // Solo registrar venta
  
  CASE 'BUNDLE':
    components = fn_explode_bundle(variant, quantity)
    FOR EACH component IN components:
      IF component.stock_available < component.required_qty THEN
        RAISE 'Stock insuficiente del componente: ' || component.name
      END IF
    END FOR
    // Descontar cada componente
  
  CASE 'MANUFACTURED':
    IF effective_production_type = 'ON_DEMAND' THEN
      bom = GET_BOM(variant)
      validation = fn_validate_bom_availability(tenant, location, bom, quantity)
      IF NOT validation.available THEN
        RAISE 'Componente faltante: ' || validation.missing_components
      END IF
      // Consumir componentes con FEFO
      consumed = fn_consume_bom_components(tenant, location, bom, quantity, 'SALE', sale_id)
      // Guardar snapshot
      UPDATE sale_lines SET 
        bom_snapshot = consumed.bom_snapshot,
        production_cost = consumed.total_cost,
        components_consumed = consumed.details
    
    ELSIF effective_production_type = 'TO_STOCK' THEN
      // Comportamiento igual a RESELL
      IF stock_available < quantity THEN
        RAISE 'Stock insuficiente del producto terminado'
      END IF
      // Descontar producto terminado, NO componentes
    END IF
```

---

## 📊 IMPACTO EN REPORTES Y VISTAS

### Nuevas Vistas (10 vistas)

```sql
1. vw_products_full_config
   - Muestra configuración efectiva de cada producto/variante
   - inventory_behavior, production_type, track_expiry

2. vw_bom_details
   - BOM con costos calculados
   - Componentes expandidos

3. vw_bom_availability
   - Stock disponible de componentes por BOM
   - Cuántas unidades se pueden producir

4. vw_production_orders_summary
   - Órdenes con estado, costos, productos generados

5. vw_component_usage_report
   - Consumo de componentes por período
   - Para reposición

6. vw_manufactured_products_cost
   - Costo de producción vs precio venta
   - Margen real

7. vw_service_revenue
   - Ingresos por servicios (sin inventario)

8. vw_bundle_compositions_expanded
   - Bundles con stock disponible de componentes

9. vw_sales_by_behavior
   - Ventas agrupadas por tipo de producto

10. vw_inventory_valuation_detailed
    - Valoración separando componentes vs terminados
```

### Reportes Modificados

| Reporte Existente | Cambio Necesario |
|-------------------|------------------|
| Ventas por producto | Agregar columna `inventory_behavior` |
| Valorización de inventario | Separar componentes vs productos terminados |
| Productos más vendidos | Excluir componentes (solo terminados) |
| Margen de utilidad | Calcular diferente para ON_DEMAND (costo componentes) |
| Stock bajo | No alertar componentes (solo si no hay BOM activo) |
| Kardex | Incluir movimientos PRODUCTION_IN/OUT |

---

## 🚨 RIESGOS IDENTIFICADOS

### Alto Impacto

1. **Cambio de paradigma en ventas**
   - Código sp_create_sale() actual asume RESELL
   - Refactor grande = alto riesgo de regresiones
   - **Mitigación**: Tests exhaustivos antes de deploy

2. **Performance con BOM complejos**
   - BOM de 50+ componentes puede ser lento
   - Validación recursiva (componente puede tener su propio BOM)
   - **Mitigación**: Índices, cache, limitar profundidad BOM

3. **Integridad de datos en producción**
   - Consumir componentes sin crear producto = desbalance
   - Transacciones deben ser atómicas
   - **Mitigación**: Triggers + validaciones + rollback completo

4. **Migración de datos existentes**
   - Productos actuales deben marcarse como RESELL
   - Sin downtime = migración online compleja
   - **Mitigación**: Script de migración idempotente

### Medio Impacto

5. **Capacitación de usuarios**
   - Concepto ON_DEMAND vs TO_STOCK no es intuitivo
   - Errores de configuración = ventas bloqueadas
   - **Mitigación**: Wizard de configuración + documentación

6. **Costos de componentes desactualizados**
   - Costo ON_DEMAND se calcula en tiempo real
   - Si costo componente cambió, margen varía
   - **Mitigación**: Promedio móvil o FIFO estricto

---

## 📅 PLAN DE IMPLEMENTACIÓN PROPUESTO

### Fase 1: Fundación (20-25 horas)
**Objetivo**: Agregar estructura base sin cambiar flujo actual

```sql
-- Deliverables:
1. ✅ Columnas inventory_behavior, production_type en products/variants
2. ✅ Funciones helper de configuración efectiva
3. ✅ Migración data: marcar existentes como RESELL
4. ✅ Modificar UI productos: agregar dropdowns nuevos
5. ✅ Tests unitarios funciones helper
```

### Fase 2: Servicios y BOM básico (25-30 horas)
**Objetivo**: Soporte para SERVICE + estructura BOM

```sql
-- Deliverables:
1. ✅ Tabla bill_of_materials + bom_components
2. ✅ UI para crear/editar BOM
3. ✅ Función fn_validate_bom_availability()
4. ✅ Función fn_calculate_bom_cost()
5. ✅ Modificar sp_create_sale(): detectar SERVICE (skip inventario)
6. ✅ Vista vw_bom_availability
7. ✅ Tests BOM availability
```

### Fase 3: MANUFACTURED ON_DEMAND (30-35 horas)
**Objetivo**: Ventas con consumo de componentes

```sql
-- Deliverables:
1. ✅ Función fn_consume_bom_components()
2. ✅ Función fn_allocate_fefo_for_component()
3. ✅ Modificar sp_create_sale(): MANUFACTURED ON_DEMAND
4. ✅ Columnas en sale_lines: bom_snapshot, production_cost, components_consumed
5. ✅ Tests venta ON_DEMAND con componentes
6. ✅ Validación componentes vencidos
7. ✅ UI: mostrar componentes necesarios en POS
8. ✅ Reporte: costo real vs precio venta ON_DEMAND
```

### Fase 4: Bundles/Kits (15-20 horas)
**Objetivo**: Descuento múltiple productos

```sql
-- Deliverables:
1. ✅ Tabla bundle_compositions
2. ✅ Función fn_explode_bundle()
3. ✅ Modificar sp_create_sale(): BUNDLE
4. ✅ UI configuración bundles
5. ✅ Tests bundle con stock parcial
```

### Fase 5: MANUFACTURED TO_STOCK (35-40 horas)
**Objetivo**: Órdenes de producción

```sql
-- Deliverables:
1. ✅ Tablas production_orders, production_order_lines, production_outputs
2. ✅ Funciones fn_create_production_order(), fn_start_production(), fn_complete_production()
3. ✅ UI: módulo órdenes de producción
4. ✅ Workflow: DRAFT → IN_PROGRESS → COMPLETED
5. ✅ Consumo componentes durante producción
6. ✅ Creación lote producto terminado
7. ✅ Cálculo costo (MOD + CIF opcional)
8. ✅ Modificar sp_create_sale(): MANUFACTURED TO_STOCK = RESELL
9. ✅ Reportes producción
10. ✅ Tests producción completa
```

### Fase 6: Refinamiento y Optimización (15-20 horas)
**Objetivo**: Performance + UX

```sql
-- Deliverables:
1. ✅ Índices optimizados
2. ✅ Cache configuración efectiva
3. ✅ Wizard configuración productos
4. ✅ Documentación usuario final
5. ✅ Tests de carga (BOM 100+ componentes)
6. ✅ Alertas componentes bajos
7. ✅ Dashboard producción
```

---

## 💰 ESTIMACIÓN TOTAL

| Fase | Horas Estimadas | Complejidad |
|------|-----------------|-------------|
| Fase 1: Fundación | 20-25 | Media |
| Fase 2: Servicios + BOM | 25-30 | Media-Alta |
| Fase 3: ON_DEMAND | 30-35 | ALTA |
| Fase 4: Bundles | 15-20 | Media |
| Fase 5: TO_STOCK | 35-40 | ALTA |
| Fase 6: Refinamiento | 15-20 | Media |
| **TOTAL** | **140-170** | - |

**Contingencia recomendada**: +20% = **168-204 horas**

**Tiempo calendario**: 4-6 semanas (con equipo dedicado)

---

## ✅ DECISIONES REQUERIDAS ANTES DE INICIAR

### Arquitectura
- [ ] ¿Permitir BOM recursivos (componente que es manufactured)?
- [ ] ¿Profundidad máxima BOM? (recomendado: 3 niveles)
- [ ] ¿Permitir múltiples BOM activos por producto?
- [ ] ¿Versionado de BOM o siempre latest?

### Costos
- [ ] ¿Método de costeo ON_DEMAND: promedio, FIFO, último costo?
- [ ] ¿Incluir MOD (mano de obra) en costo producción?
- [ ] ¿Incluir CIF (costos indirectos) en costo producción?
- [ ] ¿Recalcular costo producto terminado al cambiar componente?

### Inventario
- [ ] ¿Componente puede venderse solo o solo si tiene BOM?
- [ ] ¿Bloquear venta componente si hay órdenes producción pendientes?
- [ ] ¿Permitir producción con componentes vencidos?
- [ ] ¿FEFO aplica a productos terminados TO_STOCK?

### Devoluciones
- [ ] ¿Permitir devolución de producto ON_DEMAND?
- [ ] Si se devuelve, ¿reversar consumo de componentes?
- [ ] ¿Devolver a qué lote si componente ya no existe?

### Workflow
- [ ] ¿Requiere aprobación crear orden de producción?
- [ ] ¿Permitir producción parcial (producir menos de lo planeado)?
- [ ] ¿Permitir desperdicios (waste) en producción?
- [ ] ¿Tracking de tiempo por orden de producción?

---

## 🎯 PRÓXIMOS PASOS INMEDIATOS

1. **Revisión de este análisis** con stakeholders
2. **Validar decisiones arquitectónicas** (lista arriba)
3. **Aprobar presupuesto** (140-170 horas)
4. **Priorizar fases** (¿implementar todo o solo ON_DEMAND?)
5. **Definir criterios de aceptación** por fase
6. **Iniciar FRS detallado** (documento separado)

---

## 📌 CONCLUSIÓN

La implementación de manufactura es un **cambio arquitectónico mayor** que transforma el sistema de POS simple a ERP ligero. El impacto es alto pero el sistema actual tiene buenas bases (lotes, FEFO, multi-tenant).

**Recomendación**: Implementar por fases, comenzando con SERVICE y ON_DEMAND que son los más demandados. TO_STOCK puede ser fase posterior si presupuesto es limitado.

**Factor crítico de éxito**: Tests exhaustivos en cada fase antes de continuar. Un bug en consumo de componentes puede desbalancear inventario completo.
