package migrations

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// All stores targeting public.schema_migrations in a database use the same
// session lock ("OFIRMIGR"). This requires a direct PostgreSQL connection or
// session-mode pooler; transaction-mode poolers cannot preserve session locks.
const pgxMigrationLockID int64 = 0x4f4649524d494752

const (
	pgxLockSQL   = "SELECT pg_catalog.pg_advisory_lock($1)"
	pgxUnlockSQL = "SELECT pg_catalog.pg_advisory_unlock($1)"
	pgxLedgerSQL = "SELECT version, name, checksum, dirty FROM public.schema_migrations ORDER BY version ASC"
	pgxInsertSQL = "INSERT INTO public.schema_migrations (version, name, checksum, dirty) VALUES ($1, $2, $3, true)"
	pgxCleanSQL  = "UPDATE public.schema_migrations SET dirty = false, applied_at = pg_catalog.clock_timestamp() WHERE version = $1 AND dirty = true"
)

// PGXConnection is an exclusively borrowed connection. Implementations must
// execute all operations on the same physical PostgreSQL session. Release
// returns a healthy connection; Discard must detach and close it, even if closing
// fails. Exactly one of Release or Discard is called by the store.
type PGXConnection interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Begin(context.Context) (pgx.Tx, error)
	Release()
	Discard(context.Context) error
}

// PGXAcquireFunc allows callers and unit tests to supply dedicated connections.
// On error it must return no connection and retain responsibility for cleanup.
type PGXAcquireFunc func(context.Context) (PGXConnection, error)

// PGXStore adapts pgx/v5 to Store. The ledger must already exist: missing tables
// and other database errors are returned, never treated as an empty history.
// It neither creates the ledger nor reconciles existing versions. Migration SQL
// must satisfy Runner's transaction-safe input contract (no BEGIN/COMMIT/etc.).
type PGXStore struct {
	acquire PGXAcquireFunc
}

var (
	_ Store       = (*PGXStore)(nil)
	_ Session     = (*pgxSession)(nil)
	_ Transaction = (*pgxTransaction)(nil)
)

// NewPGXStore borrows connections from pool without taking ownership of it.
// Callers remain responsible for closing the pool after all runs finish.
func NewPGXStore(pool *pgxpool.Pool) *PGXStore {
	if pool == nil {
		return NewPGXStoreWithAcquire(nil)
	}
	return NewPGXStoreWithAcquire(func(ctx context.Context) (PGXConnection, error) {
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return nil, err
		}
		return &pgxPoolConnection{Conn: conn}, nil
	})
}

// NewPGXStoreWithAcquire creates a store with an injectable connection factory.
func NewPGXStoreWithAcquire(acquire PGXAcquireFunc) *PGXStore {
	return &PGXStore{acquire: acquire}
}

func (s *PGXStore) Acquire(ctx context.Context) (Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s == nil || s.acquire == nil {
		return nil, fmt.Errorf("%w: missing pgx connection factory", ErrInvalid)
	}
	conn, err := s.acquire(ctx)
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, fmt.Errorf("%w: missing pgx connection", ErrInvalid)
	}
	if _, err := conn.Exec(ctx, pgxLockSQL, pgxMigrationLockID); err != nil {
		// A lost response can hide a granted lock. Never return this connection
		// to the pool, even when the acquisition context has been canceled.
		cleanup, cancel := cleanupContext(ctx)
		defer cancel()
		return nil, errors.Join(err, conn.Discard(cleanup))
	}
	return &pgxSession{conn: conn}, nil
}

type pgxPoolConnection struct{ *pgxpool.Conn }

func (c *pgxPoolConnection) Discard(ctx context.Context) error {
	// Hijack removes it from the pool before closing, including on close errors.
	return c.Hijack().Close(ctx)
}

type pgxSession struct {
	mu       sync.Mutex // pgx connections do not support concurrent operations.
	conn     PGXConnection
	active   *pgxTransaction
	closed   bool
	closeErr error
}

func (s *pgxSession) Ledger(ctx context.Context) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, pgx.ErrTxClosed
	}
	if s.active != nil {
		return nil, fmt.Errorf("%w: transaction already active", ErrInvalid)
	}
	rows, err := s.conn.Query(ctx, pgxLedgerSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]Entry, 0)
	for rows.Next() {
		var entry Entry
		if err := rows.Scan(&entry.Version, &entry.Name, &entry.Checksum, &entry.Dirty); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

func (s *pgxSession) Begin(ctx context.Context) (Transaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, pgx.ErrTxClosed
	}
	if s.active != nil {
		return nil, fmt.Errorf("%w: transaction already active", ErrInvalid)
	}
	tx, err := s.conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	s.active = &pgxTransaction{session: s, tx: tx}
	return s.active, nil
}

func (s *pgxSession) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return s.closeErr
	}
	s.closed = true
	cleanup, cancel := cleanupContext(ctx)
	defer cancel()
	if s.active != nil {
		if err := s.active.rollback(cleanup); err != nil {
			s.closeErr = errors.Join(err, s.conn.Discard(cleanup))
			return s.closeErr
		}
	}
	var unlocked bool
	err := s.conn.QueryRow(cleanup, pgxUnlockSQL, pgxMigrationLockID).Scan(&unlocked)
	if err == nil && !unlocked {
		err = errors.New("migrations: advisory lock was not held")
	}
	if err != nil {
		s.closeErr = errors.Join(err, s.conn.Discard(cleanup))
		return s.closeErr
	}
	s.conn.Release()
	return nil
}

type pgxTransaction struct {
	session *pgxSession
	tx      pgx.Tx
	ended   bool
}

func (t *pgxTransaction) Insert(ctx context.Context, entry Entry) error {
	t.session.mu.Lock()
	defer t.session.mu.Unlock()
	if t.ended || t.session.closed {
		return pgx.ErrTxClosed
	}
	if !entry.Dirty {
		return fmt.Errorf("%w: new ledger entry must be dirty", ErrInvalid)
	}
	tag, err := t.tx.Exec(ctx, pgxInsertSQL, entry.Version, entry.Name, entry.Checksum)
	return pgxOneLedgerRow(tag, err)
}

func (t *pgxTransaction) Exec(ctx context.Context, sql string) error {
	t.session.mu.Lock()
	defer t.session.mu.Unlock()
	if t.ended || t.session.closed {
		return pgx.ErrTxClosed
	}
	// Trusted migration scripts may contain multiple statements. No bind values
	// are supplied, so simple protocol does not interpolate untrusted input.
	_, err := t.tx.Exec(ctx, sql, pgx.QueryExecModeSimpleProtocol)
	return err
}

func (t *pgxTransaction) MarkClean(ctx context.Context, version int64) error {
	t.session.mu.Lock()
	defer t.session.mu.Unlock()
	if t.ended || t.session.closed {
		return pgx.ErrTxClosed
	}
	tag, err := t.tx.Exec(ctx, pgxCleanSQL, version)
	return pgxOneLedgerRow(tag, err)
}

func pgxOneLedgerRow(tag pgconn.CommandTag, err error) error {
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: ledger mutation affected %d rows, expected 1", ErrHistory, tag.RowsAffected())
	}
	return nil
}

func (t *pgxTransaction) Commit(ctx context.Context) error {
	t.session.mu.Lock()
	defer t.session.mu.Unlock()
	if t.ended || t.session.closed {
		return pgx.ErrTxClosed
	}
	// pgx ends the transaction even when Commit fails. The runner reports the
	// uncertainty; a subsequent run rereads the ledger rather than retrying SQL.
	err := t.tx.Commit(ctx)
	t.ended = true
	t.session.active = nil
	return err
}

func (t *pgxTransaction) Rollback(ctx context.Context) error {
	t.session.mu.Lock()
	defer t.session.mu.Unlock()
	return t.rollback(ctx)
}

// rollback requires session.mu, including when Close is cleaning up an active tx.
func (t *pgxTransaction) rollback(ctx context.Context) error {
	if t.ended {
		return nil
	}
	err := t.tx.Rollback(ctx)
	t.ended = true
	t.session.active = nil
	if errors.Is(err, pgx.ErrTxClosed) {
		return nil
	}
	return err
}
