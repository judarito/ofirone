package reference_catalog

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"testing"
)

func TestDatabaseErrorClassification(t *testing.T) {
	for _, tc := range []struct{ input, want error }{
		{pgx.ErrNoRows, ErrNotFound},
		{&pgconn.PgError{Code: "23505"}, ErrConflict},
		{&pgconn.PgError{Code: "23503"}, ErrParent},
		{&pgconn.PgError{Code: "23514"}, ErrInvalid},
		{&pgconn.PgError{Code: "22P02"}, ErrInvalid},
		{context.Canceled, context.Canceled},
	} {
		if !errors.Is(dbError(tc.input), tc.want) {
			t.Fatalf("%v not mapped to %v", tc.input, tc.want)
		}
	}
}
func TestStoreRejectsInvalidInputBeforeDatabase(t *testing.T) {
	s := NewPGStore(nil)
	ctx := context.Background()
	if _, e := s.Get(ctx, Units, tenant, "bad"); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	if _, e := s.List(ctx, Units, tenant, Query{Limit: 101}); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	if _, e := s.Save(ctx, Categories, Item{}, true); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	if e := s.Deactivate(ctx, Kind("arbitrary_table"), tenant, tenant); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	if _, e := s.List(ctx, Units, tenant, Query{Limit: 25}); e == nil {
		t.Fatal("nil database accepted")
	}
}
