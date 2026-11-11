-- PROPUESTA ADR-011 (Slice J) — función de login con filtro email/tenant.
-- No es migración; requiere cambio del backend para usarla (fuera de perímetro).
-- Evita dar SELECT directo sobre identity_credentials al rol de auth.
create or replace function app_private.find_login(
    p_email text,
    p_tenant_id uuid
)
returns table (
    identity_id uuid,
    tenant_id uuid,
    password_hash text,
    membership_id uuid,
    permissions text[]
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
    select i.identity_id,
           tm.tenant_id,
           ic.password_hash,
           tm.membership_id,
           coalesce(array_agg(distinct p.code) filter (where p.code is not null), '{}') as permissions
      from public.identities i
      join public.identity_credentials ic on ic.identity_id = i.identity_id
      join public.tenant_memberships tm
        on tm.identity_id = i.identity_id
       and tm.tenant_id = p_tenant_id
       and tm.status = 'active'
      join public.membership_roles mr
        on mr.tenant_id = tm.tenant_id and mr.membership_id = tm.membership_id
      left join public.role_permissions rp
        on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      left join public.permissions p on p.permission_id = rp.permission_id
     where lower(i.email) = lower(btrim(p_email))
       and i.status = 'active'
     group by i.identity_id, tm.tenant_id, ic.password_hash, tm.membership_id
$$;

revoke all on function app_private.find_login(text, uuid) from public;
-- grant execute on function app_private.find_login(text, uuid) to ofirone_auth;
