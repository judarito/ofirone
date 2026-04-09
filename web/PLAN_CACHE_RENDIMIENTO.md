# Plan de Cache y Rendimiento

## Objetivo

Reducir llamados repetidos al backend sin introducir riesgo operativo por datos desactualizados en procesos sensibles como POS, caja, inventario disponible, cartera y contabilidad.

## Punto de partida actual

Hoy ya existen algunos mecanismos aislados:

- Cache de validacion de sesion de `30s` en [`src/services/supabase.service.js`](./src/services/supabase.service.js).
- Cache de rutas permitidas por menu de `60s` en [`src/router/index.js`](./src/router/index.js).
- Cache local para respuestas de IA en [`src/utils/aiCache.js`](./src/utils/aiCache.js), usado por:
  - [`src/services/sales-forecast.service.js`](./src/services/sales-forecast.service.js)
  - [`src/services/ai-pricing-advisor.service.js`](./src/services/ai-pricing-advisor.service.js)
- Datos realmente sensibles ya usan tiempo real en alertas mediante [`src/composables/useAppAlerts.js`](./src/composables/useAppAlerts.js).

El vacio actual es una capa de cache transversal para consultas de lectura frecuentes no criticas.

## Principios

1. No cachear de forma persistente datos transaccionales que cambian durante la operacion.
2. Todo cache debe estar aislado por `tenant`.
3. Preferir `memory cache` como L1 y `sessionStorage` como L2 para datos no criticos.
4. Reservar `localStorage` solo para datos de larga vida y bajo riesgo, como IA o preferencias.
5. Implementar `stale-while-revalidate` solo en vistas tolerantes a leve desactualizacion.
6. Toda mutacion debe invalidar tags relacionadas.
7. Acciones manuales de `Actualizar` deben poder saltarse el cache.

## Datos que no deben cachearse de forma persistente

Estos datos deben venir frescos o con solo deduplicacion en memoria muy corta:

- Stock disponible usado para vender o confirmar una venta.
- Sesion de caja abierta, cierre de caja y arqueos.
- Cola contable pendiente, posteo de asientos y cierre contable.
- Alertas operativas activas.
- Cupo de credito y saldo usado para aprobar una venta a credito.
- Estados usados para emitir FE o validar resoluciones activas.

Regla practica:

- Si el dato participa en una decision operativa inmediata, no usar cache persistente.
- Si solo sirve para navegar, filtrar o precargar pantallas, si puede cachearse con TTL controlado.

## Propuesta de arquitectura

Crear una capa comun, por ejemplo `src/utils/queryCache.js`, con estas capacidades:

- `getOrLoad(key, loader, options)`
- `invalidate(key)`
- `invalidateByTags(tags)`
- `clearTenantScope(tenantId)`
- `prime(key, data, options)`
- `peek(key)`

Cada entrada deberia incluir:

- `tenantId`
- `key`
- `data`
- `tags`
- `fetchedAt`
- `staleAt`
- `expiresAt`
- `storage` (`memory` o `session`)
- `version`

Comportamientos requeridos:

- Deduplicacion de requests concurrentes por clave.
- TTL por tipo de dato.
- `stale-while-revalidate` opcional.
- Bypass por `forceRefresh`.
- Invalidacion por mutacion y por cambio de tenant.

## Capas recomendadas

### L1: memoria

Para la navegacion actual de la SPA.

- Respuesta inmediata.
- Se limpia al recargar la pestana.
- Ideal para deduplicar consultas repetidas entre componentes.

### L2: sessionStorage

Solo para lecturas no criticas dentro de la sesion actual.

- Sobrevive a cambios de ruta y refresh.
- Se limpia al cerrar la pestana.
- Reduce riesgo frente a `localStorage`.

### L3: localStorage

Mantenerlo restringido a:

- Preferencias del usuario.
- Modo visual.
- Cache de IA con TTL largo y controles actuales.

No usarlo para stock, saldos o estados transaccionales.

## Politica por dominio

| Dominio | Estrategia | TTL sugerido | Storage | Invalidacion |
|---|---|---:|---|---|
| Menus por rol, permisos efectivos | Cache seguro | 5-10 min | memory + session | login, cambio de rol, logout |
| `tenant_settings`, config visual, moneda, formato | Cache seguro | 5 min | memory + session | guardar configuracion |
| Catalogos estables: categorias, unidades, metodos de pago, impuestos base | Cache seguro | 10 min | memory + session | CRUD del modulo |
| Ubicaciones y cajas registradoras | Cache moderado | 3-5 min | memory + session | CRUD y asignaciones |
| Productos para grillas/listados | Cache moderado | 60-120 s | memory + session | CRUD producto, importacion, compras, produccion |
| Busqueda POS de productos/clientes/terceros | Cache corto | 15-30 s | memory | mutaciones del modulo o `forceRefresh` |
| Dashboard home y KPIs | SWR | 30-60 s | memory | venta, compra, cierre caja |
| Reportes operativos | SWR controlado | 60-180 s | memory | filtros, exportes, refresh manual |
| Dashboard contable, balanza, diario, mayor | SWR controlado | 30-60 s | memory | posteo, cierre, reapertura, reproceso de cola |
| IA de forecast y pricing | mantener patron actual | 12-24 h | localStorage | refresh manual |
| Alertas | sin cache persistente | 0-10 s | memory | realtime |
| Stock operativo, credito disponible, sesiones de caja abiertas | sin cache persistente | 0-5 s | memory | siempre tras mutacion |

## Estrategia de invalidacion

La mejora no depende solo del TTL. La clave es invalidar bien.

Tags sugeridas:

- `tenant-settings`
- `menus`
- `products`
- `inventory`
- `customers`
- `third-parties`
- `payment-methods`
- `locations`
- `cash`
- `sales`
- `purchases`
- `reports`
- `accounting`
- `alerts`

Ejemplos:

- Crear o editar producto: invalidar `products`, `inventory`, `reports`.
- Registrar compra: invalidar `purchases`, `inventory`, `reports`, `accounting`.
- Confirmar venta: invalidar `sales`, `inventory`, `cash`, `reports`, `accounting`, `customers`.
- Cerrar caja: invalidar `cash`, `reports`, `accounting`.
- Postear asiento o procesar cola: invalidar `accounting`.

## Donde empezar

Fase 1 debe atacar lecturas frecuentes y seguras, no las mas riesgosas.

### Fase 1

- Menus del usuario.
- `tenant_settings`.
- Ubicaciones.
- Metodos de pago.
- Categorias.
- Unidades de medida.

Impacto esperado:

- Menos consultas repetidas al navegar.
- Menor tiempo de carga en modulos base.
- Riesgo operativo bajo.

### Fase 2

- Listados de productos.
- Busquedas de productos en POS.
- Busquedas de clientes y terceros.
- Dashboard home.

Impacto esperado:

- Menor latencia percibida en POS y modulos de consulta.
- Menos carga por filtros repetidos y cambio de rutas.

### Fase 3

- Reportes y vistas contables con `stale-while-revalidate`.
- Invalidacion fina por eventos de ventas, compras y contabilidad.

Impacto esperado:

- Mejor experiencia en vistas pesadas sin comprometer cierre operativo.

## Cambios tecnicos propuestos

1. Crear `queryCache` comun y reutilizable.
2. Crear helpers en servicios para lecturas cacheables.
3. Extender la firma de servicios con opciones comunes:
   - `forceRefresh`
   - `useCache`
   - `ttlMs`
   - `tags`
4. Invalidar cache desde cada mutacion importante.
5. Limpiar cache tenant-scoped en `signOut`, cambio de tenant y expiracion de sesion.
6. Reusar canales realtime para invalidar o refrescar dominios sensibles.

## Recomendacion de implementacion

No introducir una libreria pesada de consultas todavia. La app ya tiene una capa de servicios propia y conviene mantener consistencia:

- Implementar primero una utilidad interna.
- Si luego el patron madura y hace falta, evaluar migrar a una libreria tipo TanStack Query.

Eso evita una migracion grande prematura.

## Riesgos a controlar

- Mostrar stock viejo en POS.
- Mostrar credito viejo en ventas a credito.
- Ocultar alertas activas por cache.
- Descuadre visual entre dashboard y detalle.
- Cache cruzado entre tenants.

Mitigaciones:

- No persistir datos operativos criticos.
- Incluir `tenantId` en toda clave.
- Registrar `fetchedAt` visible donde aplique.
- Mantener botones de recarga manual.
- Invalidar agresivamente despues de mutaciones.

## Metricas de exito

- Reducir consultas repetidas por navegacion en modulos base.
- Reducir tiempo de carga percibido en POS, home y catalogos.
- Mantener cero incidentes por datos operativos stale en flujos de venta, caja y cierre.
- Medir:
  - requests por ruta
  - requests duplicados por minuto
  - tiempo medio a primera data util
  - cantidad de refresh manuales

## Siguiente paso recomendado

Implementar una primera version de `queryCache` y aplicarla solo a:

- menus
- `tenant_settings`
- locations
- payment methods
- categories
- units of measure

Ese primer corte es el de mejor relacion beneficio/riesgo.
