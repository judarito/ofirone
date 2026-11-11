// Package migrations applies a complete, ordered migration history atomically,
// one version at a time, without depending on a database driver.
package migrations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalid   = errors.New("migrations: invalid migration")
	ErrDuplicate = errors.New("migrations: duplicate version")
	ErrOrder     = errors.New("migrations: versions must be consecutive from 1")
	ErrChecksum  = errors.New("migrations: checksum mismatch")
	ErrHistory   = errors.New("migrations: ledger is not a matching history prefix")
	ErrDirty     = errors.New("migrations: dirty ledger entry")
)

type Migration struct {
	Version  int64
	Name     string
	Checksum string
	SQL      string
}

// Entry represents public.schema_migrations; the adapter owns applied_at.
type Entry struct {
	Version  int64
	Name     string
	Checksum string
	Dirty    bool
}

// Store acquires an exclusive migration lock before reading the ledger.
// PostgreSQL adapters can use a session advisory lock on a dedicated connection.
// The lock must serialize all runners targeting the same schema_migrations.
type Store interface {
	Acquire(context.Context) (Session, error)
}

// Session holds the lock until Close. Ledger returns every entry ordered by
// version ascending. Begin and Ledger must use the locked database connection.
// Close releases the lock and connection, even after a canceled Run context.
type Session interface {
	Ledger(context.Context) ([]Entry, error)
	Begin(context.Context) (Transaction, error)
	Close(context.Context) error
}

// Transaction contains both migration SQL and ledger mutations. Insert creates
// a dirty entry; MarkClean sets dirty=false and applied_at on that same entry.
// Neither operation may commit independently. Rollback must be safe after a
// failed Commit and return nil if the transaction has already ended.
type Transaction interface {
	Insert(context.Context, Entry) error
	Exec(context.Context, string) error
	MarkClean(context.Context, int64) error
	Commit(context.Context) error
	Rollback(context.Context) error
}

type Runner struct{ store Store }

func New(store Store) *Runner { return &Runner{store: store} }

// Run requires the complete history starting at version 1, including previously
// applied migrations. It never sorts, skips versions, repairs dirty entries or
// retries SQL automatically. A later call resumes from the committed prefix.
func (r *Runner) Run(ctx context.Context, history []Migration) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(history); err != nil {
		return err
	}
	if r == nil || r.store == nil {
		return fmt.Errorf("%w: missing store", ErrInvalid)
	}
	session, err := r.store.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("migrations: acquire lock: %w", err)
	}
	defer func() {
		cleanup, cancel := cleanupContext(ctx)
		defer cancel()
		if closeErr := session.Close(cleanup); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("migrations: release lock: %w", closeErr))
		}
	}()
	ledger, err := session.Ledger(ctx)
	if err != nil {
		return fmt.Errorf("migrations: read ledger: %w", err)
	}
	if err := validateLedger(history, ledger); err != nil {
		return err
	}
	for _, migration := range history[len(ledger):] {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := apply(ctx, session, migration); err != nil {
			return err
		}
	}
	return nil
}

func validate(history []Migration) error {
	seen := make(map[int64]bool, len(history))
	for _, m := range history {
		if seen[m.Version] {
			return fmt.Errorf("%w: version %d", ErrDuplicate, m.Version)
		}
		seen[m.Version] = true
	}
	for i, m := range history {
		if m.Version != int64(i)+1 {
			return fmt.Errorf("%w: version %d", ErrOrder, m.Version)
		}
		if !utf8.ValidString(m.Name) || len(m.Name) == 0 || utf8.RuneCountInString(m.Name) > 200 || strings.TrimSpace(m.Name) != m.Name ||
			strings.IndexFunc(m.Name, unicode.IsControl) >= 0 || strings.TrimSpace(m.SQL) == "" {
			return fmt.Errorf("%w: version %d", ErrInvalid, m.Version)
		}
		sum := sha256.Sum256([]byte(m.SQL))
		if m.Checksum != hex.EncodeToString(sum[:]) {
			return fmt.Errorf("%w: SQL for version %d", ErrChecksum, m.Version)
		}
	}
	return nil
}

func validateLedger(history []Migration, ledger []Entry) error {
	// Check every dirty flag before accepting any prefix or applying SQL.
	for _, entry := range ledger {
		if entry.Dirty {
			return fmt.Errorf("%w: version %d", ErrDirty, entry.Version)
		}
	}
	seen := make(map[int64]bool, len(ledger))
	for _, entry := range ledger {
		if seen[entry.Version] {
			return fmt.Errorf("%w: ledger version %d", ErrDuplicate, entry.Version)
		}
		seen[entry.Version] = true
	}
	for i, entry := range ledger {
		if entry.Version != int64(i)+1 {
			return fmt.Errorf("%w: ledger version %d", ErrOrder, entry.Version)
		}
		if i >= len(history) {
			return fmt.Errorf("%w: unknown version %d", ErrHistory, entry.Version)
		}
		m := history[i]
		if entry.Checksum != m.Checksum {
			return fmt.Errorf("%w: ledger version %d", ErrChecksum, entry.Version)
		}
		if entry.Name != m.Name {
			return fmt.Errorf("%w: name for version %d", ErrHistory, entry.Version)
		}
	}
	return nil
}

func apply(ctx context.Context, session Session, m Migration) (err error) {
	tx, err := session.Begin(ctx)
	if err != nil {
		return fmt.Errorf("migrations: version %d begin: %w", m.Version, err)
	}
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := cleanupContext(ctx)
			defer cancel()
			if rollbackErr := tx.Rollback(cleanup); rollbackErr != nil {
				err = errors.Join(err, fmt.Errorf("migrations: version %d rollback: %w", m.Version, rollbackErr))
			}
		}
	}()
	if err := tx.Insert(ctx, Entry{m.Version, m.Name, m.Checksum, true}); err != nil {
		return fmt.Errorf("migrations: version %d insert: %w", m.Version, err)
	}
	if err := tx.Exec(ctx, m.SQL); err != nil {
		return fmt.Errorf("migrations: version %d execute: %w", m.Version, err)
	}
	if err := tx.MarkClean(ctx, m.Version); err != nil {
		return fmt.Errorf("migrations: version %d mark clean: %w", m.Version, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("migrations: version %d commit: %w", m.Version, err)
	}
	committed = true
	return nil
}

func cleanupContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
}
