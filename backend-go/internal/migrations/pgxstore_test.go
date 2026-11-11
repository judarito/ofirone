package migrations

// Unit tests only: no database credentials or network are used. Pending real
// PostgreSQL integration: provision the existing ledger in a disposable DB,
// run two independent pools concurrently to verify lock contention/cancellation,
// exercise transactional DDL rollback and resume, and verify an uncertain unlock
// destroys the connection. Use a direct or session-mode connection, not a
// transaction-mode pooler. Existing SQL wrappers must be normalized by the caller
// before checksumming, per the runner's input contract.

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var errPGXTest = errors.New("pgx test failure")

type pgxTestCall struct {
	sql  string
	args []any
}

type pgxTestConnection struct {
	ledger             []Entry
	effects            []string
	events             []string
	calls              []pgxTestCall
	rows               *pgxTestRows
	lockErr            error
	queryErr           error
	beginErr           error
	unlockErr          error
	discardErr         error
	unlocked           bool
	releases           int
	discards           int
	cleanupCanceled    bool
	cleanupHasDeadline bool
	newTx              func() *pgxTestTx
}

func (c *pgxTestConnection) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	c.events = append(c.events, "lock")
	c.calls = append(c.calls, pgxTestCall{sql, args})
	if c.lockErr != nil {
		return pgconn.CommandTag{}, c.lockErr
	}
	return pgconn.NewCommandTag("SELECT 1"), ctx.Err()
}

func (c *pgxTestConnection) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.events = append(c.events, "ledger")
	c.calls = append(c.calls, pgxTestCall{sql, args})
	if c.queryErr != nil {
		return nil, c.queryErr
	}
	if c.rows == nil {
		c.rows = &pgxTestRows{entries: append([]Entry(nil), c.ledger...)}
	}
	return c.rows, nil
}

func (c *pgxTestConnection) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	c.events = append(c.events, "unlock")
	c.calls = append(c.calls, pgxTestCall{sql, args})
	c.checkCleanup(ctx)
	return pgxTestRow{c.unlocked, c.unlockErr}
}

func (c *pgxTestConnection) Begin(context.Context) (pgx.Tx, error) {
	c.events = append(c.events, "begin")
	if c.beginErr != nil {
		return nil, c.beginErr
	}
	tx := &pgxTestTx{}
	if c.newTx != nil {
		tx = c.newTx()
	}
	tx.conn = c
	return tx, nil
}

func (c *pgxTestConnection) Release() {
	c.events = append(c.events, "release")
	c.releases++
}

func (c *pgxTestConnection) Discard(ctx context.Context) error {
	c.events = append(c.events, "discard")
	c.discards++
	c.checkCleanup(ctx)
	return c.discardErr
}

func (c *pgxTestConnection) checkCleanup(ctx context.Context) {
	c.cleanupCanceled = c.cleanupCanceled || ctx.Err() != nil
	_, c.cleanupHasDeadline = ctx.Deadline()
}

type pgxTestRow struct {
	unlocked bool
	err      error
}

func (r pgxTestRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*dest[0].(*bool) = r.unlocked
	return nil
}

type pgxTestRows struct {
	pgx.Rows // Unused pgx methods intentionally fail if the adapter calls them.
	entries  []Entry
	position int
	closed   bool
	scanErr  error
	err      error
}

func (r *pgxTestRows) Next() bool {
	if r.position >= len(r.entries) {
		r.Close()
		return false
	}
	r.position++
	return true
}

func (r *pgxTestRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	e := r.entries[r.position-1]
	*dest[0].(*int64) = e.Version
	*dest[1].(*string) = e.Name
	*dest[2].(*string) = e.Checksum
	*dest[3].(*bool) = e.Dirty
	return nil
}

func (r *pgxTestRows) Close()     { r.closed = true }
func (r *pgxTestRows) Err() error { return r.err }

type pgxTestTx struct {
	pgx.Tx          // Unused pgx methods intentionally fail if the adapter calls them.
	conn            *pgxTestConnection
	insertErr       error
	execErr         error
	cleanErr        error
	commitErr       error
	rollbackErr     error
	badInsertCount  bool
	badCleanCount   bool
	commitThenError bool
	entry           Entry
	sql             string
	commits         int
	rollbacks       int
}

func (tx *pgxTestTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tx.conn.calls = append(tx.conn.calls, pgxTestCall{sql, args})
	if err := ctx.Err(); err != nil {
		return pgconn.CommandTag{}, err
	}
	switch sql {
	case pgxInsertSQL:
		tx.conn.events = append(tx.conn.events, "insert")
		tx.entry = Entry{args[0].(int64), args[1].(string), args[2].(string), true}
		if tx.badInsertCount {
			return pgconn.NewCommandTag("INSERT 0 0"), nil
		}
		return pgconn.NewCommandTag("INSERT 0 1"), tx.insertErr
	case pgxCleanSQL:
		tx.conn.events = append(tx.conn.events, "clean")
		if tx.badCleanCount {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		tx.entry.Dirty = false
		return pgconn.NewCommandTag("UPDATE 1"), tx.cleanErr
	default:
		tx.conn.events = append(tx.conn.events, "exec")
		tx.sql = sql
		return pgconn.NewCommandTag("CREATE TABLE"), tx.execErr
	}
}

func (tx *pgxTestTx) Commit(ctx context.Context) error {
	tx.conn.events = append(tx.conn.events, "commit")
	tx.commits++
	if err := ctx.Err(); err != nil {
		return err
	}
	if tx.commitErr == nil || tx.commitThenError {
		tx.conn.ledger = append(tx.conn.ledger, tx.entry)
		tx.conn.effects = append(tx.conn.effects, tx.sql)
	}
	return tx.commitErr
}

func (tx *pgxTestTx) Rollback(ctx context.Context) error {
	tx.conn.events = append(tx.conn.events, "rollback")
	tx.rollbacks++
	tx.conn.checkCleanup(ctx)
	return tx.rollbackErr
}

func pgxTestStore(c *pgxTestConnection) *PGXStore {
	return NewPGXStoreWithAcquire(func(context.Context) (PGXConnection, error) { return c, nil })
}

func pgxTestSession(t *testing.T, c *pgxTestConnection) Session {
	t.Helper()
	s, err := pgxTestStore(c).Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close(context.Background()) })
	return s
}

func TestPGXStoreAcquireFailures(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		name  string
		store *PGXStore
		ctx   context.Context
		want  error
	}{
		{"nil store", nil, context.Background(), ErrInvalid},
		{"nil pool", NewPGXStore(nil), context.Background(), ErrInvalid},
		{"zero store", &PGXStore{}, context.Background(), ErrInvalid},
		{"nil connection", NewPGXStoreWithAcquire(func(context.Context) (PGXConnection, error) { return nil, nil }), context.Background(), ErrInvalid},
		{"factory error", NewPGXStoreWithAcquire(func(context.Context) (PGXConnection, error) { return nil, errPGXTest }), context.Background(), errPGXTest},
		{"canceled before acquire", NewPGXStoreWithAcquire(func(context.Context) (PGXConnection, error) { t.Fatal("unexpected acquire"); return nil, nil }), ctx, context.Canceled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, err := tc.store.Acquire(tc.ctx)
			if s != nil || !errors.Is(err, tc.want) {
				t.Fatalf("Acquire = %v, %v; want %v", s, err, tc.want)
			}
		})
	}
}

func TestPGXStoreLockErrorDiscardsWithIndependentContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	discardErr := errors.New("discard failed")
	c := &pgxTestConnection{lockErr: errPGXTest, discardErr: discardErr}
	store := NewPGXStoreWithAcquire(func(context.Context) (PGXConnection, error) {
		cancel() // Model cancellation while waiting for the advisory lock.
		return c, nil
	})
	s, err := store.Acquire(ctx)
	if s != nil || !errors.Is(err, errPGXTest) || !errors.Is(err, discardErr) {
		t.Fatalf("Acquire = %v, %v", s, err)
	}
	if c.discards != 1 || c.releases != 0 || c.cleanupCanceled || !c.cleanupHasDeadline {
		t.Fatalf("unsafe cleanup: %+v", c)
	}
	if !reflect.DeepEqual(c.calls, []pgxTestCall{{pgxLockSQL, []any{pgxMigrationLockID}}}) {
		t.Fatalf("lock query = %+v", c.calls)
	}
}

func TestPGXSessionLedger(t *testing.T) {
	want := []Entry{{1, "first", "abc", false}, {2, "second", "def", true}}
	c := &pgxTestConnection{ledger: want, unlocked: true}
	s := pgxTestSession(t, c)
	got, err := s.Ledger(context.Background())
	if err != nil || !reflect.DeepEqual(got, want) || !c.rows.closed {
		t.Fatalf("Ledger = %+v, %v; closed = %v", got, err, c.rows.closed)
	}
	if call := c.calls[1]; call.sql != pgxLedgerSQL || len(call.args) != 0 {
		t.Fatalf("ledger query = %+v", call)
	}
}

func TestPGXSessionLedgerErrors(t *testing.T) {
	missingTable := &pgconn.PgError{Code: "42P01", Message: "relation does not exist"}
	for _, tc := range []struct {
		name string
		conn pgxTestConnection
		want error
	}{
		{"missing ledger", pgxTestConnection{queryErr: missingTable}, missingTable},
		{"scan", pgxTestConnection{rows: &pgxTestRows{entries: []Entry{{Version: 1}}, scanErr: errPGXTest}}, errPGXTest},
		{"iteration", pgxTestConnection{rows: &pgxTestRows{err: errPGXTest}}, errPGXTest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.conn.unlocked = true
			s := pgxTestSession(t, &tc.conn)
			entries, err := s.Ledger(context.Background())
			if entries != nil || !errors.Is(err, tc.want) {
				t.Fatalf("Ledger = %+v, %v", entries, err)
			}
			if tc.conn.rows != nil && !tc.conn.rows.closed {
				t.Fatal("rows leaked")
			}
		})
	}
}

func TestPGXRunnerTransactionAndReapply(t *testing.T) {
	c := &pgxTestConnection{unlocked: true}
	h := history()
	if err := New(pgxTestStore(c)).Run(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	wantEvents := []string{"lock", "ledger", "begin", "insert", "exec", "clean", "commit", "begin", "insert", "exec", "clean", "commit", "unlock", "release"}
	if !reflect.DeepEqual(c.events, wantEvents) || !reflect.DeepEqual(c.ledger, []Entry{entry(h[0]), entry(h[1])}) {
		t.Fatalf("events = %v; ledger = %+v", c.events, c.ledger)
	}
	wantCalls := []pgxTestCall{
		{pgxLockSQL, []any{pgxMigrationLockID}}, {pgxLedgerSQL, nil},
		{pgxInsertSQL, []any{h[0].Version, h[0].Name, h[0].Checksum}},
		{h[0].SQL, []any{pgx.QueryExecModeSimpleProtocol}}, {pgxCleanSQL, []any{h[0].Version}},
		{pgxInsertSQL, []any{h[1].Version, h[1].Name, h[1].Checksum}},
		{h[1].SQL, []any{pgx.QueryExecModeSimpleProtocol}}, {pgxCleanSQL, []any{h[1].Version}},
		{pgxUnlockSQL, []any{pgxMigrationLockID}},
	}
	if !reflect.DeepEqual(c.calls, wantCalls) {
		t.Fatalf("SQL calls = %+v", c.calls)
	}
	// A second run reads the committed ledger and does not reexecute SQL.
	c.rows, c.events = nil, nil
	if err := New(pgxTestStore(c)).Run(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(c.events, []string{"lock", "ledger", "unlock", "release"}) || len(c.effects) != 2 {
		t.Fatalf("reapplied: %v; effects = %v", c.events, c.effects)
	}
}

func TestPGXRunnerFailureRollbackAndRelease(t *testing.T) {
	duplicate := &pgconn.PgError{Code: "23505", Message: "duplicate key"}
	for _, tc := range []struct {
		name      string
		tx        pgxTestTx
		want      error
		rollbacks int
	}{
		{"duplicate insert", pgxTestTx{insertErr: duplicate}, duplicate, 1},
		{"SQL failure", pgxTestTx{execErr: errPGXTest}, errPGXTest, 1},
		{"clean failure", pgxTestTx{cleanErr: errPGXTest}, errPGXTest, 1},
		{"missing inserted row", pgxTestTx{badInsertCount: true}, ErrHistory, 1},
		{"missing dirty row", pgxTestTx{badCleanCount: true}, ErrHistory, 1},
		{"commit failure", pgxTestTx{commitErr: errPGXTest}, errPGXTest, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &pgxTestConnection{unlocked: true, newTx: func() *pgxTestTx { return &tc.tx }}
			err := New(pgxTestStore(c)).Run(context.Background(), history()[:1])
			if !errors.Is(err, tc.want) || len(c.ledger) != 0 || len(c.effects) != 0 {
				t.Fatalf("Run = %v; ledger = %+v; effects = %v", err, c.ledger, c.effects)
			}
			if tc.tx.rollbacks != tc.rollbacks || c.releases != 1 || c.discards != 0 {
				t.Fatalf("rollbacks=%d releases=%d discards=%d", tc.tx.rollbacks, c.releases, c.discards)
			}
		})
	}
}

func TestPGXRunnerUncertainCommitResumesFromLedger(t *testing.T) {
	tx := &pgxTestTx{commitErr: errPGXTest, commitThenError: true}
	c := &pgxTestConnection{unlocked: true, newTx: func() *pgxTestTx { return tx }}
	h := history()[:1]
	if err := New(pgxTestStore(c)).Run(context.Background(), h); !errors.Is(err, errPGXTest) {
		t.Fatalf("Run = %v", err)
	}
	c.rows, c.events = nil, nil
	if err := New(pgxTestStore(c)).Run(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if len(c.effects) != 1 || tx.commits != 1 || tx.rollbacks != 0 {
		t.Fatalf("uncertain commit was reapplied: %+v", tx)
	}
}

func TestPGXSessionClose(t *testing.T) {
	for _, tc := range []struct {
		name     string
		unlocked bool
		err      error
		discard  int
	}{
		{"success", true, nil, 0},
		{"unlock error", false, errPGXTest, 1},
		{"lock missing", false, nil, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &pgxTestConnection{unlocked: tc.unlocked, unlockErr: tc.err}
			s := pgxTestSession(t, c)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			err := s.Close(ctx)
			if (err != nil) != (tc.discard == 1) || (tc.err != nil && !errors.Is(err, tc.err)) {
				t.Fatalf("Close = %v", err)
			}
			if again := s.Close(ctx); again != err {
				t.Fatalf("Close not idempotent: %v / %v", err, again)
			}
			if c.discards != tc.discard || c.releases != 1-tc.discard || c.cleanupCanceled || !c.cleanupHasDeadline {
				t.Fatalf("unsafe close: %+v", c)
			}
			if _, err := s.Ledger(context.Background()); !errors.Is(err, pgx.ErrTxClosed) {
				t.Fatalf("Ledger after Close = %v", err)
			}
			if _, err := s.Begin(context.Background()); !errors.Is(err, pgx.ErrTxClosed) {
				t.Fatalf("Begin after Close = %v", err)
			}
		})
	}
}

func TestPGXSessionCloseActiveTransaction(t *testing.T) {
	for _, rollbackErr := range []error{nil, pgx.ErrTxClosed, errPGXTest} {
		t.Run("rollback "+errorLabel(rollbackErr), func(t *testing.T) {
			tx := &pgxTestTx{rollbackErr: rollbackErr}
			c := &pgxTestConnection{unlocked: true, newTx: func() *pgxTestTx { return tx }}
			s := pgxTestSession(t, c)
			transaction, err := s.Begin(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			err = s.Close(context.Background())
			failed := errors.Is(rollbackErr, errPGXTest)
			if (err != nil) != failed || tx.rollbacks != 1 {
				t.Fatalf("Close = %v; rollbacks = %d", err, tx.rollbacks)
			}
			if failed && (!errors.Is(err, errPGXTest) || c.discards != 1 || c.releases != 0) {
				t.Fatalf("rollback failure cleanup = %+v", c)
			}
			if !failed && !reflect.DeepEqual(c.events, []string{"lock", "begin", "rollback", "unlock", "release"}) {
				t.Fatalf("cleanup order = %v", c.events)
			}
			if err := transaction.Rollback(context.Background()); err != nil || tx.rollbacks != 1 {
				t.Fatalf("Rollback after Close = %v", err)
			}
		})
	}
}

func errorLabel(err error) string {
	if err == nil {
		return "success"
	}
	return err.Error()
}

func TestPGXSessionBeginGuards(t *testing.T) {
	c := &pgxTestConnection{unlocked: true, beginErr: errPGXTest}
	s := pgxTestSession(t, c)
	if _, err := s.Begin(context.Background()); !errors.Is(err, errPGXTest) {
		t.Fatalf("Begin = %v", err)
	}
	c.beginErr = nil
	tx, err := s.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Begin(context.Background()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("second Begin = %v", err)
	}
	if _, err := s.Ledger(context.Background()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Ledger with active transaction = %v", err)
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Begin(context.Background()); err != nil {
		t.Fatalf("Begin after rollback = %v", err)
	}
}

func TestPGXTransactionEndedGuards(t *testing.T) {
	c := &pgxTestConnection{unlocked: true}
	s := pgxTestSession(t, c)
	tx, err := s.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Insert(context.Background(), Entry{Version: 1}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("non-dirty Insert = %v", err)
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, err := range []error{
		tx.Insert(context.Background(), Entry{Dirty: true}),
		tx.Exec(context.Background(), "SELECT 1"),
		tx.MarkClean(context.Background(), 1),
		tx.Commit(context.Background()),
	} {
		if !errors.Is(err, pgx.ErrTxClosed) {
			t.Fatalf("operation on ended transaction = %v", err)
		}
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatalf("repeated Rollback = %v", err)
	}
}
