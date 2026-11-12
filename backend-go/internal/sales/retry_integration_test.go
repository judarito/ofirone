package sales

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Use an empty, disposable PostgreSQL database on localhost.
func TestSaleRetryPostgres(t *testing.T) {
	url := os.Getenv("OFIRONE_SALE_RETRY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set OFIRONE_SALE_RETRY_TEST_DATABASE_URL to a disposable local database")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil || cfg.ConnConfig.Host != "127.0.0.1" {
		t.Fatal("expected a valid PostgreSQL URL on 127.0.0.1")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var empty bool
	if err := pool.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public')`).Scan(&empty); err != nil || !empty {
		t.Fatalf("expected empty database: %v", err)
	}
	migrations, err := filepath.Glob("../../../database/migrations/*.up.sql")
	if err != nil || len(migrations) == 0 {
		t.Fatalf("migrations unavailable: %v", err)
	}
	for _, path := range migrations {
		sql, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(sql), pgx.QueryExecModeSimpleProtocol); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}

	const tenant = "00000000-0000-0000-0000-000000000001"
	const location = "00000000-0000-0000-0000-000000000002"
	const variant = "00000000-0000-0000-0000-000000000005"
	const batch = "00000000-0000-0000-0000-000000000006"
	const identity = "00000000-0000-0000-0000-000000000009"
	const cash = "00000000-0000-0000-0000-000000000010"
	_, err = pool.Exec(ctx, `
		INSERT INTO tenants(tenant_id,slug,name) VALUES ('00000000-0000-0000-0000-000000000001','retry','Retry');
		INSERT INTO locations(location_id,tenant_id,code,name) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','A','A');
		INSERT INTO units_of_measure(unit_id,tenant_id,code,name) VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','UND','Unidad');
		INSERT INTO products(product_id,tenant_id,default_unit_id,code,name) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','P','Producto');
		INSERT INTO product_variants(variant_id,tenant_id,product_id,sku,name) VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','V','Variante');
		INSERT INTO inventory_batches(batch_id,tenant_id,location_id,variant_id,batch_number,quantity_on_hand) VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','L',3);
		INSERT INTO payment_methods(payment_method_id,tenant_id,code,name,method_type) VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','CASH','Efectivo','cash');
		INSERT INTO identities(identity_id,email,display_name) VALUES ('00000000-0000-0000-0000-000000000009','retry@example.test','Cajero');
		INSERT INTO cash_sessions(cash_session_id,tenant_id,location_id,opened_by_identity_id,open_idempotency_key) VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000009','open');
	`, pgx.QueryExecModeSimpleProtocol)
	if err != nil {
		t.Fatal(err)
	}
	store := NewPGStore(pool)
	request := func() Sale {
		return Sale{
			ID: "00000000-0000-0000-0000-000000000008", TenantID: tenant,
			LocationID: location, CreatedByIdentityID: identity, CashSessionID: cash,
			IdempotencyKey: "retry-key", Status: Completed,
			Lines:    []Line{{VariantID: variant, BatchID: batch, Quantity: 1, UnitPrice: 100}},
			Payments: []Payment{{MethodCode: "CASH", Amount: 100}},
		}
	}
	done := make(chan error, 2)
	for range 2 {
		go func() {
			sale := request()
			if err := store.Create(ctx, &sale); err != nil {
				done <- err
				return
			}
			if sale.ID != request().ID || sale.Total != 100 || sale.SaleNumber != 1 {
				done <- errors.New("unexpected sale response")
				return
			}
			done <- nil
		}()
	}
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO cash_session_counts(tenant_id,cash_session_id,denomination,quantity) VALUES ($1,$2,100,1)`, tenant, cash); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE cash_sessions SET status='closed', closed_by_identity_id=$1, closed_at=clock_timestamp(), expected_cash=100, counted_cash=100, difference=0, close_idempotency_key='close' WHERE cash_session_id=$2`, identity, cash); err != nil {
		t.Fatal(err)
	}
	replay := request()
	if err := store.Create(ctx, &replay); err != nil || replay.ID != request().ID || replay.Total != 100 {
		t.Fatalf("retry after closing cash session: %+v (%v)", replay, err)
	}
	changed := request()
	changed.Lines[0].UnitPrice = 90
	if err := store.Create(ctx, &changed); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed request: %v", err)
	}
	var sales, payments, moves, stock int
	err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM sales), (SELECT count(*) FROM sale_payments),
		(SELECT count(*) FROM inventory_moves), (SELECT quantity_on_hand::int FROM inventory_batches WHERE batch_id=$1)`, batch).
		Scan(&sales, &payments, &moves, &stock)
	if err != nil || sales != 1 || payments != 1 || moves != 1 || stock != 2 {
		t.Fatalf("sales=%d payments=%d moves=%d stock=%d: %v", sales, payments, moves, stock, err)
	}
}
