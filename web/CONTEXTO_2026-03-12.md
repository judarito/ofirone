# CONTEXTO_ULTIMO

Fecha de actualizacion: 2026-03-12
Owner: Equipo POSLite
Ultimo cambio registrado: Refactor UX del carrito POS a `<ListView>` con controles organizados (cantidad/precio/subtotal/descuento) + fix de icono en menu `Control IA`

## Regla de versionado de contexto (obligatoria)

Este archivo SIEMPRE representa el contexto activo mas reciente.

### Convencion

- Archivo activo: `CONTEXTO_ULTIMO.md`
- Archivo historico: `CONTEXTO_YYYY-MM-DD.md` (o `CONTEXTO_YYYY-MM-DD_HHMM.md` si hay mas de uno el mismo dia)

### Flujo cuando se genere un nuevo contexto

1. Renombrar el archivo actual `CONTEXTO_ULTIMO.md` a su version fechada.
2. Crear un nuevo `CONTEXTO_ULTIMO.md` con el contexto actualizado.
3. Mantener en el nuevo archivo esta misma seccion de reglas.
4. Actualizar este archivo inmediatamente despues de cada modificacion funcional o tecnica relevante (sin esperar cierre de sprint).

### Ejemplo rapido

```bash
mv CONTEXTO_ULTIMO.md CONTEXTO_2026-03-11.md
# luego crear nuevo CONTEXTO_ULTIMO.md
```

## Estado tecnico actual

### Base contable implementada

- Modulo contable desacoplado del POS por cola (`accounting_event_queue`).
- Menu contable por rol y panel contable principal.
- Libro Diario y Libro Mayor con exportacion XLSX/CSV.
- Badge de pendientes en Cola POS y flujo de regreso desde reportes a Contabilidad.

### Fase 1 ampliada (operacion contador)

- Rutas directas para navegacion por menu en contabilidad:
  - `/accounting/dashboard`
  - `/accounting/compliance`
  - `/accounting/queue`
  - `/accounting/assistant`
  - `/accounting/diario`
  - `/accounting/mayor`
- Exportables adicionales:
  - Balanza (XLSX/CSV)
  - Checklist DIAN/obligaciones (XLSX/CSV)

### UX contable (actualizado)

- Nuevo modo de visualizacion compartido: `LIST` / `TABLE` con persistencia local (`localStorage`).
- Composable: `src/composables/useAccountingViewMode.js`.
- Regla UI obligatoria (centralizacion de listas):
  - Toda lista nueva o modificada en la app debe usar el componente generico `src/components/ListView.vue`.
  - En contabilidad, el modo `LIST` debe renderizarse con `<ListView>`; `TABLE` se mantiene para grillas densas.
  - No se permiten implementaciones nuevas de listas manuales con `v-list`/`v-expansion-panels`/`v-timeline` si el caso aplica a listado.
- Vistas ajustadas para doble modo:
  - `src/views/Accounting.vue`
  - `src/views/AccountingAutomation.vue`
  - `src/views/AccountingWithholdings.vue`
  - `src/views/AccountingJournal.vue`
  - `src/views/AccountingLedger.vue`
  - `src/views/AccountingClosing.vue`
- Vistas contables migradas a `<ListView>` en modo `LIST`:
  - `src/views/Accounting.vue` (balanza, asientos recientes, obligaciones, cola, lineas IA)
  - `src/views/AccountingAutomation.vue` (reglas, excepciones)
  - `src/views/AccountingWithholdings.vue` (estimacion, configuracion)
  - `src/views/AccountingJournal.vue`
  - `src/views/AccountingLedger.vue`
  - `src/views/AccountingClosing.vue`
- En modo `LIST`, las tablas densas se muestran como cards/listas para mejorar lectura, edicion y uso en pantallas reducidas.
- Mejora UX adicional en modo `LIST`:
  - Separadores visuales entre items (`v-divider`).
  - `density="compact"` para reducir altura de filas.
  - Paginacion cliente con `v-pagination` + leyenda "Mostrando X - Y de N registros".

### Regla de producto obligatoria (listas)

- Toda funcionalidad nueva de listas en la app debe implementar `<ListView>` como componente base.
- En contabilidad esta regla es obligatoria sin excepcion para modo `LIST`.
- Cualquier vista nueva que no use `<ListView>` en listados se considera incumplimiento tecnico.

### Competitividad contable v1 (implementado)

1. Retenciones
- Tabla: `accounting_withholding_configs`
- Resumen RPC: `fn_accounting_get_withholding_summary`
- Vista: `/accounting/retenciones`

2. Cierre contable mensual
- Tabla: `accounting_period_closures`
- RPCs: `fn_accounting_close_period`, `fn_accounting_reopen_period`
- Bloqueo de posteo por periodo cerrado en `fn_accounting_post_entry`
- Vista: `/accounting/cierre`

3. Automatizacion robusta
- Tabla de reglas: `accounting_posting_rules`
- Tabla de excepciones: `accounting_automation_exceptions`
- Processor actualizado: `fn_accounting_process_queue` usa reglas dinamicas y registra excepciones
- Vista: `/accounting/automatizacion`

4. Politica estricta de periodos (uno a la vez)
- Migracion: `migrations/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql`
- Solo existe un periodo `OPEN` por tenant (indice parcial unico).
- El posteo manual (`fn_accounting_post_entry`) exige periodo `OPEN`.
- El cierre (`fn_accounting_close_period`) exige que el periodo exista y este `OPEN`.
- Apertura explicita por periodo con `fn_accounting_open_period`.
- Compatibilidad mantenida: `fn_accounting_reopen_period` delega a `fn_accounting_open_period`.

### Contabilidad producto v2 (8 puntos implementados)

1. Asientos manuales operativos
- Vista: `/accounting/asientos-manuales`
- Servicio: `getManualEntries`, `createManualEntry`, `postEntry`, `voidDraftEntry`
- Soporta creacion balanceada, posteo y anulacion controlada.

2. Plan de cuentas gestionable
- Vista: `/accounting/plan-cuentas`
- Servicio: `getChartOfAccounts`, `saveAccount`, `toggleAccountActive`
- Alta/edicion/activacion por tenant.

3. Estados financieros en modulo contable
- Vista: `/accounting/estados-financieros`
- Servicio: `getFinancialStatements`
- Estado de resultados + balance general por periodo.

4. Centro tributario unificado
- Vista: `/accounting/centro-tributario`
- Servicio: `getTaxCenterData`
- IVA, retenciones y preview de exogena por tercero.

5. Cierre contable con checklist operativo
- Vista: `/accounting/cierre` (extendida)
- Servicio: `getCloseChecklist` integrado en UI de cierre.
- Checklist previo al cierre con estados `PASS/WARN/INFO`.

6. Conciliacion caja/bancos
- Vista: `/accounting/conciliacion`
- Servicio: `getReconciliationSnapshot`
- Cruce de sesiones de caja cerradas vs saldos contables de cuentas 11*.

7. Automatizacion avanzada de reglas
- Vista: `/accounting/automatizacion` (extendida)
- Servicio: `seedAdvancedPostingRules`
- Cobertura de eventos: devoluciones ventas/compras y movimientos de caja.

8. Control interno IA de anomalias
- Vista: `/accounting/control-ia`
- Servicio: `detectAccountingAnomalies`, `requestAIAnomalyInsights`
- Deteccion estadistica + resumen de riesgo y acciones IA.

### Rutas nuevas contables (fase producto)

- `/accounting/asientos-manuales`
- `/accounting/plan-cuentas`
- `/accounting/estados-financieros`
- `/accounting/centro-tributario`
- `/accounting/conciliacion`
- `/accounting/control-ia`

### Ajustes recientes POS/menus (2026-03-12)

1. POS - lista de items de venta (desktop)
- Archivo: `src/views/PointOfSale.vue`
- Mejora: reemplazo de tabla/cards por render unificado con `<ListView>` para items del carrito.
- Estructura de cada item: encabezado (producto + variante + SKU + total) y grilla de controles (cantidad, precio, subtotal y descuento para admin).
- Resultado esperado: menos apilamiento visual, mejor lectura y edicion de lineas de venta.

2. Menu contable `Control IA` (icono)
- Se estandarizo icono a `mdi-robot-outline`.
- Migraciones relacionadas:
  - `migrations/ADD_ACCOUNTING_PHASE2_PRODUCT_MENUS.sql` (definicion corregida)
  - `migrations/FIX_ACCOUNTING_CONTROL_IA_ICON.sql` (fix para entornos ya desplegados)

## Contexto mas antiguo (resumen historico)

Este bloque conserva el contexto previo a la expansion contable, para no perder continuidad funcional del producto:

1. Base POS multi-tenant
- Aislamiento por tenant, usuarios, roles y permisos por tenant.
- Operacion principal de ventas en POS con caja/sesion.

2. Nucleo operativo previo
- Catalogo: productos, categorias, unidades de medida.
- Inventario y movimientos con ajustes y traslados.
- Compras con ingreso de inventario.
- Reportes operativos de ventas, cajas, inventario y financiero.

3. Capas de evolucion previas
- Facturacion electronica DIAN (modo dual) y configuracion de resoluciones.
- Sistema de lotes y vencimientos con logica FEFO.
- Soportes de IA en modulos operativos (ej. compra asistida / sugerencias).

4. Evolucion de seguridad y menus
- Sistema de menus por rol (plantillas y asignaciones por tenant).
- Guard de rutas basado en menus permitidos.

Nota: este resumen historico se debe mantener y actualizar en cada nuevo `CONTEXTO_ULTIMO.md`.

## Migraciones relacionadas (orden sugerido)

1. `migrations/ADD_ACCOUNTING_CO_MODULE.sql`
2. `migrations/ADD_ACCOUNTING_QUEUE_PROCESSOR.sql`
3. `migrations/FIX_ACCOUNTING_QUEUE_PROCESSOR_SERVICE_ROLE.sql`
4. `migrations/ADD_ACCOUNTING_PHASE1_REPORT_MENUS.sql`
5. `migrations/ADD_ACCOUNTING_PHASE1_OPERATIONAL_MENUS.sql`
6. `migrations/ADD_ACCOUNTING_COMPETITIVE_CORE.sql`
7. `migrations/ENFORCE_ACCOUNTING_SINGLE_OPEN_PERIOD.sql`
8. `migrations/ADD_ACCOUNTING_PHASE2_PRODUCT_MENUS.sql`
9. `migrations/FIX_ACCOUNTING_CONTROL_IA_ICON.sql`

## Nota operativa

Si se crea una nueva version de este contexto:
- El archivo actual deja de ser `_ULTIMO` y se guarda con fecha.
- El nuevo archivo actualizado toma el nombre `CONTEXTO_ULTIMO.md`.
