package migrations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"strings"
	"testing"
)

var errFake = errors.New("store failure")

type fakeStore struct {
	ledger          []Entry
	effects         []string
	events          []string
	fail            string
	failVersion     int64
	acquired        bool
	cleanupCanceled bool
	cancel          context.CancelFunc
	commitThenError bool
}

func (s *fakeStore) Acquire(ctx context.Context) (Session, error) {
	s.events = append(s.events, "acquire")
	if s.fail == "acquire" {
		return nil, errFake
	}
	if s.acquired {
		return nil, errors.New("already acquired")
	}
	s.acquired = true
	return s, ctx.Err()
}

func (s *fakeStore) Ledger(ctx context.Context) ([]Entry, error) {
	s.events = append(s.events, "ledger")
	if s.fail == "ledger" {
		return nil, errFake
	}
	return append([]Entry(nil), s.ledger...), ctx.Err()
}

func (s *fakeStore) Begin(ctx context.Context) (Transaction, error) {
	s.events = append(s.events, "begin")
	if s.fail == "begin" {
		return nil, errFake
	}
	return &fakeTx{store: s}, ctx.Err()
}

func (s *fakeStore) Close(ctx context.Context) error {
	s.events = append(s.events, "close")
	s.cleanupCanceled = s.cleanupCanceled || ctx.Err() != nil
	s.acquired = false
	if s.fail == "close" {
		return errFake
	}
	return ctx.Err()
}

type fakeTx struct {
	store *fakeStore
	entry Entry
	sql   string
	ended bool
}

func (tx *fakeTx) step(ctx context.Context, stage string) error {
	tx.store.events = append(tx.store.events, stage)
	if tx.ended {
		return errors.New("transaction ended")
	}
	if tx.store.fail == stage && (tx.store.failVersion == 0 || tx.store.failVersion == tx.entry.Version) {
		return errFake
	}
	return ctx.Err()
}

func (tx *fakeTx) Insert(ctx context.Context, entry Entry) error {
	tx.entry = entry
	if !entry.Dirty {
		return errors.New("entry must start dirty")
	}
	return tx.step(ctx, "insert")
}

func (tx *fakeTx) Exec(ctx context.Context, sql string) error {
	tx.sql = sql // Represents a transactional effect, invisible until commit.
	if tx.store.cancel != nil {
		tx.store.cancel()
	}
	return tx.step(ctx, "exec")
}

func (tx *fakeTx) MarkClean(ctx context.Context, version int64) error {
	if tx.sql == "" || version != tx.entry.Version {
		return errors.New("invalid mark clean")
	}
	if err := tx.step(ctx, "clean"); err != nil {
		return err
	}
	tx.entry.Dirty = false
	return nil
}

func (tx *fakeTx) Commit(ctx context.Context) error {
	if err := tx.step(ctx, "commit"); err != nil {
		return err
	}
	if tx.entry.Dirty {
		return errors.New("committing dirty migration")
	}
	tx.store.ledger = append(tx.store.ledger, tx.entry)
	tx.store.effects = append(tx.store.effects, tx.sql)
	tx.ended = true
	if tx.store.commitThenError {
		return errFake
	}
	return nil
}

func (tx *fakeTx) Rollback(ctx context.Context) error {
	tx.store.events = append(tx.store.events, "rollback")
	tx.store.cleanupCanceled = tx.store.cleanupCanceled || ctx.Err() != nil
	tx.ended = true
	if tx.store.fail == "rollback" {
		return errFake
	}
	return ctx.Err()
}

func migration(version int64, sql string) Migration {
	sum := sha256.Sum256([]byte(sql))
	return Migration{Version: version, Name: "migration", Checksum: hex.EncodeToString(sum[:]), SQL: sql}
}

func history() []Migration {
	return []Migration{migration(1, "CREATE TABLE first (id int)"), migration(2, "CREATE TABLE second (id int)")}
}

func entry(m Migration) Entry { return Entry{Version: m.Version, Name: m.Name, Checksum: m.Checksum} }

func TestRunAppliesAndResumes(t *testing.T) {
	s := &fakeStore{}
	r := New(s)
	h := history()
	if err := r.Run(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	wantEvents := []string{"acquire", "ledger", "begin", "insert", "exec", "clean", "commit", "begin", "insert", "exec", "clean", "commit", "close"}
	if !reflect.DeepEqual(s.events, wantEvents) {
		t.Fatalf("events = %v", s.events)
	}
	if !reflect.DeepEqual(s.ledger, []Entry{entry(h[0]), entry(h[1])}) {
		t.Fatalf("ledger = %+v", s.ledger)
	}
	s.events = nil
	if err := r.Run(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.events, []string{"acquire", "ledger", "close"}) || len(s.effects) != 2 {
		t.Fatalf("reapplied history: %+v", s)
	}
}

func TestInvalidHistoryNeverAcquiresStore(t *testing.T) {
	h := history()
	tests := []struct {
		name    string
		history []Migration
		want    error
	}{
		{"duplicate", []Migration{h[0], h[0]}, ErrDuplicate},
		{"unordered", []Migration{h[1], h[0]}, ErrOrder},
		{"gap", []Migration{h[0], migration(3, "SELECT 3")}, ErrOrder},
		{"starts at two", []Migration{h[1]}, ErrOrder},
		{"zero", []Migration{migration(0, "SELECT 1")}, ErrOrder},
		{"negative", []Migration{migration(-1, "SELECT 1")}, ErrOrder},
	}
	for _, mutate := range []struct {
		name   string
		change func(*Migration)
		want   error
	}{
		{"empty name", func(m *Migration) { m.Name = "" }, ErrInvalid},
		{"long name", func(m *Migration) { m.Name = strings.Repeat("x", 201) }, ErrInvalid},
		{"invalid UTF-8", func(m *Migration) { m.Name = string([]byte{0xff}) }, ErrInvalid},
		{"padded name", func(m *Migration) { m.Name = " name" }, ErrInvalid},
		{"control name", func(m *Migration) { m.Name = "name\n" }, ErrInvalid},
		{"empty SQL", func(m *Migration) { m.SQL = "  " }, ErrInvalid},
		{"tampered SQL", func(m *Migration) { m.SQL += "; SELECT 1" }, ErrChecksum},
		{"invalid digest", func(m *Migration) { m.Checksum = "bad" }, ErrChecksum},
	} {
		m := h[0]
		mutate.change(&m)
		tests = append(tests, struct {
			name    string
			history []Migration
			want    error
		}{mutate.name, []Migration{m}, mutate.want})
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &fakeStore{}
			if err := New(s).Run(context.Background(), tt.history); !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
			if len(s.events) != 0 {
				t.Fatalf("touched store: %v", s.events)
			}
		})
	}
}

func TestRejectsLedgerBeforeApplying(t *testing.T) {
	h := history()
	first, second := entry(h[0]), entry(h[1])
	dirty := second
	dirty.Dirty = true
	changed := first
	changed.Checksum = h[1].Checksum
	renamed := first
	renamed.Name = "renamed"
	unknown := entry(migration(3, "SELECT 3"))
	for _, tt := range []struct {
		name   string
		ledger []Entry
		want   error
	}{
		{"dirty", []Entry{first, dirty}, ErrDirty},
		{"checksum", []Entry{changed}, ErrChecksum},
		{"name", []Entry{renamed}, ErrHistory},
		{"duplicate", []Entry{first, first}, ErrDuplicate},
		{"unordered", []Entry{second, first}, ErrOrder},
		{"gap", []Entry{first, unknown}, ErrOrder},
		{"unknown", []Entry{first, second, unknown}, ErrHistory},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := &fakeStore{ledger: tt.ledger}
			if err := New(s).Run(context.Background(), h); !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
			if !reflect.DeepEqual(s.events, []string{"acquire", "ledger", "close"}) {
				t.Fatalf("events = %v", s.events)
			}
		})
	}
}

func TestFailureRollsBackAndRetryResumes(t *testing.T) {
	for _, stage := range []string{"insert", "exec", "clean", "commit"} {
		t.Run(stage, func(t *testing.T) {
			h := history()
			s := &fakeStore{fail: stage, failVersion: 2}
			r := New(s)
			if err := r.Run(context.Background(), h); !errors.Is(err, errFake) {
				t.Fatalf("error = %v", err)
			}
			if !reflect.DeepEqual(s.ledger, []Entry{entry(h[0])}) || !reflect.DeepEqual(s.effects, []string{h[0].SQL}) {
				t.Fatalf("partial effect leaked: %+v", s)
			}
			if got := s.events[len(s.events)-2:]; !reflect.DeepEqual(got, []string{"rollback", "close"}) {
				t.Fatalf("cleanup = %v", got)
			}
			s.fail = ""
			s.events = nil
			if err := r.Run(context.Background(), h); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(s.effects, []string{h[0].SQL, h[1].SQL}) {
				t.Fatalf("retry effects = %v", s.effects)
			}
			if !reflect.DeepEqual(s.events, []string{"acquire", "ledger", "begin", "insert", "exec", "clean", "commit", "close"}) {
				t.Fatalf("retry events = %v", s.events)
			}
		})
	}
}

func TestStoreFailures(t *testing.T) {
	for _, stage := range []string{"acquire", "ledger", "begin", "close"} {
		t.Run(stage, func(t *testing.T) {
			s := &fakeStore{fail: stage}
			if err := New(s).Run(context.Background(), history()); !errors.Is(err, errFake) {
				t.Fatalf("error = %v", err)
			}
			if s.acquired {
				t.Fatal("lock leaked")
			}
		})
	}
}

func TestCanceledMigrationStillRollsBackAndReleases(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &fakeStore{cancel: cancel}
	if err := New(s).Run(ctx, history()); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if s.acquired || s.cleanupCanceled || len(s.ledger) != 0 || len(s.effects) != 0 {
		t.Fatalf("invalid cleanup: %+v", s)
	}
	if !reflect.DeepEqual(s.events, []string{"acquire", "ledger", "begin", "insert", "exec", "rollback", "close"}) {
		t.Fatalf("events = %v", s.events)
	}
}

func TestEmptyHistoryStillValidatesLedger(t *testing.T) {
	s := &fakeStore{}
	if err := New(s).Run(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	s.ledger = []Entry{entry(history()[0])}
	if err := New(s).Run(context.Background(), nil); !errors.Is(err, ErrHistory) {
		t.Fatalf("error = %v", err)
	}
}

func TestMissingStoreAndCanceledContext(t *testing.T) {
	if err := New(nil).Run(context.Background(), history()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := &fakeStore{}
	if err := New(s).Run(ctx, history()); !errors.Is(err, context.Canceled) || len(s.events) != 0 {
		t.Fatalf("error = %v, events = %v", err, s.events)
	}
}

func TestUncertainCommitRereadsLedgerOnRetry(t *testing.T) {
	s := &fakeStore{commitThenError: true}
	h := history()
	if err := New(s).Run(context.Background(), h); !errors.Is(err, errFake) {
		t.Fatalf("error = %v", err)
	}
	if !reflect.DeepEqual(s.ledger, []Entry{entry(h[0])}) {
		t.Fatalf("ledger = %v", s.ledger)
	}
	s.commitThenError = false
	if err := New(s).Run(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.effects, []string{h[0].SQL, h[1].SQL}) {
		t.Fatalf("duplicated effects: %v", s.effects)
	}
}

func TestRollbackErrorPreservesOriginalError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &fakeStore{fail: "rollback", cancel: cancel}
	err := New(s).Run(ctx, history())
	if !errors.Is(err, context.Canceled) || !errors.Is(err, errFake) {
		t.Fatalf("lost original or cleanup error: %v", err)
	}
	if s.acquired {
		t.Fatal("lock leaked after rollback failure")
	}
}
