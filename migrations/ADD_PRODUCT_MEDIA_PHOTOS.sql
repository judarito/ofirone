-- ===================================================================
-- Fotos de producto: storage + metadata + RLS
-- ===================================================================
-- Nota operativa:
-- `storage.create_bucket(...)` puede no estar disponible en algunos proyectos.
-- Si luego del deploy aparece `Bucket not found`, crear manualmente el bucket
-- privado `productmedia` y volver a probar la carga desde mobile.

DO $$
BEGIN
  PERFORM storage.create_bucket('productmedia'::TEXT, FALSE::BOOLEAN);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
  WHEN undefined_function THEN
    RAISE NOTICE 'storage.create_bucket no disponible (crea el bucket productmedia vía consola o API)';
END $$;

CREATE OR REPLACE FUNCTION public.fn_current_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT tenant_id
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS public.product_media (
  media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  variant_id UUID NULL REFERENCES public.product_variants(variant_id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes INTEGER NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  ai_status TEXT NOT NULL DEFAULT 'NOT_ANALYZED'
    CHECK (ai_status IN ('NOT_ANALYZED', 'PROCESSING', 'READY', 'FAILED')),
  ai_summary TEXT NULL,
  ai_detected_name TEXT NULL,
  ai_detected_brand TEXT NULL,
  ai_detected_category TEXT NULL,
  ai_suggested_description TEXT NULL,
  ai_labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NULL REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.product_media
  ADD COLUMN IF NOT EXISTS ai_suggested_description TEXT NULL;

CREATE INDEX IF NOT EXISTS product_media_tenant_product_idx
  ON public.product_media(tenant_id, product_id, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS product_media_one_cover_per_product_idx
  ON public.product_media(product_id)
  WHERE is_cover = TRUE;

CREATE OR REPLACE FUNCTION public.fn_touch_product_media_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_product_media_updated_at ON public.product_media;
CREATE TRIGGER trg_touch_product_media_updated_at
BEFORE UPDATE ON public.product_media
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_product_media_updated_at();

CREATE OR REPLACE FUNCTION public.fn_product_media_cover_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_cover BOOLEAN;
BEGIN
  IF NEW.is_cover THEN
    UPDATE public.product_media
    SET is_cover = FALSE,
        updated_at = timezone('utc', now())
    WHERE product_id = NEW.product_id
      AND media_id <> COALESCE(NEW.media_id, gen_random_uuid())
      AND is_cover = TRUE;
  ELSE
    SELECT EXISTS(
      SELECT 1
      FROM public.product_media
      WHERE product_id = NEW.product_id
        AND media_id <> COALESCE(NEW.media_id, gen_random_uuid())
        AND is_cover = TRUE
    ) INTO has_cover;

    IF NOT has_cover THEN
      NEW.is_cover := TRUE;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_media_cover_guard ON public.product_media;
CREATE TRIGGER trg_product_media_cover_guard
BEFORE INSERT OR UPDATE OF is_cover ON public.product_media
FOR EACH ROW
EXECUTE FUNCTION public.fn_product_media_cover_guard();

CREATE OR REPLACE FUNCTION public.fn_product_media_promote_cover_after_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_media_id UUID;
BEGIN
  IF OLD.is_cover THEN
    SELECT media_id
    INTO next_media_id
    FROM public.product_media
    WHERE product_id = OLD.product_id
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1;

    IF next_media_id IS NOT NULL THEN
      UPDATE public.product_media
      SET is_cover = TRUE,
          updated_at = timezone('utc', now())
      WHERE media_id = next_media_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_media_promote_cover_after_delete ON public.product_media;
CREATE TRIGGER trg_product_media_promote_cover_after_delete
AFTER DELETE ON public.product_media
FOR EACH ROW
EXECUTE FUNCTION public.fn_product_media_promote_cover_after_delete();

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_media_select" ON public.product_media;
CREATE POLICY "product_media_select" ON public.product_media
FOR SELECT
USING (tenant_id = fn_current_user_tenant_id());

DROP POLICY IF EXISTS "product_media_insert" ON public.product_media;
CREATE POLICY "product_media_insert" ON public.product_media
FOR INSERT
WITH CHECK (tenant_id = fn_current_user_tenant_id());

DROP POLICY IF EXISTS "product_media_update" ON public.product_media;
CREATE POLICY "product_media_update" ON public.product_media
FOR UPDATE
USING (tenant_id = fn_current_user_tenant_id())
WITH CHECK (tenant_id = fn_current_user_tenant_id());

DROP POLICY IF EXISTS "product_media_delete" ON public.product_media;
CREATE POLICY "product_media_delete" ON public.product_media
FOR DELETE
USING (tenant_id = fn_current_user_tenant_id());

-- En proyectos Supabase recientes, storage.objects ya viene bajo control de la plataforma
-- y este ALTER puede fallar con "must be owner of table objects".
-- Dejamos solo las policies sobre storage.objects.

DROP POLICY IF EXISTS "productmedia_select" ON storage.objects;
CREATE POLICY "productmedia_select" ON storage.objects
FOR SELECT
USING (
  bucket_id = 'productmedia'
  AND (storage.foldername(name))[1] = fn_current_user_tenant_id()::TEXT
);

DROP POLICY IF EXISTS "productmedia_insert" ON storage.objects;
CREATE POLICY "productmedia_insert" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'productmedia'
  AND (storage.foldername(name))[1] = fn_current_user_tenant_id()::TEXT
);

DROP POLICY IF EXISTS "productmedia_update" ON storage.objects;
CREATE POLICY "productmedia_update" ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'productmedia'
  AND (storage.foldername(name))[1] = fn_current_user_tenant_id()::TEXT
)
WITH CHECK (
  bucket_id = 'productmedia'
  AND (storage.foldername(name))[1] = fn_current_user_tenant_id()::TEXT
);

DROP POLICY IF EXISTS "productmedia_delete" ON storage.objects;
CREATE POLICY "productmedia_delete" ON storage.objects
FOR DELETE
USING (
  bucket_id = 'productmedia'
  AND (storage.foldername(name))[1] = fn_current_user_tenant_id()::TEXT
);
