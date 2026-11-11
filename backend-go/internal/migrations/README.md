# Portable migration runner

`New(store).Run(ctx, history)` receives a complete history of `Migration` values
(`Version`, `Name`, `Checksum`, `SQL`). Versions must be consecutive from 1 in
ascending order. Checksums are lowercase SHA-256 of the exact supplied SQL bytes.
The runner validates the entire input and ledger before applying anything.

`Store.Acquire` provides a locked `Session`, whose `Ledger` reads every row of
`public.schema_migrations` in ascending version order. The ledger must be an exact
prefix of the supplied history, including names and checksums. Duplicate versions,
gaps, reordered entries, unknown applied versions and any dirty row stop execution.
There is no implicit baseline, automatic repair or automatic retry.

Each pending migration uses its own transaction:

1. Insert its ledger entry with `dirty=true`.
2. Execute its SQL.
3. Set `dirty=false` and `applied_at` in the same transaction.
4. Commit both the SQL effects and ledger entry together.

A failure rolls back the current version and leaves earlier committed versions
intact. A subsequent `Run` rereads the ledger and resumes. A commit error can mean
an uncertain outcome: the runner returns it; the next run determines the committed
state from the ledger. A preexisting dirty entry requires explicit investigation.
Dirty state inside a rolled-back transaction is deliberately not persisted.

## Adapter requirements

This package has no SQL driver, database connections or Supabase dependency.
Implement `Store`, `Session` and `Transaction` to integrate it. The adapter must:

- Serialize runners for the same ledger, using a dedicated connection and, for
  PostgreSQL, a session advisory lock held until `Session.Close`.
- Use that connection for ledger reads and every transaction.
- Insert the ledger entry, execute SQL and mark clean within one transaction.
- Return errors for duplicate inserts and a missing row in `MarkClean`.
- Make rollback harmless after a transaction has ended, including failed commits.
- Release resources on close even when the original context was canceled.

The ledger must already exist. Bootstrapping it is the adapter/caller's explicit
responsibility. The runner never creates it or reconciles historical entries.

Supplied SQL must be transaction-safe and exclude `BEGIN`, `COMMIT`, `ROLLBACK`
and operations that require execution outside a transaction. Normalize historical
script wrappers **before** computing checksums; this package does not parse SQL.
The runner does not enforce transaction semantics against arbitrary SQL: the SQL
is trusted migration code, and these requirements are part of its input contract.

Rollback and lock release each receive a five-second cleanup context independent
of request cancellation. Cleanup errors are joined with the original error and
can be inspected through `errors.Is`. The runner adds only version numbers and
operation names to errors; adapters should avoid returning credentials in errors.

## Tests

```bash
go test -race ./internal/migrations
go vet ./internal/migrations
```

The fake store models isolated transactional SQL effects and ledger changes.
Tests cover matching histories, resuming, validation failures, dirty entries,
failures at every transactional stage, retry, cancellation and resource cleanup.
