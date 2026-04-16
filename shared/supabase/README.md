# Shared Supabase Backend

Este directorio es la fuente canónica del backend compartido entre `web` y `mobile`.

## Qué quedó unificado en esta fase

- `145` migraciones que existían en `web/migrations` y `mobile/migrations` con contenido idéntico.
- `2` Edge Functions compartidas:
  - `chat-order-parser`
  - `create-tenant-user`

Manifiestos:

- [shared-migrations.txt](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/shared-migrations.txt)
- [shared-functions.txt](/home/juan/Documentos/Dev/Proyectos/ofirone/shared/supabase/shared-functions.txt)

## Qué no se unificó todavía

Se mantiene fuera de `shared` todo lo que hoy diverge o es específico de una app.

Pendientes intencionales:

- Functions específicas por producto:
  - `web`: `accounting-queue-worker`, `deepseek-proxy`
  - `mobile`: `deepseek-ocr-proxy`, `ops-rag-agent`, `product-photo-analyzer`, `product-photo-parser`, `push-dispatcher`

## Cómo sincronizar

Para evitar redundancia física y mantener las rutas `web/...` y `mobile/...`, el modo recomendado es crear symlinks hacia `shared/supabase`.

```bash
scripts/sync-shared-supabase.sh link
```

Para validar que `web` y `mobile` sigan alineados con la fuente canónica:

```bash
scripts/sync-shared-supabase.sh check
```

## Regla operativa

Si un archivo aparece en los manifiestos de este directorio:

- se edita primero en `shared/supabase`
- luego se vuelve a enlazar o sincronizar hacia `web` y `mobile`

Si un archivo no aparece en esos manifiestos:

- sigue siendo propiedad de `web` o `mobile`
- no debe moverse a shared sin reconciliar antes sus diferencias funcionales
