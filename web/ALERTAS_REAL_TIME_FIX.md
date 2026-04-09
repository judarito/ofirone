# Solución: Sistema de Alertas en Tiempo Real

## 🔍 Problema Identificado

Las alertas de stock mínimo no se actualizaban automáticamente cuando se modificaba el inventario, incluso después de que el stock del producto se había actualizado.

## 🔎 Causa Raíz

El sistema tenía triggers configurados en la base de datos para actualizar automáticamente la tabla `system_alerts` cuando cambiaba el inventario, pero estos triggers pueden no haberse ejecutado correctamente o no estar habilitados en la base de datos del usuario.

## ✅ Soluciones Implementadas

### 1. Script de Migración: FIX_STOCK_ALERTS_REALTIME.sql

Este script hace lo siguiente:

- ✅ **Recrea la vista `vw_stock_alerts`** que define las condiciones de las alertas
- ✅ **Recrea la tabla `system_alerts`** con índices optimizados
- ✅ **Habilita Real-time en `system_alerts`** con `alter publication supabase_realtime add table system_alerts`
- ✅ **Recrea los triggers automáticos**:
  - `trg_stock_balances_alert_after`: Se dispara cuando cambia `stock_balances`
  - `trg_product_variants_alert_after`: Se dispara cuando cambia `min_stock`
- ✅ **Mejora el manejo de errores** en los triggers para no fallar la transacción principal
- ✅ **Inicializa las alertas** con los datos actuales del inventario

### 2. Mejoras en inventory.service.js

Agregamos **respaldo manual** para garantizar que las alertas se actualicen incluso si los triggers fallan:

- Nuevo método `refreshStockAlerts()` que llama a `fn_refresh_stock_alerts()`
- Se llama automáticamente después de:
  - ✅ Ajustes manuales de inventario
  - ✅ Traslados entre sedes
  - ✅ Entradas por compras
  - ✅ Cambios en stock mínimo

### 3. Mejoras en App.vue

Optimizamos la suscripción en tiempo real:

- ✅ Mejor manejo de eventos `INSERT`, `UPDATE`, `DELETE`
- ✅ Logs detallados para debugging (con emojis para fácil identificación)
- ✅ Prevención de duplicados
- ✅ Mejor sincronización de estado

## 📋 Instrucciones de Implementación

### Paso 1: Ejecutar la migración SQL

Abre Supabase SQL Editor y ejecuta el archivo:

```sql
-- migrations/FIX_STOCK_ALERTS_REALTIME.sql
```

Este script:
- Recrea todos los componentes del sistema de alertas
- Habilita Real-time en la tabla `system_alerts`
- Inicializa las alertas con datos actuales

### Paso 2: Verificar que Real-time está habilitado

En Supabase Dashboard:
1. Ve a **Database > Replication**
2. Verifica que la tabla `system_alerts` esté en la publicación `supabase_realtime`
3. Si no aparece, ejecuta manualmente:
   ```sql
   alter publication supabase_realtime add table system_alerts;
   ```

### Paso 3: Probar el sistema

1. **Abre la aplicación** y observa la consola del navegador
2. **Verás logs como**:
   - `📡 Suscribiendo a alertas en tiempo real para tenant: [uuid]`
   - `✅ Suscripción a alertas activa`
3. **Modifica el inventario** de un producto que tenga alerta
4. **Observa la consola**:
   - `📡 Alert change received: {...}`
   - `🔄 Actualizando alerta: {...}` o `❌ Eliminando alerta: {...}`
5. **La alerta debe desaparecer o actualizarse** inmediatamente en la UI

## 🔧 Arquitectura del Sistema de Alertas

```
┌─────────────────────┐
│  stock_balances     │ ◄─── Cambios de inventario
│  product_variants   │
└──────────┬──────────┘
           │
           │ trigger: trg_stock_balances_alert_after
           │ trigger: trg_product_variants_alert_after
           ▼
┌─────────────────────┐
│  vw_stock_alerts    │ ◄─── Vista que define condiciones
└──────────┬──────────┘
           │
           │ INSERT/UPDATE/DELETE
           ▼
┌─────────────────────┐
│  system_alerts      │ ◄─── Real-time habilitado
└──────────┬──────────┘
           │
           │ Supabase Real-time
           ▼
┌─────────────────────┐
│  App.vue            │ ◄─── Suscripción en tiempo real
│  alertsChannel      │      actualiza UI automáticamente
└─────────────────────┘
```

## 🎯 Condiciones de Alerta

El sistema detecta 4 niveles de alerta:

1. **OUT_OF_STOCK** (`on_hand <= 0`): Sin stock físico
2. **NO_AVAILABLE** (`available <= 0`): Sin stock disponible (todo reservado)
3. **LOW_STOCK** (`on_hand <= min_stock`): Stock físico bajo
4. **LOW_AVAILABLE** (`available <= min_stock`): Stock disponible bajo

Donde `available = on_hand - reserved`

## 🐛 Debugging

Si las alertas siguen sin actualizarse:

### 1. Verificar triggers en la BD

```sql
SELECT 
  trigger_name, 
  event_object_table, 
  action_statement 
FROM information_schema.triggers 
WHERE trigger_name LIKE '%alert%';
```

Deberías ver:
- `trg_stock_balances_alert_after` en `stock_balances`
- `trg_product_variants_alert_after` en `product_variants`

### 2. Verificar Real-time

```sql
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';
```

Debe incluir `system_alerts`

### 3. Probar trigger manualmente

```sql
-- Refrescar alertas manualmente
SELECT fn_refresh_stock_alerts();

-- Ver alertas actuales
SELECT * FROM system_alerts WHERE alert_type = 'STOCK';
```

### 4. Ver logs en consola del navegador

Los logs con emojis indican:
- 📡 Suscripción/eventos real-time
- ➕ Nueva alerta
- 🔄 Actualización de alerta
- ❌ Eliminación de alerta
- ✅ Éxito
- 🔌 Desconexión

## 📊 Respaldo Manual

Si Real-time falla, el sistema ahora tiene **respaldo automático**:

Cada vez que se modifica el inventario a través de:
- `createManualAdjustment()`
- `createTransfer()`
- `createPurchaseEntry()`
- `updateMinStock()`

El servicio llama a `refreshStockAlerts()` que regenera todas las alertas.

## ✨ Beneficios de la Solución

1. **Real-time verdadero**: Las alertas se actualizan inmediatamente cuando cambia el inventario
2. **Doble respaldo**: Triggers automáticos + refresh manual
3. **Mejor debugging**: Logs claros y detallados
4. **Manejo de errores robusto**: Los triggers no fallan la transacción principal
5. **Prevención de duplicados**: La UI verifica antes de agregar alertas
6. **Optimización**: Índices adecuados para consultas rápidas

## 🎓 Notas Técnicas

- Los triggers usan `security definer` para ejecutarse con privilegios elevados
- La función `fn_refresh_stock_alerts()` es idempotente (puede ejecutarse múltiples veces)
- La restricción `unique (tenant_id, alert_type, reference_id)` previene duplicados
- El `on conflict ... do update` actualiza alertas existentes en lugar de fallar
- Los logs de consola son solo para desarrollo, se pueden remover en producción

## 🚀 Próximos Pasos

1. Ejecutar `FIX_STOCK_ALERTS_REALTIME.sql`
2. Verificar que Real-time esté habilitado
3. Probar modificando inventario y observando las alertas
4. Si funciona correctamente, remover logs de consola en producción

---

**Creado**: 2026-02-13  
**Archivos modificados**:
- `migrations/FIX_STOCK_ALERTS_REALTIME.sql` (nuevo)
- `src/services/inventory.service.js`
- `src/App.vue`
