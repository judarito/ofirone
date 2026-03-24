-- ===================================================================
-- Verificacion rapida para alertas del Security Advisor de Supabase
-- ===================================================================
--
-- Uso sugerido:
-- 1) Ejecutar el bloque de tablas sin RLS.
-- 2) Ejecutar el bloque de columnas potencialmente sensibles.
-- 3) Aplicar correcciones.
-- 4) Repetir hasta que el resultado quede vacio o acotado.

-- 1) Tablas public sin RLS
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;

-- 2) Columnas potencialmente sensibles dentro de tablas sin RLS
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  )
  and column_name ~* '(email|phone|document|address|token|key|secret|password|credit|balance|technical|api|pin|before_data|after_data|tax_id|nit)'
order by table_name, column_name;

-- 3) Policies actuales en tablas core que suelen disparar alertas
select
  schemaname,
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('customers', 'locations', 'product_variants', 'products', 'tenants')
order by tablename, policyname;
