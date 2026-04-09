# Sistema de Asistente de Configuracion Inicial

## Descripcion

El asistente de configuracion ya no se modela como una lista plana de tareas. Desde 2026-03-18 funciona como un hub de onboarding operativo orientado a procesos criticos del negocio.

Objetivo principal:
- llevar al usuario desde "tenant creado" hasta "primer flujo operativo exitoso"
- priorizar resultados operativos sobre configuraciones aisladas
- reducir la friccion para venta, compra, caja, inventario y contabilidad

## Arquitectura actual

### 1. UI principal

- Archivo: `src/components/SetupWizard.vue`
- Ruta: `/setup`
- Rol funcional:
  - presentar progreso global
  - mostrar la ruta recomendada
  - agrupar el onboarding por procesos
  - listar bloqueantes, pasos esenciales y pruebas operativas

### 2. Motor de readiness

- Archivo: `src/composables/useSetupAssistant.js`
- Rol funcional:
  - centralizar reglas de completitud
  - consultar el estado real del tenant en Supabase
  - devolver progreso, estado, bloqueantes y siguiente accion
  - adjuntar metadata de onboarding por proceso para deep links y guias contextuales

### 3. Entrada rapida desde Home

- Archivo: `src/views/Home.vue`
- Comportamiento actual:
  - se muestra un CTA compacto `Config inicial` al lado de `Nueva Venta`
  - incluye badge con cantidad de configuraciones esenciales pendientes
  - desaparece cuando el tenant ya esta operativo en lo esencial

### 4. Guiado contextual entre modulos

El asistente ya no solo navega a rutas. Tambien lleva contexto de onboarding:

- `TenantConfig` puede abrir tab especifico via `query.tab`
- `Accounting` puede abrir tab especifico via `query.tab`
- `Products` puede abrir tab especifico via `query.tab`
- `Products` puede disparar `query.action=create-product`
- el wizard puede enfocar un proceso via `query.process`
- los modulos muestran avisos de `modo guiado` cuando vienen del onboarding

### 4. Router

- Archivo: `src/router/index.js`
- Ajuste vigente:
  - `/setup` se trata como ruta siempre permitida para evitar bloqueo por menu dinamico durante onboarding

## Procesos criticos modelados

El asistente trabaja hoy con 5 procesos:

1. `Vender`
2. `Comprar`
3. `Operar caja`
4. `Controlar inventario`
5. `Activar contabilidad`

Cada proceso expone:
- `state`
- `stateLabel`
- `stateColor`
- `progressPercentage`
- `requiredStepsCount`
- `completedRequired`
- `missingRequired`
- `nextStep`
- `blockers`

## Estados operativos

Estados soportados por el motor:

- `BLOCKED`
- `IN_PROGRESS`
- `READY_FOR_TEST`
- `OPERATIONAL`

Interpretacion:

- `BLOCKED`: faltan requisitos esenciales
- `IN_PROGRESS`: ya puede avanzar, pero no esta listo del todo
- `READY_FOR_TEST`: ya no hay bloqueantes esenciales; falta validar el flujo
- `OPERATIONAL`: el proceso ya quedo operativo

## Reglas vigentes por proceso

### Vender

Checks actuales:
- datos de empresa y prefijo en `tenant_settings`
- al menos una sede activa
- al menos una caja activa
- al menos un medio de pago activo
- catalogo con productos y variantes listas para vender
- asignacion de caja a usuario como paso recomendado
- venta registrada como prueba operativa

### Comprar

Checks actuales:
- al menos un proveedor en `third_parties` (`supplier` o `both`)
- sede disponible para recepcion
- productos y variantes disponibles para comprar/recibir
- compra registrada como prueba operativa

### Operar caja

Checks actuales:
- caja activa
- asignacion activa en `cash_register_assignments`
- sesion de caja como prueba operativa

### Controlar inventario

Checks actuales:
- productos inventariables activos
- variantes activas para operar stock
- stock inicial o existencia positiva en `stock_balances`
- movimiento de inventario como prueba operativa
- guia contextual para cargar inventario desde:
  - `Compras`
  - `Inventario > Operaciones`
  - `Cargue masivo`

### Activar contabilidad

Checks actuales:
- modulo contable habilitado en `tenant_settings`
- cuentas base en `accounting_accounts`
- automatizacion ventas/compras como paso recomendado
- asiento contable como prueba operativa

## Tablas evaluadas por el motor

`useSetupAssistant.js` consulta actualmente:

- `tenant_settings`
- `locations`
- `cash_registers`
- `payment_methods`
- `products`
- `product_variants`
- `cash_register_assignments`
- `sales`
- `third_parties`
- `purchases`
- `stock_balances`
- `inventory_moves`
- `cash_sessions`
- `accounting_accounts`
- `accounting_entries`

## Flujo de uso esperado

### Tenant nuevo

1. Super admin crea tenant
2. Sistema crea defaults base
3. Admin tenant entra al sistema
4. Desde `Home` ve el CTA `Config inicial` si faltan pasos esenciales
5. Entra a `/setup`
6. Sigue la `Ruta recomendada`
7. Completa procesos criticos y realiza pruebas operativas
8. Cuando ya no hay pendientes esenciales, el CTA del Home desaparece

## UX vigente

### En Home

- no se usa card grande del asistente
- se evita competir visualmente con el dashboard
- el CTA del asistente:
  - va junto a `Nueva Venta`
  - usa badge con pendientes
  - aparece solo si hace falta

### En el wizard

- hero de onboarding operativo
- resumen global
- tarjetas por proceso
- persistencia de paneles expandidos por tenant
- checklist expandible por proceso
- boton a la siguiente mejor accion
- boton `Ir al Punto de Venta` cuando todo este operativo
- bloque especifico de adopcion contable gradual

### En Configuracion de Empresa

- si el usuario entra desde onboarding, se muestra alerta de `Modo guiado`
- el tab correcto se selecciona automaticamente segun el contexto recibido

### En Contabilidad

- si el proceso contable aun no esta operativo, el modulo muestra una banda de onboarding
- la banda expone:
  - mensaje del siguiente paso
  - bloqueantes
  - CTA al siguiente paso
  - regreso rapido al asistente

### En Inventario

- si el usuario entra desde onboarding, el modulo puede abrir el tab correcto via `query.tab`
- el modulo muestra una alerta contextual para explicar:
  - como cargar stock inicial
  - como validarlo en kardex
  - que existe `Cargue masivo` para productos, variantes y stock inicial

### En Cargue masivo

- `BulkImports.vue` reconoce `query.type`
- puede abrir directo en `product_variants`
- muestra mensaje contextual cuando se usa como atajo desde onboarding de inventario

### En Productos

- `Products.vue` reconoce `query.tab`
- `Products.vue` reconoce `query.action=create-product`
- muestra una alerta contextual para:
  - catalogo de ventas
  - catalogo de compras
  - productos inventariables
  - variantes operativas
- desde onboarding puede abrir directamente el dialogo de creacion de producto

## Defaults de tenant que siguen siendo base del onboarding

La creacion de tenant con defaults sigue siendo parte del flujo y continua soportando:

- ubicacion principal
- caja principal
- unidades de medida
- impuestos base
- metodos de pago
- roles por defecto
- usuario administrador inicial

## Testing recomendado

- [ ] Crear tenant nuevo
- [ ] Verificar que el CTA `Config inicial` aparezca en `Home`
- [ ] Entrar a `/setup`
- [ ] Confirmar que `Vender` inicie bloqueado o en progreso segun defaults
- [ ] Crear producto y variante, y verificar cambio de estado
- [ ] Registrar venta de prueba y verificar paso de prueba operativa
- [ ] Crear proveedor y compra de prueba
- [ ] Verificar stock inicial por compra, ajuste o cargue masivo
- [ ] Verificar movimiento reflejado en kardex
- [ ] Activar contabilidad y validar plan de cuentas / primer asiento
- [ ] Confirmar que el CTA desaparece cuando ya no hay pendientes esenciales

## Reglas de mantenimiento

- Nuevos requisitos de onboarding deben definirse primero en `src/composables/useSetupAssistant.js`
- `SetupWizard.vue` solo debe consumir ese estado; no debe volver a duplicar queries de readiness
- `Home.vue` debe mantener acceso compacto; no volver a introducir un panel grande del asistente
- Contabilidad debe mantenerse como onboarding gradual y no como precondicion para operar POS
- Si un paso requiere abrir un tab o subflujo concreto, el enlace debe usar contexto (`query.tab`, `query.onboarding`, `query.process`) en lugar de solo mandar a la ruta base

## Mejoras futuras sugeridas

- persistir estado historico del onboarding en DB
- guardar fecha de primera venta / compra / apertura de caja / primer asiento
- onboarding guiado por sector de negocio
- mensajes contextuales dentro de cada modulo segun `nextStep`
- alertas de tenants estancados con onboarding incompleto

---

Fecha de actualizacion: 2026-03-18
Version del documento: 2.2
