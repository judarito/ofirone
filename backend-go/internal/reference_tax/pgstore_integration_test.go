package reference_tax

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// This opt-in test provisions its schema: point it only at an EMPTY disposable
// database. It never reads application .env files or existing DEV/PROD URLs.
func TestPostgresCRUDAndRLS(t *testing.T) {
	url := os.Getenv("REFERENCE_TAX_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set REFERENCE_TAX_TEST_DATABASE_URL to an empty disposable database")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	var exists bool
	if err = admin.QueryRow(ctx, `SELECT to_regclass('public.tenants') IS NOT NULL`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("integration setup requires an empty disposable database")
	}
	for _, path := range []string{"../../../database/migrations/0001_core.up.sql", "../../../database/migrations/0004_reference_catalog.up.sql", "schema.sql"} {
		b, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = admin.Exec(ctx, string(b)); e != nil {
			t.Fatalf("schema %s: %v", path, e)
		}
	}
	if _, err = admin.Exec(ctx, `INSERT INTO public.tenants(tenant_id,slug,name) VALUES ($1,'tax-test-a','A'),($2,'tax-test-b','B')`, tenantA, tenantB); err != nil {
		t.Fatal(err)
	}
	if _, err = admin.Exec(ctx, `CREATE ROLE ref_tax_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
 GRANT USAGE ON SCHEMA public,app_private TO ref_tax_runtime;
 GRANT EXECUTE ON FUNCTION app_private.current_tenant_id() TO ref_tax_runtime;
 GRANT SELECT,INSERT,UPDATE ON public.taxes,public.reference_currencies,public.reference_regional_settings TO ref_tax_runtime;`); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.User = "ref_tax_runtime"
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := NewPGStore(pool)
	zero := Record{Code: "A", Name: "Zero rate", Rate: ptr(0.0), Active: true}
	a, err := s.Create(ctx, Taxes, tenantA, zero)
	if err != nil {
		t.Fatal("create tax", err)
	}
	if !ValidID(a.ID) || a.Rate == nil || *a.Rate != 0 {
		t.Fatal(a)
	}
	if _, err = s.Create(ctx, Taxes, tenantA, zero); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate", err)
	}
	if _, err = s.Create(ctx, Taxes, tenantB, zero); err != nil {
		t.Fatal("tenant code scope", err)
	}
	if _, err = s.Get(ctx, Taxes, tenantB, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("tenant leakage", err)
	}
	if err = s.Deactivate(ctx, Taxes, tenantB, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross tenant write", err)
	}
	hundred := Record{Code: "B", Name: "Full rate", Rate: ptr(100.0), Active: true}
	b, err := s.Create(ctx, Taxes, tenantA, hundred)
	if err != nil {
		t.Fatal(err)
	}
	b.Name = "Updated"
	b.Rate = ptr(19.0)
	b, err = s.Update(ctx, Taxes, tenantA, b)
	if err != nil || b.Name != "Updated" || *b.Rate != 19 {
		t.Fatal("update", b, err)
	}
	q, _ := ParseQuery(Taxes, tenantA, 1, "")
	page, err := s.List(ctx, Taxes, tenantA, q)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != a.ID || !page.HasMore {
		t.Fatal("page one", page, err)
	}
	q, err = ParseQuery(Taxes, tenantA, 1, page.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	page, err = s.List(ctx, Taxes, tenantA, q)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != b.ID || page.HasMore {
		t.Fatal("page two", page, err)
	}
	if err = s.Deactivate(ctx, Taxes, tenantA, a.ID); err != nil {
		t.Fatal(err)
	}
	a, err = s.Get(ctx, Taxes, tenantA, a.ID)
	if err != nil || a.Active {
		t.Fatal("soft delete", a, err)
	}
	cur, err := s.Create(ctx, Currencies, tenantA, Record{Code: "COP", Name: "Peso", DecimalPlaces: ptr(2), Active: true})
	if err != nil {
		t.Fatal("currency create", err)
	}
	profile := Record{Code: "default", Name: "Colombia", CurrencyCode: "COP", Locale: "es-CO", Timezone: "America/Bogota", Active: true}
	if _, err = s.Create(ctx, RegionalSettings, tenantB, profile); !errors.Is(err, ErrConflict) {
		t.Fatal("currency tenant scope", err)
	}
	regional, err := s.Create(ctx, RegionalSettings, tenantA, profile)
	if err != nil {
		t.Fatal("regional create", err)
	}
	regional.Locale = "en-US"
	regional, err = s.Update(ctx, RegionalSettings, tenantA, regional)
	if err != nil || regional.Locale != "en-US" {
		t.Fatal("regional update", err)
	}
	if err = s.Deactivate(ctx, Currencies, tenantA, cur.ID); !errors.Is(err, ErrConflict) {
		t.Fatal("used currency deactivated", err)
	}
	cur.Name = "Peso colombiano"
	cur, err = s.Update(ctx, Currencies, tenantA, cur)
	if err != nil || cur.Name != "Peso colombiano" {
		t.Fatal("currency update", err)
	}
	if err = s.Deactivate(ctx, RegionalSettings, tenantA, regional.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Deactivate(ctx, Currencies, tenantA, cur.ID); err != nil {
		t.Fatal(err)
	}
	regional.Active = true
	if _, err = s.Update(ctx, RegionalSettings, tenantA, regional); !errors.Is(err, ErrConflict) {
		t.Fatal("inactive currency accepted", err)
	}
	for _, table := range []string{"taxes", "reference_currencies", "reference_regional_settings"} {
		var count int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM public.`+table).Scan(&count); err != nil || count != 0 {
			t.Fatal("pooled tenant context leaked", table, count, err)
		}
	}
}
