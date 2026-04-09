# 🚀 GUÍA DE INSTALACIÓN: Sistema de Lotes con Vencimiento

## 📋 Orden de Ejecución de Scripts SQL

Ejecuta los scripts en este orden exacto desde PowerShell:

### 1️⃣ Primero: Vistas y Funciones de Análisis de Compras
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\PURCHASE_ANALYSIS_VIEWS.sql"
```
**Qué crea:**
- `vw_inventory_rotation_analysis` (vista de análisis de rotación)
- `fn_get_purchase_suggestions` (sugerencias inteligentes de compra)

---

### 2️⃣ Sistema de Lotes - Fase 1: Funciones Base
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE1.sql"
```
**Qué crea:**
- `fn_variant_requires_expiration` (verifica si producto requiere vencimiento)
- `fn_generate_batch_number` (genera números de lote)
- Campo `requires_expiration` en tabla `products`

---

### 3️⃣ Fase 2: Tabla de Lotes y Migración
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE2.sql"
```
**Qué crea:**
- Tabla `inventory_batches` (lotes con vencimiento)
- Convierte `stock_balances` en vista materializada
- `fn_refresh_stock_balances` (refresca vista materializada)
- Migra datos existentes de stock a lotes

---

### 4️⃣ Fase 3: FEFO (First Expired First Out)
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql"
```
**Qué crea:**
- `fn_fefo_allocate` (asigna lotes según FEFO)
- Tabla `sale_line_batches` (trazabilidad de qué lote se vendió)

---

### 5️⃣ Fase 4: Integración con Ventas
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql"
```
**Qué crea:**
- Modifica `sp_create_sale` para usar FEFO automático
- Integra sistema de lotes en punto de venta

---

### 6️⃣ Fase 5: Reportes y Vistas
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql"
```
**Qué crea:**
- `vw_batch_alerts` (alertas de vencimiento)
- `vw_batch_rotation` (análisis de rotación)
- `vw_batch_traceability` (trazabilidad completa)
- `fn_get_expiring_batches` (lotes próximos a vencer)

---

### 7️⃣ FINAL: Integración con Compras
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\INTEGRATE_BATCHES_WITH_PURCHASES.sql"
```
**Qué hace:**
- Modifica `sp_create_purchase` para crear lotes automáticamente
- Integra campos de lote (batch_number, expiration_date, physical_location)
- **ESTE ES EL SCRIPT CRÍTICO** para que las compras creen lotes

---

## 🔍 Verificación Rápida

Después de ejecutar todos los scripts, verifica que todo esté bien:

```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\QUICK_DIAGNOSE.sql"
```

Este script te dirá:
- ✅ Si `sp_create_purchase` incluye lógica de lotes
- ✅ Si todas las funciones necesarias existen
- 📊 Estadísticas de lotes y compras

---

## ⚠️ Errores Comunes

### Error: "relation stock_balances does not exist"
**Causa:** Fase 2 no se ejecutó correctamente (convierte stock_balances en vista materializada)

**Solución:**
```powershell
# Volver a ejecutar Fase 2
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE2.sql"
```

---

### Error: "function fn_generate_batch_number does not exist"
**Causa:** Fase 1 no se ejecutó

**Solución:**
```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE1.sql"
```

---

### Error: "column requires_expiration does not exist"
**Causa:** Fase 1 no agregó el campo `requires_expiration` a la tabla `products`

**Solución:**
```powershell
# Ejecutar manualmente el ALTER TABLE
psql -U postgres -d nombre_bd -c "ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_expiration BOOLEAN DEFAULT FALSE;"
```

---

## 📝 Checklist Completo

Marca cada paso después de ejecutarlo:

- [ ] 1. PURCHASE_ANALYSIS_VIEWS.sql
- [ ] 2. ADD_EXPIRATION_BATCHES_PHASE1.sql
- [ ] 3. ADD_EXPIRATION_BATCHES_PHASE2.sql
- [ ] 4. ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql
- [ ] 5. ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql
- [ ] 6. ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql
- [ ] 7. INTEGRATE_BATCHES_WITH_PURCHASES.sql
- [ ] 8. QUICK_DIAGNOSE.sql (verificación)

---

## ✅ Después de la Instalación

### Configurar un Producto con Vencimiento:
1. Ve a **Productos** en la aplicación
2. Edita un producto existente o crea uno nuevo
3. Activa el checkbox **"Requiere control de vencimiento"**
4. Guarda

### Registrar una Compra con Vencimiento:
1. Ve a **Compras** → **Nueva Compra**
2. Selecciona la sede
3. Agrega el producto que configuraste
4. Verás campos adicionales:
   - **Número de Lote** (se genera automático)
   - **Fecha de Vencimiento** ⚠️ OBLIGATORIO
   - **Ubicación Física** (opcional)
5. Completa la fecha de vencimiento
6. Guarda la compra

### Verificar que el Lote fue Creado:
1. Ve a **Inventario** → **Lotes y Vencimientos**
2. Deberías ver el lote recién creado
3. Pestaña **"Alertas"** muestra productos próximos a vencer

---

## 🎯 Problema Actual: "Registré una compra pero no aparece"

**Causa más probable:**
`sp_create_purchase` no incluye la lógica para crear lotes porque **INTEGRATE_BATCHES_WITH_PURCHASES.sql no se ejecutó** o se ejecutó antes de las fases 1-6.

**Solución:**
1. Ejecuta TODAS las fases en orden (1-6)
2. Ejecuta INTEGRATE_BATCHES_WITH_PURCHASES.sql al final
3. Ejecuta QUICK_DIAGNOSE.sql para verificar
4. Registra una **nueva compra** de prueba

**Nota:** Las compras registradas ANTES de ejecutar INTEGRATE_BATCHES_WITH_PURCHASES.sql NO crearán lotes. Solo las nuevas compras después de la actualización del procedimiento.

---

## 📞 ¿Necesitas ayuda?

Si después de ejecutar todos los scripts sigues teniendo problemas, ejecuta:

```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\QUICK_DIAGNOSE.sql"
```

Y comparte el resultado completo.
