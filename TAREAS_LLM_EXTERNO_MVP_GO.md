# Tareas para LLM externo — cierre del MVP Go

Este paquete asigna al LLM externo la mayor parte de los pendientes funcionales del MVP. Cada slice debe ser pequeño, verificable y no depender de que otro agente termine una pantalla completa. La regla de operación es: en `VITE_DATA_PROVIDER=go` no se permite fallback silencioso a Supabase; si un endpoint Go todavía no existe, se debe implementar el endpoint y su adaptador, o devolver un error explícito y documentado.

## Reglas de coordinación

- Rama de trabajo: `dev` o una rama derivada de `dev`; no usar `force push`.
- No modificar los cambios del agente principal en POS básico, búsqueda Go, Kardex básico ni el commit `3e7cb0a`.
- No cambiar contratos HTTP existentes sin actualizar el handler, cliente web y pruebas de contrato en el mismo slice.
- Toda escritura debe imponer `tenant_id` desde el JWT; nunca aceptar el tenant del body como autoridad.
- Todo listado debe tener `limit` acotado y cursor estable; no usar paginación por `offset` en endpoints nuevos.
- Cada slice debe entregar: archivos modificados, pruebas ejecutadas, riesgos y commit separado.
- Si falta una tabla o migración, crear la migración portable en `database/migrations/` y agregar prueba desde base vacía.
- No tocar PROD ni borrar datos de DEV. Para fixtures, usar una base temporal o datos sintéticos identificables.

## Perímetro reservado al agente principal

- No modificar `web/src/views/PointOfSale.vue` ni `web/src/services/backendSalesClient.js` salvo corrección crítica documentada.
- No modificar `web/src/views/Inventory.vue`, `web/src/services/inventory.service.js` ni los handlers de Kardex ya entregados.
- No reescribir `backend-go/internal/sales/pgstore.go` ni `backend-go/internal/inventory/pgstore.go`.
- No revertir el commit `7b759cb` ni el commit `3e7cb0a`.

## Slices asignados

### LLM-01 — Caja: endpoints completos

- [ ] Implementar repositorio y handlers Go para cajas registradoras: listar, crear, actualizar y desactivar.
- [ ] Completar sesiones de caja: listar, abrir, cerrar, sesión activa y sesiones expiradas.
- [ ] Completar movimientos de caja: registrar ingreso/egreso y listar por sesión con cursor.
- [ ] Adaptar `web/src/services/cash.service.js` para que todas las operaciones usen Go cuando `VITE_DATA_PROVIDER=go`.
- [ ] Eliminar consultas Supabase del flujo de caja en modo Go, sin fallback silencioso.
- [ ] Agregar pruebas unitarias, HTTP y de autorización tenant/rol.

### LLM-02 — Caja: consistencia transaccional

- [ ] Verificar que apertura, movimientos y cierre respeten una única transacción cuando corresponda.
- [ ] Rechazar doble apertura, cierre repetido, montos negativos inválidos y movimientos sobre una sesión cerrada.
- [ ] Agregar idempotencia para reintentos del registro de movimiento.
- [ ] Cubrir errores `400`, `401`, `403`, `409` y rollback ante fallo de persistencia.

### LLM-03 — Dashboard y resumen MVP

- [ ] Completar `GET /api/v1/reports/dashboard` con ventas del día/mes/año, cantidad de transacciones, métodos de pago e inventario resumido.
- [ ] Revisar `web/src/services/reports.service.js` y conectar el dashboard sin consultas Supabase.
- [ ] Mantener respuestas válidas con cero datos y fechas/zonas horarias consistentes.
- [ ] Agregar prueba de contrato y fixture con dos tenants que verifique aislamiento.

### LLM-04 — Reportes operativos MVP

- [ ] Implementar endpoints Go para ventas por día, ventas por método de pago, productos más vendidos y valor de inventario.
- [ ] Aplicar filtros por fecha, sede y límite/cursor donde aplique.
- [ ] Adaptar las vistas de reportes para consumir Go en modo Go.
- [ ] Si un reporte no pertenece al MVP, dejarlo fuera del menú Go y documentarlo; no llamar Supabase.

### LLM-05 — Configuración del tenant

- [ ] Implementar `GET/PATCH /api/v1/tenant/settings` para nombre, prefijo de factura, moneda y opciones operativas necesarias.
- [ ] Validar que solo un administrador pueda modificar configuración.
- [ ] Adaptar `tenantSettings.service.js` y la vista de configuración.
- [ ] Agregar pruebas de lectura, actualización, tenant cruzado y permisos insuficientes.

### LLM-06 — Precios y reglas comerciales

- [ ] Inventariar las operaciones realmente usadas por el POS: precio base, descuentos, impuestos y reglas activas.
- [ ] Implementar endpoints Go para listar, crear, actualizar y desactivar reglas de precio del MVP.
- [ ] Mantener el cálculo final en una única función de dominio; no duplicar reglas en Vue.
- [ ] Agregar pruebas de prioridad de reglas, fechas de vigencia, redondeo y ausencia de regla.

### LLM-07 — Impuestos y maestros fiscales

- [ ] Verificar el endpoint Go de impuestos usado por la venta y completar CRUD solo si la pantalla lo requiere.
- [ ] Migrar la administración de tasas desde `taxes.service.js` y `taxRules.service.js` para modo Go.
- [ ] Validar porcentajes, vigencia, duplicados por tenant y cálculo con productos exentos.
- [ ] Agregar pruebas unitarias y de contrato; prohibir llamadas `fn_*` de Supabase en modo Go.

### LLM-08 — Alertas operativas

- [ ] Completar `GET /api/v1/system-alerts` con filtros por tipo, nivel, sede y cursor.
- [ ] Adaptar `alerts.service.js` para listado Go y retirar la suscripción realtime de Supabase en modo Go.
- [ ] Implementar o documentar explícitamente el refresco de alertas; no ejecutar RPC Supabase desde Go.
- [ ] Cubrir stock bajo, vencimientos, cartera, cuentas por pagar y pedidos online.

### LLM-09 — Compras avanzadas

- [ ] Implementar sugerencias de compra, órdenes de compra, recepción parcial/final y devolución a proveedor en Go.
- [ ] Garantizar que cada recepción actualice lotes, stock y Kardex en una transacción idempotente.
- [ ] Implementar cuentas por pagar derivadas de compras y estados de pago.
- [ ] Adaptar `Purchases.vue` para que los botones avanzados no llamen Supabase cuando el proveedor sea Go.
- [ ] Probar reintentos, exceso recibido, devolución superior a recibido y compra sin proveedor.

### LLM-10 — Inventario avanzado

- [ ] Implementar ajustes manuales, transferencias entre sedes y recepción de transferencias en Go.
- [ ] Validar stock disponible, sede origen/destino, variantes activas y movimientos duplicados.
- [ ] Adaptar las pestañas Operaciones e Insumos de `Inventory.vue` al backend Go.
- [ ] Agregar pruebas de concurrencia y reconciliación stock/lotes/movimientos.

### LLM-11 — CXC completo

- [ ] Revisar `backendReceivablesClient.js` y completar cuentas, cargos, abonos, movimientos y resumen con paginación.
- [ ] Verificar que una venta a crédito cree el cargo CXC dentro de la transacción de venta.
- [ ] Validar saldo, cupo, sobrepago, abono duplicado y cliente de otro tenant.
- [ ] Agregar pruebas HTTP y frontend para cada operación del módulo.

### LLM-12 — Productos y catálogo residual

- [ ] Auditar `products.service.js` para identificar operaciones que todavía entren por Supabase en modo Go.
- [ ] Migrar búsquedas por nombre de producto, nombre de variante, SKU y código de barras.
- [ ] Completar categorías, unidades de medida y variantes en creación/edición/desactivación.
- [ ] Verificar que crear producto simple cree su variante predeterminada sin llamadas legacy.
- [ ] Agregar pruebas de respuesta vacía, búsqueda parcial y paginación.

### LLM-13 — Menú, permisos y sesión

- [ ] Eliminar llamadas duplicadas al endpoint de menú y documentar la caché de sesión.
- [ ] Verificar que `401` redirija una sola vez al login y limpie el token Go sin bucles.
- [ ] Validar menú por rol, tenant y sesión expirada.
- [ ] Agregar prueba de recarga directa en `/`, `/pos`, `/purchases` e `/inventory`.

### LLM-14 — Integración y datos de prueba

- [ ] Crear fixture sintético de un tenant, sede, proveedor, cliente, producto, variante y usuario.
- [ ] Ejecutar flujo compra → lote → stock → Kardex → venta → descuento de stock → CXC.
- [ ] Crear script reproducible contra una base temporal PostgreSQL y guardar evidencia saneada.
- [ ] Verificar que el mismo flujo no genere llamadas de red a dominios Supabase.

### LLM-15 — Pruebas y CI

- [ ] Añadir pruebas Go para cada handler nuevo y ejecutar `go test ./...`, `go vet ./...` y `go build ./...`.
- [ ] Añadir pruebas frontend de los adaptadores Go y ejecutar `npm test -- --run` y `npm run build` con `VITE_DATA_PROVIDER=go`.
- [ ] Actualizar `.github/workflows/ci.yml` si falta alguna prueba o variable necesaria.
- [ ] Verificar que el workflow de `dev` publique Render y Cloudflare solo después de pasar validaciones.

### LLM-16 — Auditoría final anti-Supabase

- [ ] Ejecutar búsqueda estática de `supabase`, `supabase-js`, `rpc(` y dominios Supabase en los módulos MVP.
- [ ] Clasificar cada coincidencia como legacy fuera de alcance, test, fallback híbrido o defecto.
- [ ] Corregir toda coincidencia que se ejecute con `VITE_DATA_PROVIDER=go`.
- [ ] Entregar una tabla final módulo → endpoint Go → cliente web → pruebas → llamadas Supabase esperadas.

## Orden recomendado

1. LLM-01, LLM-02 y LLM-05 en paralelo.
2. LLM-03, LLM-04, LLM-06, LLM-07 y LLM-08 en paralelo.
3. LLM-09, LLM-10, LLM-11 y LLM-12 en paralelo.
4. LLM-13 y LLM-14 después de que existan los endpoints principales.
5. LLM-15 y LLM-16 como cierre obligatorio.

## Criterio de terminado

- [ ] El flujo MVP compra → inventario → Kardex → venta → CXC funciona desde Cloudflare contra Render.
- [ ] No hay tráfico Supabase en los módulos MVP con `VITE_DATA_PROVIDER=go`.
- [ ] No hay fallbacks silenciosos a Supabase.
- [ ] Los listados tienen límite, cursor y pruebas de no duplicación/no omisión.
- [ ] CI pasa frontend, backend Go, contratos y pruebas de integración.
- [ ] Cada slice tiene commit separado y evidencia reproducible.
