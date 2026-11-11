package reference_tax

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const tenantA = "6ff8da55-4bfc-4082-b6fe-9e794f8dd326"
const tenantB = "5cc9b7b7-e023-4126-918e-9748d232fc14"
const recordID = "38323d67-30f4-42a9-91f2-749750d16b56"

func ptr[T any](v T) *T { return &v }

func TestTaxRates(t *testing.T) {
	for _, rate := range []float64{0, 19, 100, 7.123456} {
		if e := (Record{Code: "VAT", Name: "Tax", Rate: ptr(rate)}).Validate(Taxes); e != nil {
			t.Errorf("rate %v: %v", rate, e)
		}
	}
	for _, rate := range []float64{-0.000001, 100.000001, math.NaN(), math.Inf(1), 0.1234567} {
		if e := (Record{Code: "VAT", Name: "Tax", Rate: ptr(rate)}).Validate(Taxes); !errors.Is(e, ErrInvalid) {
			t.Errorf("accepted rate %v", rate)
		}
	}
	if e := (Record{Code: "VAT", Name: "Tax"}).Validate(Taxes); e == nil {
		t.Fatal("missing rate accepted")
	}
}

func TestCurrencyAndRegionalValidation(t *testing.T) {
	for _, code := range []string{"COP", "USD", "EUR", "JPY"} {
		if e := (Record{Code: code, Name: "Currency", DecimalPlaces: ptr(2)}).Validate(Currencies); e != nil {
			t.Errorf("%s: %v", code, e)
		}
	}
	for _, code := range []string{"cop", "ZZZ", "XXX", "US", "USDD"} {
		if e := (Record{Code: code, Name: "Currency", DecimalPlaces: ptr(2)}).Validate(Currencies); e == nil {
			t.Errorf("accepted %s", code)
		}
	}
	good := Record{Code: "default", Name: "Colombia", CurrencyCode: "COP", Locale: "es-CO", Timezone: "America/Bogota"}
	if e := good.Validate(RegionalSettings); e != nil {
		t.Fatal(e)
	}
	bad := good
	bad.Timezone = "Mars/Unknown"
	if bad.Validate(RegionalSettings) == nil {
		t.Fatal("invalid timezone accepted")
	}
	bad = good
	bad.Locale = "invalid_locale_!"
	if bad.Validate(RegionalSettings) == nil {
		t.Fatal("invalid locale accepted")
	}
	bad = good
	bad.Timezone = "Local"
	if bad.Validate(RegionalSettings) == nil {
		t.Fatal("server-dependent timezone accepted")
	}
	bad = good
	bad.Rate = ptr(19.0)
	if bad.Validate(RegionalSettings) == nil {
		t.Fatal("tax field accepted for regional settings")
	}
	for _, digits := range []int{-1, 7} {
		if (Record{Code: "USD", Name: "Dollar", DecimalPlaces: ptr(digits)}).Validate(Currencies) == nil {
			t.Fatal("invalid precision accepted")
		}
	}
}

func TestPaginationBoundariesAndTenantBinding(t *testing.T) {
	q, err := ParseQuery(Taxes, tenantA, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	page := NewPage([]Record{{ID: recordID, Code: "A"}, {ID: recordID, Code: "B"}}, q, Taxes, tenantA)
	if len(page.Items) != 1 || !page.HasMore || page.NextCursor == "" {
		t.Fatal(page)
	}
	next, err := ParseQuery(Taxes, tenantA, 1, page.NextCursor)
	if err != nil || next.Cursor.Code != "A" {
		t.Fatal(next, err)
	}
	if _, e := ParseQuery(Taxes, tenantB, 1, page.NextCursor); e == nil {
		t.Fatal("cross-tenant cursor accepted")
	}
	if _, e := ParseQuery(Currencies, tenantA, 1, page.NextCursor); e == nil {
		t.Fatal("cross-resource cursor accepted")
	}
	for _, limit := range []int{-1, 0, 101} {
		if _, e := ParseQuery(Taxes, tenantA, limit, ""); e == nil {
			t.Fatal("bad limit accepted")
		}
	}
	if _, e := ParseQuery(Taxes, tenantA, 1, "garbage"); e == nil {
		t.Fatal("bad cursor accepted")
	}
	empty := NewPage(nil, q, Taxes, tenantA)
	if empty.Items == nil || empty.HasMore || empty.NextCursor != "" {
		t.Fatal(empty)
	}
}

func TestDBErrors(t *testing.T) {
	for code, want := range map[string]error{"23505": ErrConflict, "23503": ErrConflict, "23514": ErrInvalid, "22P02": ErrInvalid} {
		if !errors.Is(dbError(&pgconn.PgError{Code: code}), want) {
			t.Fatal(code)
		}
	}
	if !errors.Is(dbError(pgx.ErrNoRows), ErrNotFound) {
		t.Fatal("missing not found mapping")
	}
}

func TestStoreRejectsInvalidBeforeDatabase(t *testing.T) {
	s := NewPGStore(nil)
	if _, e := s.Create(context.Background(), Taxes, tenantA, Record{Code: "X", Name: "X", Rate: ptr(-1.0)}); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	if _, e := s.Get(context.Background(), Taxes, tenantA, "invalid"); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	if _, _, _, e := table(Resource("taxes; DROP TABLE taxes")); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
}
