-- Pre-authentication lookup for the dedicated auth connection.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.find_login_credentials(p_email text, p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(identity_id uuid, tenant_id uuid, password_hash text, membership_id uuid, permissions text[])
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT i.identity_id, tm.tenant_id, ic.password_hash, tm.membership_id,
           COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}')
    FROM public.identities i
    JOIN public.identity_credentials ic ON ic.identity_id = i.identity_id
    JOIN public.tenant_memberships tm ON tm.identity_id = i.identity_id
        AND (p_tenant_id IS NULL OR tm.tenant_id = p_tenant_id)
        AND tm.status = 'active'
    JOIN public.membership_roles mr ON mr.tenant_id = tm.tenant_id AND mr.membership_id = tm.membership_id
    LEFT JOIN public.role_permissions rp ON rp.tenant_id = mr.tenant_id AND rp.role_id = mr.role_id
    LEFT JOIN public.permissions p ON p.permission_id = rp.permission_id
    WHERE lower(i.email) = lower(btrim(p_email)) AND i.status = 'active'
    GROUP BY i.identity_id, tm.tenant_id, ic.password_hash, tm.membership_id
    ORDER BY tm.tenant_id
    LIMIT 1
$$;

REVOKE ALL ON FUNCTION app_private.find_login_credentials(text, uuid) FROM PUBLIC;
COMMIT;
