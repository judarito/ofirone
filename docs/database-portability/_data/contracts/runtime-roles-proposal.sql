-- PROPUESTA de roles PostgreSQL — NO ejecutar en DEV/PROD sin aprobación.
-- Objetivo: separar migrador, auth y API; el runtime NUNCA debe ser owner ni BYPASSRLS.
-- Las contraseñas no se incluyen: usar el gestor de secretos (OIDC/rotación).

-- Migrador: dueño del esquema y de las migraciones; no atiende tráfico.
create role ofirone_migrator login nosuperuser nobypassrls nocreatedb nocreaterole;
-- El DDL se aplica con un rol owner/privilegiado; luego:
-- alter schema public owner to ofirone_migrator;
-- grant create on schema public to ofirone_migrator;

-- Auth: valida credenciales y gestiona sesiones/refresh tokens.
create role ofirone_auth login nosuperuser nobypassrls nocreatedb nocreaterole;
grant usage on schema public, app_private to ofirone_auth;
grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to ofirone_auth;
grant select, insert, update on
  public.identities, public.sessions, public.refresh_tokens,
  public.tenant_memberships, public.membership_roles, public.roles, public.role_permissions, public.permissions
  to ofirone_auth;

-- API: tráfico de negocio; sin acceso al ledger ni a tablas de auth sensibles.
create role ofirone_api login nosuperuser nobypassrls nocreatedb nocreaterole;
grant usage on schema public, app_private to ofirone_api;
grant execute on function app_private.current_tenant_id(), app_private.current_identity_id() to ofirone_api;
grant select, insert, update on
  public.tenants, public.locations, public.units_of_measure, public.categories, public.taxes,
  public.payment_methods, public.third_parties, public.customers, public.products,
  public.product_variants, public.product_barcodes, public.inventory_batches,
  public.inventory_moves, public.stock_reservations, public.sales, public.sale_lines,
  public.sale_payments, public.purchases, public.purchase_lines, public.supplier_payables,
  public.supplier_payable_payments, public.customer_credit_accounts,
  public.customer_credit_movements, public.layaway_contracts, public.layaway_items,
  public.layaway_installments, public.layaway_payments, public.async_jobs, public.audit_log
  to ofirone_api;
revoke all on public.schema_migrations from ofirone_api, ofirone_auth;

-- Endurecimiento de sesión (aplicar a ambos roles de runtime).
alter role ofirone_auth set statement_timeout = '15s';
alter role ofirone_auth set idle_in_transaction_session_timeout = '30s';
alter role ofirone_api set statement_timeout = '30s';
alter role ofirone_api set idle_in_transaction_session_timeout = '30s';
alter role ofirone_api set search_path = public, app_private, pg_catalog;
alter role ofirone_auth set search_path = public, app_private, pg_catalog;

-- Notas:
-- 1) Revisar los grants por vertical (mínimo privilegio) antes de producción.
-- 2) `permissions` es catálogo global; si no debe ser legible por API, revocar SELECT.
-- 3) El rol API no puede crear objetos ni cambiar el ledger.
-- 4) Las políticas RLS se evalúan para estos roles (NOBYPASSRLS): app.tenant_id
--    debe fijarse por transacción con set_config(..., true) o SET LOCAL.
