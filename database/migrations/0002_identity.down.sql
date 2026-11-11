-- Destructive rollback; dependent future migrations must be rolled back first.
BEGIN;
DROP TABLE public.refresh_tokens;
DROP TABLE public.sessions;
DROP TABLE public.membership_roles;
DROP TABLE public.role_permissions;
DROP TABLE public.permissions;
DROP TABLE public.roles;
DROP TABLE public.tenant_memberships;
DROP TABLE public.identities;
COMMIT;
