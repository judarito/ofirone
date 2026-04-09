# POSLite / OfirOne

Aplicacion web multi-tenant para operacion comercial con POS, inventario, compras, manufactura, cartera, reportes y contabilidad Colombia, construida con Vue 3, Vuetify y Supabase.

## Estado actual

- Frontend SPA con Vue 3 + Vite + Vuetify 3.
- Backend sobre Supabase: Auth, Postgres, RPCs, Realtime y Edge Functions.
- Menus y acceso por rol, tenant y permisos.
- Contexto tecnico vivo en [`CONTEXTO_ULTIMO.md`](./CONTEXTO_ULTIMO.md).

## Modulos principales

- Punto de venta y ventas.
- Sesiones de caja, cajas y asignaciones.
- Catalogos base: productos, categorias, unidades, impuestos, reglas de impuestos y precios.
- Inventario, lotes, vencimientos y alertas.
- Compras y cuentas por pagar.
- Clientes, terceros y cartera.
- Manufactura: BOMs y ordenes de produccion.
- Reportes operativos y financieros.
- Contabilidad Colombia: dashboard, diario, mayor, retenciones, cierre, automatizacion, asientos manuales, plan de cuentas, estados financieros, centro tributario, conciliacion y control IA.

## Stack

- `vue`
- `vue-router`
- `vuetify`
- `@supabase/supabase-js`
- `apexcharts` / `vue3-apexcharts`
- `xlsx`
- `jspdf`

## Requisitos

- `node`
- `npm`
- Proyecto Supabase configurado

## Variables de entorno

Parte de la configuracion base vive en [`.env.example`](./.env.example):

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPER_ADMIN_EMAILS=
VITE_CHAT_ORDER_EDGE_FUNCTION=chat-order-parser
VITE_DEEPSEEK_TEXT_MODEL=deepseek-chat
```

Notas:

- La llave de IA no va en frontend.
- `DEEPSEEK_API_KEY` debe configurarse como secreto en Supabase Edge Functions.

## Instalacion local

```bash
cp .env.example .env
npm install
npm run dev
```

La aplicacion queda disponible en `http://localhost:5173`.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run generate:templates
```

## Arquitectura resumida

### Frontend

- Entrada: [`src/main.js`](./src/main.js)
- Shell principal: [`src/App.vue`](./src/App.vue)
- Rutas: [`src/router/index.js`](./src/router/index.js)
- Supabase client: [`src/plugins/supabase.js`](./src/plugins/supabase.js)

### Estado y composables

- Auth global: [`src/composables/useAuth.js`](./src/composables/useAuth.js)
- Tenant actual: [`src/composables/useTenant.js`](./src/composables/useTenant.js)
- Alertas de app: [`src/composables/useAppAlerts.js`](./src/composables/useAppAlerts.js)
- Modo contable `LIST/TABLE`: [`src/composables/useAccountingViewMode.js`](./src/composables/useAccountingViewMode.js)

### Servicios

La app usa una capa de servicios en [`src/services`](./src/services) para encapsular consultas, RPCs y reglas de negocio por dominio.

Ejemplos:

- Contabilidad: [`src/services/accounting.service.js`](./src/services/accounting.service.js)
- Productos: [`src/services/products.service.js`](./src/services/products.service.js)
- Ventas: [`src/services/sales.service.js`](./src/services/sales.service.js)
- Inventario: [`src/services/inventory.service.js`](./src/services/inventory.service.js)
- Alertas: [`src/services/alerts.service.js`](./src/services/alerts.service.js)

### Backend y datos

- Migraciones SQL en [`migrations`](./migrations)
- Recursos Supabase en [`supabase`](./supabase)
- Manual y documentacion adicional en [`docs`](./docs)

## Reglas operativas relevantes

- `CONTEXTO_ULTIMO.md` es la fuente activa de contexto del proyecto.
- Toda lista nueva o modificada debe usar [`src/components/ListView.vue`](./src/components/ListView.vue) como base, segun la regla vigente documentada en [`CONTEXTO_ULTIMO.md`](./CONTEXTO_ULTIMO.md).
- El modulo contable funciona desacoplado del POS mediante cola contable y RPCs en Supabase.

## Documentacion util

- Contexto activo: [`CONTEXTO_ULTIMO.md`](./CONTEXTO_ULTIMO.md)
- Manual tecnico del directorio docs: [`docs/README.md`](./docs/README.md)
- Manual de usuario web: [`public/MANUAL_USUARIO.html`](./public/MANUAL_USUARIO.html)
- Plan de cache y rendimiento: [`PLAN_CACHE_RENDIMIENTO.md`](./PLAN_CACHE_RENDIMIENTO.md)
