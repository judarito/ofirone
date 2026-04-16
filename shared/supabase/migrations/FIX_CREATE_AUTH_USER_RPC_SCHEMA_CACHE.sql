-- Repara y vuelve visible el RPC create_auth_user para PostgREST.
-- Útil cuando el frontend intenta invocar el RPC pero la función no existe
-- en la BD actual o el schema cache quedó desactualizado.

CREATE OR REPLACE FUNCTION public.create_auth_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role_ids uuid[] DEFAULT '{}',
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid;
  v_user_id uuid;
  v_tenant_id uuid;
  v_role_id uuid;
BEGIN
  SELECT u.tenant_id
  INTO v_tenant_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el tenant del usuario actual';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.tenant_id = v_tenant_id
      AND lower(u.email) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'El email ya está registrado en este tenant';
  END IF;

  -- Implementación de desarrollo: genera un auth_user_id sintético.
  -- En producción este paso debe integrarse con Supabase Auth Admin API.
  v_auth_user_id := gen_random_uuid();

  INSERT INTO public.users (
    auth_user_id,
    tenant_id,
    email,
    full_name,
    is_active
  ) VALUES (
    v_auth_user_id,
    v_tenant_id,
    lower(trim(p_email)),
    trim(p_full_name),
    p_is_active
  )
  RETURNING user_id INTO v_user_id;

  IF coalesce(array_length(p_role_ids, 1), 0) > 0 THEN
    FOREACH v_role_id IN ARRAY p_role_ids
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.roles r
        WHERE r.role_id = v_role_id
          AND r.tenant_id = v_tenant_id
      ) THEN
        RAISE EXCEPTION 'El rol % no pertenece al tenant actual', v_role_id;
      END IF;

      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (v_user_id, v_role_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'auth_user_id', v_auth_user_id,
    'email', lower(trim(p_email)),
    'message', 'Usuario creado exitosamente. NOTA: La contraseña debe ser configurada en Supabase Auth.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_auth_user(text, text, text, uuid[], boolean) TO authenticated;

COMMENT ON FUNCTION public.create_auth_user(text, text, text, uuid[], boolean)
IS 'Crea un usuario del tenant actual y asigna roles. En desarrollo simula auth_user_id; en producción debe integrarse con Supabase Auth Admin.';

NOTIFY pgrst, 'reload schema';
