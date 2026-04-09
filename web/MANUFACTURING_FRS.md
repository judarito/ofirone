# ESPECIFICACIÓN DE REQUERIMIENTOS FUNCIONALES (FRS)
## Sistema de Manufactura y Producción Multi-Tenant

**Versión**: 1.0  
**Fecha**: 2026-02-17  
**Proyecto**: Extensión POS → ERP con Manufactura  
**Elaborado por**: Product Owner Senior + Analista Funcional ERP  

---

## 1. ALCANCE

### 1.1 Objetivo
Extender el sistema POS multi-tenant existente para soportar modelos de negocio híbridos que incluyan:
- Reventa directa (modelo actual)
- Productos ensamblados mediante Lista de Materiales (BOM)
- Servicios sin afectación de inventario
- Producción bajo demanda (Make-to-Order)
- Producción a inventario (Make-to-Stock)

### 1.2 Fuera de Alcance
- Interfaz gráfica (UI/UX)
- Módulo de costos avanzado (ABC, estándar vs real)
- Planificación de capacidad (MRP II)
- Control de calidad (QC/QA)
- Mantenimiento de maquinaria
- Gestión de proyectos
- Integración con sistemas externos

### 1.3 Usuarios Finales
- Administradores de inventario
- Gerentes de producción
- Cajeros (POS)
- Contadores (reportes de costos)
- Gerentes comerciales

---

## 2. DEFINICIONES Y TÉRMINOS

### 2.1 Glosario ERP

| Término | Definición |
|---------|------------|
| **Lista de Materiales (BOM)** | Bill of Materials. Lista de componentes necesarios para fabricar/ensamblar un producto terminado |
| **Componente** | Materia prima o subproducto usado en la fabricación. Puede tener su propio BOM (BOM recursivo) |
| **Producto Terminado** | Resultado final de un proceso productivo. Puede venderse directamente |
| **Consumo** | Descuento de inventario de componentes durante producción o venta ON_DEMAND |
| **Producción** | Proceso de transformación de componentes en productos terminados |
| **Movimiento de Inventario** | Transacción que aumenta o disminuye stock (entrada, salida, ajuste, traslado) |
| **Lote** | Cantidad específica de producto con trazabilidad única (número, fecha recepción, vencimiento) |
| **FEFO** | First Expired, First Out. Política de salida que prioriza lotes más próximos a vencer |
| **Vencimiento** | Fecha límite para uso/venta de un lote |
| **Stock Disponible** | `on_hand - reserved`. Cantidad vendible no comprometida |
| **Reserved** | Cantidad apartada (ej: Plan Separé) pero no salida físicamente |
| **Tenant** | Empresa/organización en sistema multi-tenant. Aislamiento completo de datos |
| **Sede (Location)** | Punto de venta o bodega dentro de un tenant |
| **Variante (Variant)** | SKU específico de un producto (ej: "Camisa Roja M" es variante de "Camisa") |

### 2.2 Comportamientos de Inventario

| Código | Nombre | Descripción |
|--------|--------|-------------|
| **RESELL** | Reventa Directa | Producto comprado a proveedor y vendido sin transformación. Afecta inventario normalmente |
| **MANUFACTURED** | Manufacturado | Producto fabricado/ensamblado según BOM. Requiere `production_type` |
| **SERVICE** | Servicio | No afecta inventario. Venta registra ingreso sin movimiento físico de stock |
| **BUNDLE** | Kit/Paquete | Descuenta múltiples productos predefinidos sin proceso productivo. Ej: "Combo Desayuno" |

### 2.3 Tipos de Producción

| Código | Nombre | Descripción | Ejemplo |
|--------|--------|-------------|---------|
| **ON_DEMAND** | Bajo Demanda | El producto terminado NO existe en inventario. Se fabrica al momento de la venta | Restaurante: pizza se hace al pedir. Farmacia: fórmula magistral |
| **TO_STOCK** | A Inventario | El producto terminado SÍ existe en inventario. Se fabrica anticipadamente mediante órdenes de producción | Panadería: pan se hace en la mañana. Fábrica de ropa: producción por lotes |

---

## 3. JERARQUÍA DE CONFIGURACIÓN

### RF-001: Configuración Jerárquica
**Prioridad**: CRÍTICA

**Descripción**:  
El sistema DEBE soportar configuración a dos niveles: `products` (padre) y `product_variants` (hijo). La variante puede heredar o sobrescribir la configuración del producto.

**Atributos Jerárquicos**:
- `inventory_behavior` (RESELL / MANUFACTURED / SERVICE / BUNDLE)
- `production_type` (ON_DEMAND / TO_STOCK / NULL)
- `track_expiry` (boolean) - ya implementado

**Regla de Resolución**:
```
effective_behavior = COALESCE(product_variant.inventory_behavior, product.inventory_behavior, 'RESELL')
effective_production_type = COALESCE(product_variant.production_type, product.production_type, NULL)
effective_track_expiry = COALESCE(product_variant.track_expiry, product.track_expiry, FALSE)
```

**Validaciones**:
- Si `inventory_behavior` es diferente de `MANUFACTURED`, entonces `production_type` DEBE ser `NULL`
- Si `inventory_behavior = MANUFACTURED`, entonces `production_type` DEBE ser `ON_DEMAND` o `TO_STOCK`
- Si `inventory_behavior = SERVICE`, entonces `track_expiry` DEBE ser `FALSE`

**Funciones SQL Requeridas**:
```sql
CREATE FUNCTION fn_get_effective_inventory_behavior(
  p_tenant UUID, 
  p_variant UUID
) RETURNS TEXT;

CREATE FUNCTION fn_get_effective_production_type(
  p_tenant UUID, 
  p_variant UUID
) RETURNS TEXT;
```

---

## 4. REQUERIMIENTOS FUNCIONALES POR COMPORTAMIENTO

### 4.1 RESELL (Reventa Directa)

#### RF-100: Validación de Stock RESELL
**Prioridad**: ALTA

**Descripción**:  
Antes de permitir agregar un producto RESELL al carrito, el sistema DEBE validar que existe stock disponible suficiente.

**Entrada**:
- `tenant_id`
- `location_id`
- `variant_id`
- `quantity` (solicitada)

**Proceso**:
```sql
SELECT (on_hand - reserved) AS available
FROM stock_balances
WHERE tenant_id = {tenant_id}
  AND location_id = {location_id}
  AND variant_id = {variant_id};

IF available < quantity THEN
  RAISE EXCEPTION 'Stock insuficiente. Disponible: % | Solicitado: %', available, quantity;
END IF;
```

**Salida**:
- `TRUE` si disponible >= cantidad
- `EXCEPTION` si insuficiente

#### RF-101: Descuento de Inventario RESELL
**Prioridad**: CRÍTICA

**Descripción**:  
Al confirmar la venta, el sistema DEBE descontar el inventario aplicando política FEFO si `track_expiry = TRUE`.

**Proceso**:
1. Si `track_expiry = TRUE`:
   - Llamar `fn_allocate_stock_fefo(tenant, location, variant, quantity)`
   - Descontar de lotes ordenados por `expiration_date ASC NULLS LAST`
   - Registrar asignación en `sale_line_batches`
2. Si `track_expiry = FALSE`:
   - Descontar de lote genérico sin vencimiento
3. Crear `inventory_move` tipo `SALE_OUT`
4. Trigger actualiza `stock_balances` (vista materializada)

**Validación**:
- NO permitir venta si todos los lotes disponibles están vencidos y `tenant_settings.block_sale_when_expired = TRUE`

---

### 4.2 SERVICE (Servicios)

#### RF-200: Venta de Servicio Sin Inventario
**Prioridad**: MEDIA

**Descripción**:  
Los productos con `inventory_behavior = SERVICE` NO deben validar ni afectar inventario.

**Proceso de Venta**:
```
1. Detectar effective_behavior = 'SERVICE'
2. SKIP validación de stock
3. Registrar línea de venta normalmente
4. NO crear inventory_move
5. NO actualizar stock_balances
6. Calcular impuestos normalmente
7. Registrar ingreso contable
```

**Validaciones**:
- `track_inventory` DEBE ser `FALSE` para productos SERVICE
- NO permitir asignar BOM a productos SERVICE
- NO permitir configurar `track_expiry = TRUE`

#### RF-201: Reporte de Ingresos por Servicios
**Prioridad**: BAJA

**Descripción**:  
Vista separada para identificar ingresos por servicios vs productos físicos.

**Vista SQL**:
```sql
CREATE VIEW vw_service_revenue AS
SELECT 
  s.tenant_id,
  s.location_id,
  s.sold_at::DATE AS sale_date,
  sl.variant_id,
  pv.sku,
  p.name AS service_name,
  SUM(sl.quantity) AS units_sold,
  SUM(sl.line_total) AS revenue
FROM sales s
JOIN sale_lines sl ON sl.sale_id = s.sale_id
JOIN product_variants pv ON pv.variant_id = sl.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE fn_get_effective_inventory_behavior(s.tenant_id, sl.variant_id) = 'SERVICE'
GROUP BY s.tenant_id, s.location_id, s.sold_at::DATE, sl.variant_id, pv.sku, p.name;
```

---

### 4.3 BUNDLE/KIT (Paquetes)

#### RF-300: Definición de Composición de Bundle
**Prioridad**: MEDIA

**Descripción**:  
Un producto BUNDLE define una lista de productos que se descuentan simultáneamente sin proceso productivo.

**Modelo de Datos**:
```sql
CREATE TABLE bundle_compositions (
  composition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  bundle_variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  component_variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, bundle_variant_id, component_variant_id)
);
```

**Validaciones**:
- Un bundle NO puede incluirse a sí mismo (recursión directa)
- Un bundle NO puede incluir otro bundle (profundidad = 1)
- Todos los componentes DEBEN tener `inventory_behavior = RESELL` o `MANUFACTURED TO_STOCK`
- NO permitir componentes con `inventory_behavior = SERVICE`

#### RF-301: Validación de Disponibilidad Bundle
**Prioridad**: ALTA

**Descripción**:  
Antes de permitir venta de bundle, validar que TODOS los componentes tienen stock disponible.

**Función SQL**:
```sql
CREATE FUNCTION fn_validate_bundle_availability(
  p_tenant UUID,
  p_location UUID,
  p_bundle_variant UUID,
  p_quantity NUMERIC
) 
RETURNS TABLE (
  available BOOLEAN,
  missing_components JSONB
);
```

**Lógica**:
```sql
FOR EACH component IN bundle_compositions WHERE bundle_variant_id = p_bundle:
  required_qty = component.quantity * p_quantity
  available_qty = stock_balances.available WHERE variant = component_variant_id
  
  IF available_qty < required_qty THEN
    available = FALSE
    missing_components[] = {
      "variant_id": component_variant_id,
      "sku": sku,
      "name": product.name,
      "required": required_qty,
      "available": available_qty,
      "shortage": required_qty - available_qty
    }
  END IF
END FOR
```

#### RF-302: Descuento de Componentes Bundle
**Prioridad**: ALTA

**Descripción**:  
Al confirmar venta de bundle, descontar cada componente del inventario.

**Proceso**:
```
1. Explotar bundle: fn_explode_bundle(bundle_variant, quantity)
2. Para cada componente:
   a. Validar stock disponible
   b. Aplicar FEFO si componente tiene track_expiry = TRUE
   c. Descontar de inventory_batches
   d. Crear inventory_move tipo BUNDLE_OUT
   e. Registrar en sale_line_components (trazabilidad)
3. NO crear stock del bundle (es virtual)
4. Calcular costo venta = suma(costo_componente * qty_componente)
```

**Tabla Trazabilidad**:
```sql
CREATE TABLE sale_line_components (
  sale_line_component_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  sale_line_id UUID NOT NULL,
  component_variant_id UUID NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL,
  batch_id UUID REFERENCES inventory_batches(batch_id)
);
```

---

### 4.4 MANUFACTURED ON_DEMAND (Producción Bajo Demanda)

#### RF-400: Definición de Lista de Materiales (BOM)
**Prioridad**: CRÍTICA

**Descripción**:  
Un producto MANUFACTURED debe tener una Lista de Materiales que defina los componentes necesarios.

**Modelo de Datos**:
```sql
CREATE TABLE bill_of_materials (
  bom_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID REFERENCES products(product_id),
  variant_id UUID REFERENCES product_variants(variant_id),
  bom_code TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),
  notes TEXT,
  UNIQUE(tenant_id, product_id, variant_id, version),
  CHECK ((product_id IS NOT NULL AND variant_id IS NULL) OR 
         (product_id IS NULL AND variant_id IS NOT NULL))
);

CREATE TABLE bom_components (
  component_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  bom_id UUID NOT NULL REFERENCES bill_of_materials(bom_id) ON DELETE CASCADE,
  component_variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL, -- 'UND', 'KG', 'LT', 'GR', 'ML'
  waste_percentage NUMERIC(5,2) DEFAULT 0 CHECK (waste_percentage >= 0 AND waste_percentage <= 100),
  is_optional BOOLEAN DEFAULT FALSE,
  sequence INTEGER, -- Orden de consumo (future)
  notes TEXT,
  UNIQUE(tenant_id, bom_id, component_variant_id)
);
```

**Reglas**:
- BOM puede estar a nivel `product` (todas las variantes heredan) o `variant` (específico)
- Solo UN BOM activo por product o variant
- `waste_percentage`: desperdicio estimado (ej: 5% = se consume 1.05x la cantidad teórica)
- Componentes pueden ser RESELL o MANUFACTURED (BOM recursivo)

#### RF-401: Validación de Disponibilidad BOM
**Prioridad**: CRÍTICA

**Descripción**:  
Antes de permitir venta ON_DEMAND, validar que TODOS los componentes del BOM tienen stock disponible.

**Función SQL**:
```sql
CREATE FUNCTION fn_validate_bom_availability(
  p_tenant UUID,
  p_location UUID,
  p_bom UUID,
  p_quantity NUMERIC
) 
RETURNS TABLE (
  available BOOLEAN,
  total_cost NUMERIC,
  missing_components JSONB,
  allocation_plan JSONB
);
```

**Lógica**:
```sql
FOR EACH component IN bom_components WHERE bom_id = p_bom:
  -- Ajustar por desperdicio
  required_qty = component.quantity * p_quantity * (1 + component.waste_percentage / 100)
  
  -- Verificar disponibilidad
  IF component.is_optional = FALSE THEN
    available_qty = fn_get_component_available(tenant, location, component_variant_id)
    
    IF available_qty < required_qty THEN
      missing_components[] = {...}
      available = FALSE
    END IF
  END IF
  
  -- Calcular costo
  component_cost = fn_get_component_cost(tenant, component_variant_id)
  total_cost += component_cost * required_qty
END FOR
```

**Consideraciones**:
- Si componente es MANUFACTURED, resolver recursivamente su BOM
- Límite de profundidad: 5 niveles (configurable en `tenant_settings`)
- Cache resultados para performance (TTL 30 segundos)

#### RF-402: Consumo de Componentes ON_DEMAND
**Prioridad**: CRÍTICA

**Descripción**:  
Al confirmar venta ON_DEMAND, consumir componentes del inventario aplicando FEFO.

**Función SQL**:
```sql
CREATE FUNCTION fn_consume_bom_components(
  p_tenant UUID,
  p_location UUID,
  p_bom UUID,
  p_quantity NUMERIC,
  p_source TEXT, -- 'SALE'
  p_source_id UUID, -- sale_id
  p_created_by UUID
) 
RETURNS TABLE (
  success BOOLEAN,
  total_cost NUMERIC,
  components_consumed JSONB,
  bom_snapshot JSONB
);
```

**Proceso**:
```
1. Validar disponibilidad: fn_validate_bom_availability()
2. Para cada componente obligatorio:
   a. Calcular cantidad ajustada por desperdicio
   b. Si component.track_expiry = TRUE:
      - Aplicar FEFO: fn_allocate_fefo_for_component()
      - Descontar de lotes más próximos a vencer
      - Registrar lote usado en component_allocations
   c. Si component.track_expiry = FALSE:
      - Descontar de lote genérico
   d. Crear inventory_move tipo COMPONENT_CONSUMPTION
   e. Acumular costo: component_unit_cost * qty_consumed
3. Crear snapshot del BOM usado:
   bom_snapshot = {
     "bom_id": ...,
     "bom_code": ...,
     "consumed_at": NOW(),
     "components": [
       {
         "variant_id": ...,
         "sku": ...,
         "name": ...,
         "quantity_required": ...,
         "quantity_consumed": ...,
         "waste_applied": ...,
         "unit_cost": ...,
         "total_cost": ...,
         "batches": [...]
       }
     ]
   }
4. Retornar total_cost, snapshot, components_consumed
```

**Validaciones**:
- Transacción DEBE ser atómica (rollback completo si falla un componente)
- NO permitir consumo si componente está vencido y `block_sale_when_expired = TRUE`
- Registrar warning si componente está por vencer (<7 días) en `sale_warnings`

#### RF-403: Almacenamiento de Snapshot BOM en Venta
**Prioridad**: ALTA

**Descripción**:  
La venta ON_DEMAND debe guardar snapshot del BOM usado para trazabilidad histórica.

**Columnas en sale_lines**:
```sql
ALTER TABLE sale_lines ADD COLUMN bom_snapshot JSONB;
ALTER TABLE sale_lines ADD COLUMN production_cost NUMERIC(14,2);
ALTER TABLE sale_lines ADD COLUMN components_consumed JSONB;
```

**Razón**:  
Si el BOM cambia en el futuro, el costo histórico de la venta debe mantenerse consistente.

#### RF-404: Costo de Venta ON_DEMAND
**Prioridad**: ALTA

**Descripción**:  
El costo de venta de un producto ON_DEMAND es la suma de los costos de los componentes consumidos.

**Cálculo**:
```sql
production_cost = SUM(component_unit_cost × quantity_consumed)

-- Si se incluye MOD/CIF (opcional):
production_cost += labor_cost + overhead_cost
```

**Método de Costeo de Componentes** (configurable en tenant_settings):
- `FIFO`: Costo del lote más antiguo
- `AVERAGE`: Promedio móvil
- `LAST`: Último costo de compra

**Margen Real**:
```
margin = (line_total - production_cost) / line_total × 100
```

---

### 4.5 MANUFACTURED TO_STOCK (Producción a Inventario)

#### RF-500: Orden de Producción
**Prioridad**: CRÍTICA

**Descripción**:  
Crear órdenes de producción para fabricar productos terminados anticipadamente.

**Modelo de Datos**:
```sql
CREATE TABLE production_orders (
  production_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  order_number TEXT NOT NULL,
  bom_id UUID NOT NULL REFERENCES bill_of_materials(bom_id),
  product_variant_id UUID NOT NULL,
  
  -- Cantidades
  quantity_planned NUMERIC(14,3) NOT NULL CHECK (quantity_planned > 0),
  quantity_produced NUMERIC(14,3) DEFAULT 0,
  
  -- Estados
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  
  -- Fechas
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  
  -- Costos
  estimated_cost NUMERIC(14,2),
  actual_cost NUMERIC(14,2),
  labor_cost NUMERIC(14,2) DEFAULT 0,
  overhead_cost NUMERIC(14,2) DEFAULT 0,
  
  -- Auditoría
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),
  started_by UUID REFERENCES users(user_id),
  completed_by UUID REFERENCES users(user_id),
  
  notes TEXT,
  
  UNIQUE(tenant_id, order_number)
);

CREATE TABLE production_order_lines (
  line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  production_order_id UUID NOT NULL,
  component_variant_id UUID NOT NULL,
  quantity_required NUMERIC(14,3) NOT NULL,
  quantity_consumed NUMERIC(14,3) DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL,
  batch_id UUID REFERENCES inventory_batches(batch_id),
  consumed_at TIMESTAMPTZ
);

CREATE TABLE production_outputs (
  output_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  production_order_id UUID NOT NULL,
  batch_id UUID NOT NULL REFERENCES inventory_batches(batch_id),
  quantity_produced NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL, -- Costo promedio de producción
  produced_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### RF-501: Creación de Orden de Producción
**Prioridad**: ALTA

**Función SQL**:
```sql
CREATE FUNCTION fn_create_production_order(
  p_tenant UUID,
  p_location UUID,
  p_bom UUID,
  p_quantity NUMERIC,
  p_scheduled_start TIMESTAMPTZ,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID; -- production_order_id
```

**Proceso**:
```
1. Validar BOM existe y está activo
2. Validar variant es MANUFACTURED TO_STOCK
3. Generar order_number: 'PRD-{date}-{seq}'
4. Calcular estimated_cost: fn_calculate_bom_cost(bom, quantity)
5. Insertar production_orders con status='DRAFT'
6. Crear production_order_lines desde bom_components
7. Validar disponibilidad de componentes (advisory, no blocking)
8. Retornar production_order_id
```

#### RF-502: Inicio de Producción
**Prioridad**: ALTA

**Función SQL**:
```sql
CREATE FUNCTION fn_start_production(
  p_production_order UUID,
  p_started_by UUID
) RETURNS VOID;
```

**Proceso**:
```
1. Validar status = 'DRAFT' o 'SCHEDULED'
2. Validar disponibilidad componentes: fn_validate_bom_availability()
3. Si falta componente: RAISE EXCEPTION o permitir (configurable)
4. Actualizar status = 'IN_PROGRESS'
5. Set actual_start = NOW()
6. Set started_by = p_started_by
```

#### RF-503: Consumo de Componentes en Producción
**Prioridad**: CRÍTICA

**Descripción**:  
Durante la producción, consumir componentes del inventario.

**Opciones**:
1. **Consumo automático al completar**: Simple pero no permite tracking intermedio
2. **Consumo manual por componente**: Más control pero más pasos
3. **Consumo automático al iniciar**: Pre-reserva componentes

**Opción Recomendada**: Consumo automático al completar (RF-504)

#### RF-504: Completar Producción
**Prioridad**: CRÍTICA

**Función SQL**:
```sql
CREATE FUNCTION fn_complete_production(
  p_production_order UUID,
  p_quantity_produced NUMERIC, -- Permite producción parcial
  p_expiration_date DATE DEFAULT NULL,
  p_physical_location TEXT DEFAULT NULL,
  p_completed_by UUID
) RETURNS UUID; -- batch_id del producto terminado
```

**Proceso**:
```
1. Validar status = 'IN_PROGRESS'
2. Validar quantity_produced <= quantity_planned
3. Obtener BOM de la orden
4. Para cada componente:
   a. Calcular qty_to_consume = (component.qty / quantity_planned) * quantity_produced
   b. Ajustar por desperdicio
   c. Aplicar FEFO si track_expiry = TRUE
   d. Descontar de inventory_batches
   e. Crear inventory_move tipo PRODUCTION_OUT
   f. Actualizar production_order_lines.quantity_consumed
   g. Acumular actual_cost
5. Crear lote de producto terminado:
   INSERT INTO inventory_batches (
     batch_number = 'PRD-{order_number}-{seq}',
     expiration_date = p_expiration_date,
     on_hand = quantity_produced,
     unit_cost = actual_cost / quantity_produced
   )
6. Crear inventory_move tipo PRODUCTION_IN
7. Insertar production_outputs
8. Actualizar production_orders:
   - status = 'COMPLETED'
   - quantity_produced = p_quantity_produced
   - actual_end = NOW()
   - completed_by = p_completed_by
9. Retornar batch_id creado
```

**Validaciones**:
- Si falta componente: RAISE EXCEPTION
- Si componente vencido: RAISE WARNING o EXCEPTION (configurable)
- Transacción atómica

#### RF-505: Producción Parcial
**Prioridad**: MEDIA

**Descripción**:  
Permitir completar una orden con cantidad menor a la planeada.

**Regla**:
- Si `quantity_produced < quantity_planned`, orden queda en estado `COMPLETED` pero con nota de producción parcial
- Componentes se consumen proporcionalmente: `(qty_required / qty_planned) * qty_produced`
- No se permite reiniciar orden completada

#### RF-506: Cancelación de Orden
**Prioridad**: MEDIA

**Función SQL**:
```sql
CREATE FUNCTION fn_cancel_production_order(
  p_production_order UUID,
  p_reason TEXT,
  p_cancelled_by UUID
) RETURNS VOID;
```

**Reglas**:
- Solo se puede cancelar si status = 'DRAFT' o 'SCHEDULED'
- Si status = 'IN_PROGRESS': RAISE EXCEPTION o permitir (configurable)
- No reversar consumos ya hechos (requiere ajuste manual)

#### RF-507: Venta de Producto TO_STOCK
**Prioridad**: ALTA

**Descripción**:  
La venta de un producto MANUFACTURED TO_STOCK se comporta idénticamente a RESELL.

**Proceso**:
```
1. Detectar effective_production_type = 'TO_STOCK'
2. Validar stock disponible del producto terminado (NO componentes)
3. Aplicar FEFO si track_expiry = TRUE
4. Descontar producto terminado
5. Crear inventory_move tipo SALE_OUT
6. Usar unit_cost del lote del producto terminado
7. NO consumir componentes (ya fueron consumidos en producción)
```

---

## 5. REGLAS DE NEGOCIO TRANSVERSALES

### RN-001: Consistencia de Configuración
**Prioridad**: CRÍTICA

**Regla**:  
El sistema DEBE calcular la configuración efectiva de cada variante al momento de cada operación, NO cachear indefinidamente.

**Razón**:  
Si un administrador cambia `inventory_behavior` de un producto de RESELL a MANUFACTURED, las ventas nuevas deben reflejarlo inmediatamente.

**Implementación**:
```sql
-- Llamar en cada transacción
effective_behavior := fn_get_effective_inventory_behavior(tenant, variant);
```

### RN-002: Versionado de BOM
**Prioridad**: MEDIA

**Regla**:  
Cada cambio a un BOM debe crear una nueva versión, manteniendo versiones anteriores para trazabilidad histórica.

**Implementación**:
```sql
-- Al editar BOM:
UPDATE bill_of_materials SET is_active = FALSE WHERE bom_id = {old_bom};
INSERT INTO bill_of_materials (..., version = {old_version} + 1, is_active = TRUE);
```

**Excepción**:  
Cambios menores (notes, physical_location) NO requieren nueva versión.

### RN-003: Profundidad Máxima BOM
**Prioridad**: MEDIA

**Regla**:  
Limitar la profundidad de BOM recursivos a un máximo configurable (default: 5 niveles).

**Razón**:  
Prevenir loops infinitos y problemas de performance.

**Validación**:
```sql
CREATE FUNCTION fn_validate_bom_depth(
  p_bom UUID,
  p_max_depth INT DEFAULT 5
) RETURNS BOOLEAN;
```

### RN-004: Componentes Vendibles
**Prioridad**: BAJA

**Regla** (configurable en tenant_settings):
- Opción 1: Componente solo puede venderse si no tiene BOM activo que lo use
- Opción 2: Componente puede venderse libremente (puede causar faltantes)

**Recomendación**: Opción 2 con alertas.

### RN-005: Cálculo de Descuentos en ON_DEMAND
**Prioridad**: ALTA

**Regla**:  
Si se aplica descuento a una línea de venta ON_DEMAND, el descuento afecta el precio de venta pero NO el costo de producción.

**Ejemplo**:
```
Producto: Pizza Margarita
Costo componentes: $10,000
Precio venta: $20,000
Descuento 10%: -$2,000
Precio final: $18,000

Margen = (18,000 - 10,000) / 18,000 = 44.4%
```

### RN-006: Impuestos en MANUFACTURED
**Prioridad**: ALTA

**Regla**:  
Los impuestos se calculan sobre el precio de venta final, NO sobre el costo de producción.

**Razón**:  
El costo de producción es interno, el cliente paga impuestos sobre el precio publicado.

### RN-007: Devolución de Producto ON_DEMAND
**Prioridad**: MEDIA

**Regla** (decisión de negocio requerida):
- Opción 1: NO permitir devolución de productos ON_DEMAND (política de no devoluciones)
- Opción 2: Permitir devolución pero NO reversar consumo de componentes (pérdida asumida)
- Opción 3: Permitir devolución y retornar componentes a inventario (complejo, puede ser imposible físicamente)

**Recomendación**: Opción 2 con reembolso parcial (ej: 50% del valor).

### RN-008: Devolución de Bundle
**Prioridad**: MEDIA

**Regla**:  
Al devolver un bundle, se retornan los componentes al inventario a los lotes de donde salieron.

**Implementación**:
```sql
1. Consultar sale_line_components WHERE sale_line_id = {bundle_line}
2. Para cada componente:
   a. Retornar cantidad al batch_id original
   b. Crear inventory_move tipo RETURN_IN
3. Actualizar stock_balances
```

---

## 6. VALIDACIONES OBLIGATORIAS

### VAL-001: Validación de BOM Circular
**Prioridad**: ALTA

**Descripción**:  
Impedir que un producto sea componente de su propio BOM (directa o indirectamente).

**Validación**:
```sql
CREATE FUNCTION fn_detect_bom_circular_reference(
  p_bom UUID
) RETURNS BOOLEAN;
```

**Algoritmo**:
```
visited = []
stack = [p_bom]

WHILE stack NOT EMPTY:
  current_bom = stack.pop()
  
  IF current_bom IN visited THEN
    RETURN TRUE -- Círculo detectado
  END IF
  
  visited.append(current_bom)
  
  FOR EACH component IN bom_components WHERE bom_id = current_bom:
    component_bom = SELECT bom_id FROM bill_of_materials WHERE variant_id = component.component_variant_id
    IF component_bom IS NOT NULL THEN
      stack.append(component_bom)
    END IF
  END FOR
END WHILE

RETURN FALSE
```

### VAL-002: Validación de Stock Negativo
**Prioridad**: CRÍTICA

**Descripción**:  
NUNCA permitir que `on_hand` o `reserved` sean negativos.

**Implementación**:
```sql
ALTER TABLE inventory_batches 
ADD CONSTRAINT chk_on_hand_positive CHECK (on_hand >= 0),
ADD CONSTRAINT chk_reserved_positive CHECK (reserved >= 0),
ADD CONSTRAINT chk_reserved_not_exceed CHECK (reserved <= on_hand);
```

### VAL-003: Validación de Fecha de Vencimiento
**Prioridad**: ALTA

**Descripción**:  
Si `track_expiry = TRUE`, BLOQUEAR ingreso sin fecha de vencimiento.

**Implementación**:
```sql
-- En sp_create_purchase() o fn_create_batch():
effective_track_expiry := fn_get_effective_track_expiry(tenant, variant);

IF effective_track_expiry = TRUE AND p_expiration_date IS NULL THEN
  RAISE EXCEPTION 'Producto % requiere fecha de vencimiento', sku;
END IF;
```

### VAL-004: Validación de Venta de Producto Vencido
**Prioridad**: ALTA

**Descripción**:  
Si `tenant_settings.block_sale_when_expired = TRUE`, impedir venta de lotes vencidos.

**Implementación**:
```sql
-- En fn_allocate_stock_fefo():
FOR each_batch IN batches_ordered_by_expiry:
  IF each_batch.expiration_date < CURRENT_DATE THEN
    IF tenant_settings.block_sale_when_expired THEN
      RAISE EXCEPTION 'No se puede vender producto vencido (lote %)', batch_number;
    ELSE
      INSERT INTO sale_warnings (type='EXPIRED_STOCK', severity='CRITICAL', ...);
    END IF
  END IF
END FOR
```

### VAL-005: Validación de Cantidad en BOM
**Prioridad**: MEDIA

**Descripción**:  
Las cantidades en `bom_components` deben ser positivas y razonables.

**Implementación**:
```sql
ALTER TABLE bom_components 
ADD CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
ADD CONSTRAINT chk_quantity_reasonable CHECK (quantity <= 1000000); -- Prevenir errores de input
```

### VAL-006: Validación de Suma de Pagos
**Prioridad**: CRÍTICA

**Descripción**:  
La suma de `sale_payments.amount` DEBE igualar `sales.total` (ya implementado).

**Aplicación a MANUFACTURED**:  
Ningún cambio necesario, aplica igual para todos los tipos.

---

## 7. CASOS LÍMITE (Edge Cases)

### EDGE-001: Componente con Stock Cero Durante Venta ON_DEMAND
**Escenario**:  
Usuario A está vendiendo pizza que requiere queso. Usuario B vende el último queso mientras Usuario A aún está en el carrito.

**Comportamiento Esperado**:
```
1. Usuario A agrega pizza al carrito (pre-validación OK)
2. Sistema pre-reserva componentes (temporal, no committed)
3. Usuario B completa venta normal de queso
4. Usuario A intenta cobrar
5. sp_create_sale() valida nuevamente disponibilidad
6. Detecta falta de queso
7. RAISE EXCEPTION 'Componente queso ya no disponible'
8. Usuario A debe remover pizza del carrito
```

**Solución**:  
Validar disponibilidad en 2 momentos:
- Al agregar al carrito (advisory)
- Al confirmar venta (CRITICAL)

### EDGE-002: BOM Modificado Durante Venta
**Escenario**:  
Administrador cambia BOM de "Hamburguesa" mientras cajero tiene una en el carrito.

**Comportamiento Esperado**:
```
1. Cajero agrega hamburguesa (BOM versión 1: pan + carne + lechuga)
2. Admin publica BOM versión 2: pan + carne + lechuga + tomate
3. Cajero cobra
4. Sistema usa BOM.is_active = TRUE al momento de sp_create_sale()
5. Consume según BOM versión 2 (nueva)
6. Guardar snapshot en sale_lines.bom_snapshot
```

**Alternativa**:  
Congelar BOM al agregar al carrito (requiere tabla temporal `cart_bom_snapshot`).

### EDGE-003: Orden de Producción Parcialmente Completada
**Escenario**:  
Orden para 100 unidades, solo se produjeron 80 porque faltó un componente.

**Comportamiento Esperado**:
```
1. fn_complete_production(order, quantity_produced=80)
2. Consumir componentes proporcionalmente:
   - Si BOM requiere 2kg harina por 100 unidades
   - Consumir 1.6kg harina (2 * 80/100)
3. Crear lote de producto terminado con 80 unidades
4. Marcar orden como COMPLETED
5. Registrar nota: "Producción parcial: 80/100 unidades"
6. Calcular unit_cost = actual_cost / 80
```

**Decisión**: NO permitir reiniciar orden completada. Si se necesitan más unidades, crear nueva orden.

### EDGE-004: Componente con Múltiples Unidades de Medida
**Escenario**:  
BOM requiere "Harina 500gr" pero inventario está en "Harina 1kg" y "Harina 500gr".

**Comportamiento Esperado**:
```
1. BOM define bom_components.unit = 'GR'
2. Componente tiene variant.unit = 'KG'
3. Sistema NO hace conversión automática
4. Requiere que BOM y stock usen misma unidad
```

**Alternativa Futura**:  
Tabla `unit_conversions` para convertir automáticamente (ej: 1 KG = 1000 GR).

### EDGE-005: Devolución Parcial de Bundle
**Escenario**:  
Cliente compra "Combo Desayuno" (café + pan + jugo) pero solo devuelve el café.

**Comportamiento Esperado** (decisión de negocio):
- Opción 1: NO permitir devolución parcial de bundle
- Opción 2: Permitir pero calcular valor proporcional:
  ```
  precio_combo = $10,000
  precio_cafe_solo = $3,000
  reembolso = $3,000
  retornar_inventario = solo café
  ```

**Recomendación**: Opción 1 (más simple).

### EDGE-006: Componente Vencido en Producción TO_STOCK
**Escenario**:  
Orden de producción de pan requiere levadura vencida.

**Comportamiento Esperado** (configurable):
- Si `block_production_with_expired = TRUE`: RAISE EXCEPTION
- Si `FALSE`: Permitir pero registrar en `production_warnings`

**Recomendación**: Permitir con warning (decisión de supervisor de producción).

### EDGE-007: Stock Reservado vs Producción
**Escenario**:  
Harina tiene 10kg disponibles, 5kg reservados (Plan Separé). Orden de producción requiere 8kg.

**Comportamiento Esperado**:
```
available = on_hand - reserved = 10 - 5 = 5kg
required = 8kg

IF available < required THEN
  RAISE EXCEPTION 'Stock insuficiente. Disponible: 5kg | Requerido: 8kg'
END IF

-- Producción NO debe consumir stock reservado
```

**Regla**: Producción respeta reservas de Plan Separé.

### EDGE-008: Venta ON_DEMAND con Descuento Global
**Escenario**:  
Cajero aplica 10% descuento global a venta con 3 productos ON_DEMAND.

**Comportamiento Esperado**:
```
1. Calcular subtotal de cada línea sin descuento
2. Calcular total sin descuento = suma(subtotales)
3. Aplicar descuento global: descuento_total = total * 0.10
4. Distribuir descuento proporcionalmente:
   descuento_linea[i] = (subtotal[i] / total) * descuento_total
5. Recalcular impuestos sobre (subtotal - descuento_linea)
6. Consumir componentes de cada producto ON_DEMAND
7. Calcular margen con descuento aplicado
```

**Importante**: El descuento NO afecta el costo de producción.

### EDGE-009: Cambio de Comportamiento de Producto Existente
**Escenario**:  
Producto "Ensalada" cambia de RESELL (comprada pre-hecha) a MANUFACTURED ON_DEMAND (armada en local).

**Comportamiento Esperado**:
```
1. Admin cambia product.inventory_behavior = 'MANUFACTURED'
2. Admin configura production_type = 'ON_DEMAND'
3. Admin crea BOM con componentes (lechuga, tomate, etc)
4. Stock existente de "Ensalada" terminada queda huérfano
5. Sistema muestra warning: "Producto tiene stock pero cambió a ON_DEMAND"
6. Admin debe:
   a. Vender stock restante con precio especial, O
   b. Ajustar inventario a cero con nota
7. Ventas nuevas consumen componentes según BOM
```

**Validación**:
```sql
IF changing to MANUFACTURED ON_DEMAND AND stock_balances.on_hand > 0 THEN
  RAISE WARNING 'Producto tiene stock existente que quedará sin usar';
END IF;
```

### EDGE-010: Servicio con Costo
**Escenario**:  
Servicio "Instalación" no afecta inventario pero tiene costo interno (mano de obra).

**Comportamiento Esperado**:
```
1. inventory_behavior = 'SERVICE'
2. variant.cost = $5,000 (costo MOD interno)
3. variant.price = $15,000 (precio al cliente)
4. Venta registra ingreso de $15,000
5. NO crea inventory_move
6. Reporte de margen:
   margen = (15,000 - 5,000) / 15,000 = 66.7%
```

**Nota**: `variant.cost` para SERVICE es referencial (no sale de inventario).

### EDGE-011: Bundle con Componente MANUFACTURED
**Escenario**:  
"Combo Almuerzo" incluye "Sopa" (ON_DEMAND) + "Jugo" (RESELL).

**Comportamiento Esperado** (decisión arquitectónica):
- Opción 1: NO permitir (bundle solo puede incluir RESELL o MANUFACTURED TO_STOCK)
- Opción 2: Permitir, explotar BOM de "Sopa" recursivamente

**Recomendación**: Opción 1 (simplicidad). Si necesita incluir ON_DEMAND, crear la "Sopa" como producto independiente.

### EDGE-012: Producción con Componente Agotado Post-Inicio
**Escenario**:  
Orden de producción inicia con todos componentes disponibles. Durante producción (que toma 2 horas), otro usuario vende un componente necesario.

**Comportamiento Esperado**:
```
1. fn_start_production() valida disponibilidad (OK)
2. Status = IN_PROGRESS (componentes NO son reservados aún)
3. Usuario B vende componente X
4. 2 horas después: fn_complete_production()
5. Intenta consumir componente X
6. RAISE EXCEPTION 'Componente X agotado'
7. Supervisor debe:
   a. Esperar reposición de X, O
   b. Cancelar orden, O
   c. Completar orden parcial sin X (si es opcional)
```

**Solución**: Pre-reservar componentes al iniciar producción (implementación futura).

---

## 8. CRITERIOS DE ACEPTACIÓN (Given/When/Then)

### Caso 1: Venta Simple RESELL
```
GIVEN un producto con inventory_behavior = 'RESELL'
  AND stock disponible = 10 unidades
  AND precio = $5,000
WHEN usuario vende 3 unidades
THEN stock disponible = 7 unidades
  AND se crea inventory_move tipo SALE_OUT cantidad 3
  AND se registra venta por $15,000
  AND margen = (15,000 - costo_unitario*3) / 15,000
```

### Caso 2: Venta de Servicio
```
GIVEN un producto con inventory_behavior = 'SERVICE'
  AND precio = $20,000
  AND costo referencial = $5,000
WHEN usuario vende 1 servicio
THEN NO se crea inventory_move
  AND NO se valida stock
  AND se registra venta por $20,000
  AND margen = (20,000 - 5,000) / 20,000 = 75%
```

### Caso 3: Venta Bundle con Stock Parcial

```
GIVEN un bundle con 2 componentes:
  - Producto A: stock = 5
  - Producto B: stock = 2
  AND bundle requiere 1 unidad de cada
WHEN usuario intenta vender 3 bundles
THEN sistema valida disponibilidad
  AND detecta Producto B insuficiente (requiere 3, disponible 2)
  AND RAISE EXCEPTION 'Stock insuficiente del componente: Producto B'
  AND venta NO se completa
```

### Caso 4: Venta ON_DEMAND Exitosa
```
GIVEN un producto con inventory_behavior = 'MANUFACTURED'
  AND production_type = 'ON_DEMAND'
  AND BOM requiere:
    - Harina: 200g (stock disponible = 5kg)
    - Queso: 100g (stock disponible = 1kg)
  AND precio venta = $15,000
WHEN usuario vende 1 unidad
THEN sistema valida disponibilidad componentes (OK)
  AND consume 200g harina del lote más próximo a vencer
  AND consume 100g queso del lote más próximo a vencer
  AND crea 2 inventory_move tipo COMPONENT_CONSUMPTION
  AND calcula costo = (costo_harina*0.2 + costo_queso*0.1)
  AND guarda bom_snapshot en sale_lines
  AND NO crea stock del producto terminado
  AND registra venta por $15,000
```

### Caso 5: Venta ON_DEMAND con Componente Faltante
```
GIVEN un producto ON_DEMAND con BOM requiriendo:
  - Componente A: stock = 10
  - Componente B: stock = 0
WHEN usuario intenta vender 1 unidad
THEN sistema valida BOM
  AND detecta Componente B faltante
  AND RAISE EXCEPTION 'Componente faltante: Componente B'
  AND venta NO se completa
```

### Caso 6: Creación de Orden de Producción
```
GIVEN un producto MANUFACTURED TO_STOCK
  AND BOM definido con 3 componentes
  AND todos componentes con stock suficiente
WHEN supervisor crea orden para 50 unidades
THEN sistema genera order_number único
  AND estima costo = fn_calculate_bom_cost(bom, 50)
  AND crea production_orders con status = DRAFT
  AND crea production_order_lines desde BOM
  AND retorna production_order_id
```

### Caso 7: Inicio de Producción con Componente Insuficiente
```
GIVEN orden de producción en status = DRAFT
  AND requiere Componente X: 10 kg
  AND stock disponible Componente X = 5 kg
WHEN supervisor intenta iniciar producción
THEN sistema valida disponibilidad
  AND detecta insuficiencia
  AND RAISE EXCEPTION 'Stock insuficiente de Componente X'
  AND orden permanece en DRAFT
```

### Caso 8: Completar Producción Exitosa
```
GIVEN orden de producción en status = IN_PROGRESS
  AND producido cantidad = 50 unidades
  AND BOM requiere:
    - Harina: 5kg (costo $500/kg)
    - Azúcar: 1kg (costo $200/kg)
WHEN supervisor completa producción
THEN sistema consume componentes:
  - Descuenta 5kg harina del inventario
  - Descuenta 1kg azúcar del inventario
  AND crea 2 inventory_move tipo PRODUCTION_OUT
  AND calcula actual_cost = (500*5 + 200*1) = $2,700
  AND crea lote producto terminado:
    - on_hand = 50
    - unit_cost = 2,700 / 50 = $54
  AND crea inventory_move tipo PRODUCTION_IN
  AND actualiza orden:
    - status = COMPLETED
    - quantity_produced = 50
    - actual_end = NOW()
  AND retorna batch_id del lote creado
```

### Caso 9: Venta de Producto TO_STOCK
```
GIVEN un producto MANUFACTURED TO_STOCK
  AND stock disponible = 20 unidades (producidas previamente)
  AND unit_cost = $54 (del lote de producción)
  AND precio = $100
WHEN usuario vende 5 unidades
THEN sistema valida stock disponible (OK)
  AND descuenta 5 unidades del lote de producto terminado
  AND crea inventory_move tipo SALE_OUT
  AND NO consume componentes
  AND calcula margen = (100*5 - 54*5) / (100*5) = 46%
```

### Caso 10: Aplicación de FEFO en ON_DEMAND
```
GIVEN un componente con 3 lotes:
  - Lote A: expira 2026-03-01, stock = 10
  - Lote B: expira 2026-04-01, stock = 15
  - Lote C: sin vencimiento, stock = 20
  AND BOM requiere 12 unidades de ese componente
WHEN se consume componente en venta ON_DEMAND
THEN sistema ordena lotes por FEFO:
  1. Lote A (expira primero)
  2. Lote B
  3. Lote C (sin vencimiento al final)
  AND consume 10 del Lote A (se agota)
  AND consume 2 del Lote B
  AND registra en sale_line_components:
    - batch_id = Lote A, quantity = 10
    - batch_id = Lote B, quantity = 2
```

### Caso 11: BOM Recursivo (Componente es MANUFACTURED)
```
GIVEN Producto Final: "Computador"
  BOM nivel 1:
    - CPU (MANUFACTURED TO_STOCK)
    - RAM (RESELL)
  Y CPU tiene su propio BOM nivel 2:
    - Silicio (RESELL)
    - Circuitos (RESELL)
WHEN se valida disponibilidad para producir 1 Computador
THEN sistema resuelve recursivamente:
  1. Validar stock de RAM (RESELL directo)
  2. Validar stock de CPU producido (TO_STOCK)
  3. SI no hay CPU, validar componentes de CPU (Silicio, Circuitos)
  AND retorna componentes de nivel más bajo necesarios
  AND limita profundidad a 5 niveles
```

### Caso 12: Devolución de Producto ON_DEMAND
```
GIVEN venta de producto ON_DEMAND completada
  AND componentes consumidos:
    - Harina: 200g del Lote X
    - Queso: 100g del Lote Y
  AND política de devolución = NO_REVERSAL
WHEN cliente solicita devolución
THEN sistema registra sale_return
  AND reembolsa monto al cliente
  AND NO reversa consumo de componentes
  AND Lote X y Lote Y permanecen con stock reducido
  AND se registra pérdida en reporte
```

### Caso 13: Descuento Global Distribuido en ON_DEMAND
```
GIVEN venta con 2 líneas ON_DEMAND:
  Línea 1: Pizza (subtotal $20,000, costo componentes $8,000)
  Línea 2: Pasta (subtotal $15,000, costo componentes $6,000)
  Total sin descuento = $35,000
  AND descuento global 10% = $3,500
WHEN se completa venta
THEN distribuir descuento proporcionalmente:
  Línea 1: descuento = (20,000 / 35,000) * 3,500 = $2,000
  Línea 2: descuento = (15,000 / 35,000) * 3,500 = $1,500
  AND recalcular impuestos:
    Línea 1: base = 20,000 - 2,000 = $18,000
    Línea 2: base = 15,000 - 1,500 = $13,500
  AND calcular margen:
    Línea 1: (18,000 - 8,000) / 18,000 = 55.6%
    Línea 2: (13,500 - 6,000) / 13,500 = 55.6%
```

### Caso 14: Producción Parcial por Falta de Componente
```
GIVEN orden para 100 unidades
  AND BOM requiere por unidad:
    - Componente A: 2 unidades
    - Componente B: 1 unidad
  AND stock disponible:
    - Componente A: 200 (suficiente para 100)
    - Componente B: 80 (solo alcanza para 80)
WHEN supervisor completa con quantity_produced = 80
THEN sistema consume proporcionalmente:
  - Componente A: 2 * 80 = 160 unidades
  - Componente B: 1 * 80 = 80 unidades (se agota)
  AND crea 80 unidades de producto terminado
  AND marca orden como COMPLETED
  AND registra nota: "Producción parcial: 80/100 debido a falta de Componente B"
```

### Caso 15: Cambio de Costo de Componente Durante Producción
```
GIVEN orden de producción creada con estimated_cost = $10,000
  basado en costo histórico de componentes
  AND orden status = IN_PROGRESS
  AND durante producción, precio de Componente A sube
WHEN se completa producción
THEN sistema calcula actual_cost con costo ACTUAL al momento del consumo
  AND actual_cost = $11,500 (nuevo costo)
  AND unit_cost producto terminado = 11,500 / quantity_produced
  AND variance = actual_cost - estimated_cost = $1,500 (registrar en reporte)
```

---

## 9. REGLAS DE CONSISTENCIA DE DATOS

### CONS-001: Integridad Referencial BOM
**Regla**:
```sql
-- Un BOM solo puede referenciar product_id O variant_id, no ambos
CHECK ((product_id IS NOT NULL AND variant_id IS NULL) OR 
       (product_id IS NULL AND variant_id IS NOT NULL))

-- Todos los componentes deben existir
FOREIGN KEY (component_variant_id) REFERENCES product_variants(variant_id)

-- Un variant no puede ser componente de su propio BOM
Validar con fn_detect_bom_circular_reference()
```

### CONS-002: Balance de Inventario
**Regla**:
```sql
-- Stock en vista materializada debe coincidir con suma de lotes activos
stock_balances.on_hand = SUM(inventory_batches.on_hand WHERE is_active = TRUE)
stock_balances.reserved = SUM(inventory_batches.reserved WHERE is_active = TRUE)

-- Verificar con:
CREATE FUNCTION fn_audit_stock_consistency() RETURNS TABLE(...);
```

### CONS-003: Consistencia de Costos
**Regla**:
```sql
-- Costo de venta ON_DEMAND debe coincidir con suma de componentes
sale_lines.production_cost = SUM(component_cost * quantity_consumed)

-- Para TO_STOCK:
sale_lines.unit_cost = inventory_batches.unit_cost (del lote vendido)

-- Verificar periódicamente:
CREATE FUNCTION fn_audit_cost_consistency() RETURNS TABLE(...);
```

### CONS-004: Estados de Orden de Producción
**Regla**:
```sql
-- Transiciones válidas de status:
DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED
DRAFT → CANCELLED
SCHEDULED → CANCELLED
IN_PROGRESS → CANCELLED (con aprobación)

-- No permitir:
COMPLETED → cualquier otro estado
CANCELLED → cualquier otro estado
```

### CONS-005: Trazabilidad de Lotes
**Regla**:
```sql
-- Toda salida de lote debe tener registro en:
SELECT * FROM sale_line_batches WHERE batch_id = {batch}
UNION ALL
SELECT * FROM production_order_lines WHERE batch_id = {batch}

-- Balance de lote:
batch.on_hand_inicial - SUM(salidas) = batch.on_hand_actual
```

### CONS-006: Suma de Pagos en Venta
**Regla** (ya implementada):
```sql
SUM(sale_payments.amount) = sales.total

-- Aplica también para ventas con productos MANUFACTURED
-- El tipo de producto NO afecta el cálculo de pagos
```

### CONS-007: Cantidad Producida vs Consumida
**Regla**:
```sql
-- En orden de producción completada:
FOR EACH component IN production_order_lines:
  expected_consumption = (component.quantity_required / order.quantity_planned) * order.quantity_produced
  
  -- Tolerancia 5% por desperdicios
  IF ABS(component.quantity_consumed - expected_consumption) > expected_consumption * 0.05 THEN
    RAISE WARNING 'Consumo anormal de componente %', component.sku;
  END IF
END FOR
```

### CONS-008: Configuración Efectiva
**Regla**:
```sql
-- Toda transacción debe usar configuración efectiva calculada, NO cached
effective_behavior := fn_get_effective_inventory_behavior(tenant, variant)

-- NO hacer:
-- cached_behavior := product.inventory_behavior (puede ser NULL o desactualizado)
```

### CONS-009: Movimientos Atómicos
**Regla**:
```sql
-- Toda transacción que afecta inventario debe ser atómica:
BEGIN;
  -- Actualizar stock
  -- Crear inventory_move
  -- Actualizar sale_lines o production_order
  -- Registrar trazabilidad
COMMIT; -- Si falla cualquiera, rollback completo
```

### CONS-010: Unicidad de Números
**Regla**:
```sql
-- Números únicos por tenant
UNIQUE(tenant_id, sale_number)
UNIQUE(tenant_id, order_number)
UNIQUE(tenant_id, batch_number, location_id, variant_id)

-- Generados por sequences o funciones:
fn_next_sale_number()
fn_next_production_order_number()
```

---

## 10. PRIORIZACIÓN DE IMPLEMENTACIÓN

### Fase 1: Fundación (CRÍTICA)
- RF-001: Jerarquía de configuración
- RN-001: Consistencia de configuración
- VAL-001: BOM circular
- VAL-002: Stock negativo
- CONS-008: Configuración efectiva

### Fase 2: Servicios (ALTA)
- RF-200: Venta SERVICE
- RF-201: Reporte servicios
- EDGE-010: Servicio con costo

### Fase 3: ON_DEMAND (CRÍTICA)
- RF-400 a RF-404: BOM y ON_DEMAND completo
- RN-005: Descuentos ON_DEMAND
- RN-006: Impuestos
- VAL-003: Fecha vencimiento
- VAL-004: Producto vencido
- EDGE-001, EDGE-002: Casos límite ON_DEMAND
- Casos Given/When/Then 4, 5, 10, 11, 13

### Fase 4: Bundles (MEDIA)
- RF-300 a RF-302: Bundle completo
- EDGE-005: Devolución parcial bundle
- RN-008: Devolución bundle
- Caso Given/When/Then 3

### Fase 5: TO_STOCK (CRÍTICA)
- RF-500 a RF-507: Producción completa
- EDGE-003, EDGE-006, EDGE-007, EDGE-012: Casos producción
- CONS-004, CONS-007: Consistencia producción
- Casos Given/When/Then 6, 7, 8, 9, 14, 15

### Fase 6: Refinamiento (MEDIA)
- RN-002: Versionado BOM
- RN-003: Profundidad BOM
- RN-004: Componentes vendibles
- RN-007: Devolución ON_DEMAND
- EDGE-004, EDGE-009, EDGE-011: Casos avanzados
- CONS-001 a CONS-010: Auditorías completas
- Caso Given/When/Then 12

---

## 11. MÉTRICAS DE ÉXITO

### KPIs Técnicos
- ✅ 100% de transacciones atómicas (rollback completo en error)
- ✅ Cero inconsistencias en auditoría `fn_audit_stock_consistency()` ejecutada diariamente
- ✅ Performance: Validación BOM <500ms para 50 componentes
- ✅ Performance: Completar producción <2s para orden de 100 unidades
- ✅ Cobertura de tests: >80% en funciones críticas

### KPIs Funcionales
- ✅ Trazabilidad completa: Poder rastrear cualquier componente consumido hasta la venta específica
- ✅ Precisión de costos: Varianza <5% entre costo estimado y real en órdenes TO_STOCK
- ✅ Cero ventas con stock negativo
- ✅ Cero devoluciones bloqueadas por inconsistencia de datos

### KPIs de Negocio
- ✅ Reducción 30% en desperdicio (mejor FEFO en componentes)
- ✅ Margen real visible en reportes ON_DEMAND
- ✅ Tiempo de capacitación usuarios <4 horas
- ✅ Adopción: 80% de ventas ON_DEMAND usando sistema en primer mes

---

## 12. APÉNDICES

### A. Diagrama Entidad-Relación (Solo Relaciones)

```
products (inventory_behavior, production_type)
  └─1:N─> product_variants (puede override)
          └─1:1─> bill_of_materials
                  └─1:N─> bom_components 
                          └─N:1─> product_variants (componente)
          └─1:N─> bundle_compositions
                  └─N:1─> product_variants (componente)
          └─1:N─> inventory_batches
          └─1:N─> stock_balances (vista materializada)

sales
  └─1:N─> sale_lines
          ├─ bom_snapshot (JSONB si ON_DEMAND)
          ├─ production_cost
          └─1:N─> sale_line_batches (trazabilidad FEFO)
                  └─N:1─> inventory_batches

production_orders
  ├─1:N─> production_order_lines (componentes consumidos)
  │       └─N:1─> inventory_batches
  └─1:N─> production_outputs (productos creados)
          └─N:1─> inventory_batches
```

### B. Mapa de Funciones SQL

| Función | Propósito | Fase |
|---------|-----------|------|
| `fn_get_effective_inventory_behavior()` | Resolver jerarquía | 1 |
| `fn_get_effective_production_type()` | Resolver jerarquía | 1 |
| `fn_validate_bom_availability()` | Validar componentes | 3 |
| `fn_calculate_bom_cost()` | Estimar costo | 3 |
| `fn_consume_bom_components()` | Consumir en venta ON_DEMAND | 3 |
| `fn_allocate_fefo_for_component()` | FEFO por componente | 3 |
| `fn_explode_bundle()` | Lista componentes bundle | 4 |
| `fn_validate_bundle_availability()` | Validar bundle | 4 |
| `fn_create_production_order()` | Nueva orden producción | 5 |
| `fn_start_production()` | Iniciar orden | 5 |
| `fn_complete_production()` | Finalizar y consumir | 5 |
| `fn_detect_bom_circular_reference()` | Validar ciclos | 1 |
| `fn_audit_stock_consistency()` | Auditoría inventario | 6 |
| `fn_audit_cost_consistency()` | Auditoría costos | 6 |

### C. Glosario de Tablas Nuevas

| Tabla | Registros Estimados (por tenant/año) |
|-------|--------------------------------------|
| `bill_of_materials` | 50-500 |
| `bom_components` | 500-5,000 |
| `production_orders` | 100-10,000 |
| `production_order_lines` | 500-50,000 |
| `production_outputs` | 100-10,000 |
| `bundle_compositions` | 20-200 |
| `sale_line_components` | 1,000-100,000 (si usa bundles) |

### D. Decisiones Pendientes (Product Owner)

- [ ] Método de costeo componentes: FIFO / Average / Last?
- [ ] ¿Permitir devolución ON_DEMAND con reversión componentes?
- [ ] ¿Incluir MOD/CIF en costo producción TO_STOCK?
- [ ] ¿Profundidad máxima BOM? (recomendado: 5)
- [ ] ¿Bloquear venta componente si hay BOM activo?
- [ ] ¿Pre-reservar componentes al iniciar producción?
- [ ] ¿Permitir producción con componentes vencidos?
- [ ] ¿Permitir bundle con producto ON_DEMAND?
- [ ] ¿Devolución parcial de bundle permitida?
- [ ] ¿Versionado automático BOM en cada cambio?

---

**FIN DEL DOCUMENTO**

**Versión**: 1.0  
**Próxima Revisión**: Post-decisiones Product Owner  
**Aprobación Requerida**: Gerente Técnico + Product Owner  
