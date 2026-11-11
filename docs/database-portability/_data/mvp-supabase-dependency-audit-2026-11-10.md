# Auditoría de dependencias Supabase en MVP

## Resultado

El MVP **todavía no está 100% desacoplado de Supabase**. Los flags actuales
desvían algunas operaciones, pero varios métodos del mismo servicio siguen
consultando `supabaseService`.

| Módulo | Operaciones Go | Dependencias Supabase restantes |
|---|---|---|
| Auth | login/refresh/logout/me/menú | fallback y sesión legacy |
| Clientes | listado/crear/actualizar/desactivar parcial | búsquedas, detalles y algunos writes legacy |
| Productos | búsqueda POS y CRUD MVP | listados enriquecidos, barcode, detalles y catálogo avanzado |
| Compras | listar/recibir MVP | detalle, retornos, sugerencias, CxP y OCR |
| Inventario | stock, ajustes, kardex, alertas base | transferencias, alertas legacy, stock inicial y min-stock |
| Ventas | crear/listar MVP | detalle, anulación, retornos, pronóstico y reportes |
| CXC | listar cuentas y abonos | cuenta individual, cargos, movimientos y resumen |
| Maestros | ubicaciones/métodos y clientes de referencia | servicios legacy aún no desviados en todos los métodos |
| Reportes | ninguno consolidado en Go | dependencia completa de Supabase/vistas |

## Criterio correcto de cierre

No se debe marcar un módulo como migrado solo porque su listado principal o su
alta use Go. Deben estar migradas todas las operaciones que expone el servicio
usado por las pantallas del MVP, incluidos detalles, búsquedas, anulaciones,
retornos, movimientos y reportes.

## Próximo paquete obligatorio

1. Reportes Go para ventas, compras, inventario y CXC.
2. Detalle/anulación/retornos de ventas.
3. Detalle/retornos/CxP de compras.
4. Cuenta individual, cargos, movimientos y resumen CXC.
5. Búsqueda enriquecida, barcode y catálogo completo.
6. Transferencias y configuración avanzada de inventario.
