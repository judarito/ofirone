-- Destructive rollback: removes the migration ledger and its history.
-- Export/reconcile the ledger before rollback; later migrations go first.
BEGIN;
DROP TABLE public.schema_migrations;
COMMIT;
