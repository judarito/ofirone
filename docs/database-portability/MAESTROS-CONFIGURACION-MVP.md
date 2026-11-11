# Maestros de configuración MVP

## Contrato común

Todos los maestros se aíslan por `tenant_id` tomado del JWT. Los listados usan
`limit` entre 1 y 100 y cursor estable por nombre/ID. Las escrituras aceptan
`snake_case`, devuelven errores 400/401/422 y desactivan registros en lugar de
borrarlos cuando exista información operativa relacionada.

## Estado

| Maestro | Listar | Crear | Actualizar | Desactivar | Frontend Go | Tests |
|---|---:|---:|---:|---:|---:|---:|
| Ubicaciones | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Métodos de pago | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Monedas | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Unidades | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Categorías | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Impuestos | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

## Criterios de cierre

- Ningún maestro operativo depende de Supabase con el flag Go activo.
- Los métodos de pago deben resolverse por código desde ventas y CXC.
- Las ubicaciones deben poder seleccionarse en compras, ventas y stock.
- Categorías, unidades e impuestos deben seleccionarse al crear productos.
- Las monedas deben validarse como códigos ISO de tres letras.
