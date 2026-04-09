# Sistema de Centro de Ayuda

Fecha de actualizacion: 2026-03-18

## Objetivo

Centralizar el manual de usuario dentro de la app y enlazarlo con ayuda contextual en los modulos criticos.

## Componentes principales

- Vista principal: `src/views/HelpCenter.vue`
- Tarjeta contextual: `src/components/ContextHelpCard.vue`
- Fuente de contenido: `src/content/helpCenter.js`
- Logica de progreso y articulos recientes: `src/composables/useHelpCenter.js`

## Capacidades actuales

- busqueda por texto
- filtro por proceso
- articulos operativos por modulo
- FAQs relacionadas
- checklist interactivo persistido en `localStorage`
- articulos recientes
- accesos directos a modulos

## Modulos con ayuda contextual

- `PointOfSale.vue`
- `Purchases.vue`
- `Inventory.vue`
- `Accounting.vue`

## Regla UX vigente

- El dashboard principal no debe sobrecargarse con bloques grandes de ayuda.
- La entrada principal al sistema de ayuda debe estar en `/help` y desde accesos contextuales en modulos criticos.

## Nota funcional importante sobre caja

- La documentacion de caja debe tratar la operacion por sesiones, no solo por cajas creadas.
- Debe dejarse explicito que existe el parametro de tenant `cash_session_max_hours`.
- Ese parametro define cuantas horas maximo puede durar abierta una sesion antes de marcarse como vencida.

## Reglas de mantenimiento

- Si cambia un flujo operativo critico, actualizar primero `src/content/helpCenter.js`.
- Si se agrega un nuevo modulo critico, definir:
  - articulo
  - FAQs
  - contexto
  - acceso contextual en UI
- Evitar manuales externos desconectados de la app. La fuente vigente para usuario debe seguir siendo `/help`.
