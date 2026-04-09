# 🔧 SOLUCIÓN: Stock Desincronizado (Dice 0 cuando hay productos)

## ❌ Problema Identificado

**Error:** "Stock insuficiente para variante XXX. Disponible: 0, Requerido: 1.000"

**Causa:** La vista materializada `stock_balances` no se refresca automáticamente después de crear lotes.

### 🔍 ¿Por qué ocurre?

1. Al registrar una compra, se crean lotes en `inventory_batches` ✅
2. La tabla `stock_balances` es una **vista materializada** que no se actualiza automáticamente ❌
3. Las validaciones de venta consultan `stock_balances` que tiene datos viejos ❌
4. Resultado: El sistema dice que no hay stock cuando sí lo hay

---

## ⚡ SOLUCIÓN INMEDIATA (Ejecutar YA)

### Opción 1: Script Automático (Recomendado)

```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\QUICK_FIX_STOCK.sql"
```

### Opción 2: Comando Manual

```sql
REFRESH MATERIALIZED VIEW stock_balances;
```

O si existe la función:
```sql
SELECT fn_refresh_stock_balances();
```

**✅ Después de ejecutar esto, el stock se sincronizará y podrás vender normalmente.**

---

## 🛠️ SOLUCIÓN PERMANENTE

Para que no vuelva a ocurrir, necesitas una de estas opciones:

### Opción A: Asegurar que sp_create_purchase refresca el stock (RECOMENDADA)

El script `INTEGRATE_BATCHES_WITH_PURCHASES.sql` ya incluye las llamadas, pero debes verificar que se ejecutó correctamente:

```powershell
# Ejecutar el diagnóstico completo
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\FIX_STOCK_SYNC.sql"
```

Este script:
1. ✅ Diagnostica el problema
2. ✅ Compara lotes vs stock reportado
3. ✅ Refresca automáticamente stock_balances
4. ✅ Verifica que fn_refresh_stock_balances existe
5. ✅ Muestra el stock actualizado

Luego, **reejecutar** la integración de lotes:

```powershell
psql -U postgres -d nombre_bd -f "e:\Dev\POSLite\App\migrations\INTEGRATE_BATCHES_WITH_PURCHASES.sql"
```

### Opción B: Crear Job Automático para Refrescar (Cada 5 minutos)

```sql
-- Crear extensión pg_cron si no existe
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Job para refrescar cada 5 minutos
SELECT cron.schedule('refresh-stock-balances', '*/5 * * * *', 
  'REFRESH MATERIALIZED VIEW stock_balances'
);
```

### Opción C: Convertir stock_balances a Vista Normal (Auto-actualiza)

⚠️ **Cuidado:** Esto puede afectar el rendimiento en bases de datos grandes.

```sql
-- 1. Guardar datos actuales
CREATE TABLE stock_balances_backup AS 
SELECT * FROM stock_balances;

-- 2. Eliminar vista materializada
DROP MATERIALIZED VIEW stock_balances;

-- 3. Recrear como vista normal (auto-actualiza)
CREATE OR REPLACE VIEW stock_balances AS
SELECT 
  ib.tenant_id,
  ib.location_id,
  ib.variant_id,
  SUM(ib.on_hand) AS on_hand,
  SUM(ib.reserved) AS reserved,
  NOW() AS updated_at
FROM inventory_batches ib
WHERE ib.is_active = TRUE
GROUP BY ib.tenant_id, ib.location_id, ib.variant_id;
```

---

## 📋 Checklist de Verificación

Después de aplicar la solución permanente, verifica:

```powershell
# 1. Ejecutar diagnóstico
psql -U postgres -d tu_bd -f "e:\Dev\POSLite\App\migrations\FIX_STOCK_SYNC.sql"
```

### ✅ Debe mostrar:
- ✓ "stock_balances es una VISTA MATERIALIZADA" o "TABLA/VISTA normal"
- ✓ Comparación Lotes vs Stock (deben coincidir)
- ✓ "Vista refrescada exitosamente"
- ✓ Stock actualizado por producto

### ❌ Si muestra problemas:

**Problema:** "fn_refresh_stock_balances NO EXISTE"
**Solución:**
```powershell
# Ejecutar Fase 2 del sistema de lotes
psql -U postgres -d tu_bd -f "e:\Dev\POSLite\App\migrations\ADD_EXPIRATION_BATCHES_PHASE2.sql"
```

**Problema:** "Lotes: 20 | Reportado: 0 | ❌ DESINCRONIZADO"
**Solución:**
```sql
REFRESH MATERIALIZED VIEW stock_balances;
```

---

## 🎯 Flujo Correcto (Después de Fix)

```
1. Usuario registra compra con producto
   ↓
2. sp_create_purchase crea lote en inventory_batches
   ↓  
3. Se llama fn_refresh_stock_balances()
   ↓
4. stock_balances se actualiza automáticamente
   ↓
5. Validaciones de venta usan stock actualizado
   ↓
6. ✅ Venta exitosa
```

---

## 🚨 Solución de Emergencia (Si nada funciona)

Si después de todo esto el problema persiste:

### Diagnóstico Manual

```sql
-- 1. Ver lotes reales
SELECT 
  pv.sku,
  p.name,
  l.name AS location,
  SUM(ib.on_hand) AS stock_real
FROM inventory_batches ib
JOIN product_variants pv ON pv.variant_id = ib.variant_id
JOIN products p ON p.product_id = pv.product_id
JOIN locations l ON l.location_id = ib.location_id
WHERE ib.is_active = TRUE
GROUP BY pv.sku, p.name, l.name;

-- 2. Ver stock reportado
SELECT 
  pv.sku,
  p.name,
  l.name AS location,
  sb.on_hand AS stock_reportado
FROM stock_balances sb
JOIN product_variants pv ON pv.variant_id = sb.variant_id
JOIN products p ON p.product_id = pv.product_id
JOIN locations l ON l.location_id = sb.location_id;
```

### Fix Manual Individual

Si un producto específico tiene el problema:

```sql
-- Actualizar manualmente (reemplaza el UUID)
UPDATE stock_balances 
SET on_hand = (
  SELECT SUM(on_hand) 
  FROM inventory_batches 
  WHERE variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e'
    AND is_active = TRUE
)
WHERE variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';
```

---

## 📞 Resumen para Soporte Urgente

**Si necesitas vender YA:**

1. Ejecuta esto en PostgreSQL:
   ```sql
   REFRESH MATERIALIZED VIEW stock_balances;
   ```

2. O ejecuta:
   ```powershell
   psql -U postgres -d tu_bd -f "migrations/QUICK_FIX_STOCK.sql"
   ```

3. ✅ Listo, ahora puedes vender

**Para que no vuelva a pasar:**

- Ejecuta `FIX_STOCK_SYNC.sql` completo
- Verifica que `sp_create_purchase` fue actualizado con `INTEGRATE_BATCHES_WITH_PURCHASES.sql`

---

## ✅ Verificación Final

Después de aplicar el fix, prueba:

1. Ve al módulo **Stock por Sede**
2. Verifica que muestre las 20 unidades
3. Intenta hacer una venta del producto
4. Debe funcionar correctamente

Si todo muestra bien en Stock por Sede pero falla en la venta, el problema es diferente y está en la función de validación de ventas (sp_create_sale).

---

**Última actualización:** Febrero 15, 2026
