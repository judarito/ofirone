# Fotos De Producto + IA

## Alcance
Este documento cubre el flujo de fotos adjuntas a un producto individual desde `ProductsScreen`.

No cubre la carga masiva de productos desde una foto de hoja o factura.
Ese flujo vive en `docs/PHOTO_PRODUCT_IMPORT_IA.md`.

## Componentes
- UI mobile:
  - `src/screens/ProductsScreen.js`
- Servicio mobile:
  - `src/services/productMedia.service.js`
- Edge Function:
  - `supabase/functions/product-photo-analyzer/index.ts`
- Migracion SQL:
  - `migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql`

## Requisitos Previos

### 1. Migracion SQL
Ejecutar:
- `migrations/ADD_PRODUCT_MEDIA_PHOTOS.sql`

### 2. Bucket privado en Storage
El bucket debe llamarse exactamente:
- `productmedia`

Nota:
- La migracion intenta crearlo con `storage.create_bucket(...)`.
- En algunos proyectos Supabase esa funcion no esta disponible y la migracion solo deja un `NOTICE`.
- Si el upload falla con `Bucket not found`, crear el bucket manualmente desde Storage o con SQL.

SQL minimo:
```sql
insert into storage.buckets (id, name, public)
values ('productmedia', 'productmedia', false)
on conflict (id) do nothing;
```

### 3. Edge Function
Desplegar:
```bash
supabase functions deploy product-photo-analyzer --project-ref mcufhthejdwonndvpmev
```

Secrets requeridos:
```bash
supabase secrets set DEEPSEEK_API_KEY=tu_api_key --project-ref mcufhthejdwonndvpmev
supabase secrets set OCR_SPACE_API_KEY=tu_api_key_ocr --project-ref mcufhthejdwonndvpmev
```

### 4. Variable mobile
La app usa por defecto `product-photo-analyzer`, pero se puede sobrescribir con:
```env
EXPO_PUBLIC_PRODUCT_PHOTO_ANALYZER_EDGE_FUNCTION=product-photo-analyzer
```

## Flujo Funcional
1. Usuario entra a `Productos`.
2. Crea o edita un producto.
3. Debe guardar el producto primero.
4. Desde `Fotos del producto` puede tomar foto o elegir desde galeria.
5. La app:
   - optimiza la imagen para upload
   - la sube a Storage
   - inserta metadata en `product_media`
   - intenta analizar la imagen con IA
6. Si la IA responde bien, las sugerencias quedan asociadas a esa foto.
7. Desde la UI se puede:
   - cambiar portada
   - eliminar foto
   - aplicar sugerencias IA al formulario

## Aislamiento Por Tenant
El feature no usa un bucket publico compartido.

Capas de aislamiento:
- `product_media` guarda `tenant_id` y tiene RLS por tenant.
- El archivo se guarda bajo path:
  - `tenantId/productId/timestamp_random.jpg`
- Las policies de `storage.objects` solo permiten operar dentro del bucket `productmedia` cuando la primera carpeta del path coincide con el tenant autenticado.
- La app consume signed URLs, no URLs publicas.

## Diagnostico Rapido

### Caso 1. `Bucket not found`
Causa probable:
- no existe `productmedia`

Validacion:
```sql
select id, name, public
from storage.buckets
where id = 'productmedia';
```

### Caso 2. `HTTP 404` en IA
Causa probable:
- `product-photo-analyzer` no esta desplegada
- el nombre de la function en mobile no coincide con el deploy real

Validacion:
- revisar `Edge Functions > product-photo-analyzer`
- revisar logs de la function

### Caso 3. La foto sube pero IA falla
Causa probable:
- falta `DEEPSEEK_API_KEY`
- falta `OCR_SPACE_API_KEY`
- error upstream de OCR o modelo

Validacion:
- revisar logs de `product-photo-analyzer`
- revisar `ai_status` y `ai_warnings` en `product_media`

## Verificaciones SQL

### Tabla de metadata
```sql
select
  media_id,
  tenant_id,
  product_id,
  storage_path,
  is_cover,
  ai_status,
  ai_summary,
  ai_warnings,
  created_at
from product_media
order by created_at desc
limit 20;
```

### Policies de storage
```sql
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'productmedia_%'
order by policyname;
```
