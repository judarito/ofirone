# Plantilla de importación de productos simples (XLSX)

Descarga `public/templates/import-product-variants.xlsx` para obtener el archivo que deben completar los usuarios.

### Hoja `productos` (una fila por producto con variante única)
Cada columna se mapea así:

- `product_name` (requerido): nombre descriptivo del producto.
- `category_name`: se crea automáticamente si no existe.
- `unit_code` (requerido): código DIAN/tabla `units_of_measure` (revisar la hoja auxiliar).
- `description`: texto descriptivo libre.
- `variant_name`: si se deja en blanco, el sistema usará "Predeterminada" tal como la UI.
- `initial_stock`: cantidad inicial que se registrará en la ubicación indicada.
- `unit_cost`: costo unitario base.
- `unit_price`: precio de venta que se aplica a la variante predeterminada.
- `tax_code`: clave interna usada por el backend para asociar la tarifa de impuesto.
- `price_includes_tax`: TRUE/FALSE.
- `inventory_type`: REVENTA o MANUFACTURA (se guarda en `inventory_behavior`).
- `is_active`: TRUE/FALSE para activar o desactivar.
- `control_expiration`: TRUE/FALSE (en productos simples lo dejamos FALSE).
- `is_component`: TRUE/FALSE para marcar el producto como insumo.
- `location_code`: código de la ubicación donde se entregará el stock inicial.
- `standard_code`: código estándar del producto para el XML de Facturación Electrónica DIAN (ej. código UNSPSC). Opcional.
- `standard_code_type`: tipo de código estándar — `UNSPSC` (default), `EAN`, `GTIN` o `PARTNUM`. Usa el desplegable en la plantilla.

Los SKU se asignan automáticamente como cuando usas la UI (producto simple con variante única), así que no necesitas escribirlos.

### Hoja `unidades_dian`
Contiene los códigos DIAN permitidos (códigos, descripciones y nombres). Usa la fila que corresponda al `unit_code` que quieres aplicar.

### Buenas prácticas
- Usa `TRUE`/`FALSE` en mayúsculas para los flags.
- Ajusta `initial_stock`/`unit_cost`/`unit_price` con valores numéricos.
- No crees productos duplicados manualmente; la importación idealmente se usa sólo para arranque inicial.
