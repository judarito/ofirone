package reports

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }
func bounds(f Filter, at string) (string, []any) {
	return fmt.Sprintf(" AND ($2::timestamptz IS NULL OR %s >= $2) AND ($3::timestamptz IS NULL OR %s < $3) AND ($4 = '' OR location_id = $4::uuid)", at, at), []any{f.TenantID, f.From, f.To, f.LocationID}
}

func (s *PGStore) Sales(ctx context.Context, f Filter) (SalesReport, error) {
	q, args := bounds(f, "sold_at")
	rows, e := s.pool.Query(ctx, `SELECT sale_id,sold_at,location_id,status,total::bigint FROM sales WHERE tenant_id=$1`+q+` AND ($5::timestamptz IS NULL OR (sold_at,sale_id::text)<($5,$6)) ORDER BY sold_at DESC,sale_id DESC LIMIT $7`, append(args, f.AfterAt, f.AfterID, f.Limit+1)...)
	if e != nil {
		return SalesReport{}, e
	}
	defer rows.Close()
	out := SalesReport{Items: make([]SalesRow, 0, f.Limit)}
	for rows.Next() {
		var x SalesRow
		if e = rows.Scan(&x.ID, &x.At, &x.LocationID, &x.Status, &x.Total); e != nil {
			return out, e
		}
		out.Count++
		out.Total += x.Total
		out.Items = append(out.Items, x)
	}
	if len(out.Items) > f.Limit {
		out.HasMore = true
		out.Items = out.Items[:f.Limit]
		out.NextAt = &out.Items[len(out.Items)-1].At
		out.NextID = out.Items[len(out.Items)-1].ID
	}
	return out, rows.Err()
}
func (s *PGStore) Purchases(ctx context.Context, f Filter) (PurchaseReport, error) {
	q, args := bounds(f, "purchased_at")
	rows, e := s.pool.Query(ctx, `SELECT purchase_id,purchased_at,location_id,status,total::bigint FROM purchases WHERE tenant_id=$1`+q+` AND ($5::timestamptz IS NULL OR (purchased_at,purchase_id::text)<($5,$6)) ORDER BY purchased_at DESC,purchase_id DESC LIMIT $7`, append(args, f.AfterAt, f.AfterID, f.Limit+1)...)
	if e != nil {
		return PurchaseReport{}, e
	}
	defer rows.Close()
	out := PurchaseReport{Items: make([]PurchaseRow, 0, f.Limit)}
	for rows.Next() {
		var x PurchaseRow
		if e = rows.Scan(&x.ID, &x.At, &x.LocationID, &x.Status, &x.Total); e != nil {
			return out, e
		}
		out.Count++
		out.Total += x.Total
		out.Items = append(out.Items, x)
	}
	if len(out.Items) > f.Limit {
		out.HasMore = true
		out.Items = out.Items[:f.Limit]
		out.NextAt = &out.Items[len(out.Items)-1].At
		out.NextID = out.Items[len(out.Items)-1].ID
	}
	return out, rows.Err()
}
func (s *PGStore) Inventory(ctx context.Context, f Filter) (InventoryReport, error) {
	q, args := bounds(f, "occurred_at")
	rows, e := s.pool.Query(ctx, `SELECT movement_id,occurred_at,location_id,variant_id,movement_type,quantity_delta::bigint FROM inventory_moves WHERE tenant_id=$1`+q+` AND ($5::timestamptz IS NULL OR (occurred_at,movement_id::text)<($5,$6)) ORDER BY occurred_at DESC,movement_id DESC LIMIT $7`, append(args, f.AfterAt, f.AfterID, f.Limit+1)...)
	if e != nil {
		return InventoryReport{}, e
	}
	defer rows.Close()
	out := InventoryReport{Items: make([]InventoryRow, 0, f.Limit)}
	for rows.Next() {
		var x InventoryRow
		if e = rows.Scan(&x.ID, &x.At, &x.LocationID, &x.VariantID, &x.MovementType, &x.QuantityDelta); e != nil {
			return out, e
		}
		out.NetQuantity += x.QuantityDelta
		out.Items = append(out.Items, x)
	}
	if len(out.Items) > f.Limit {
		out.HasMore = true
		out.Items = out.Items[:f.Limit]
		out.NextAt = &out.Items[len(out.Items)-1].At
		out.NextID = out.Items[len(out.Items)-1].ID
	}
	return out, rows.Err()
}
func (s *PGStore) Receivables(ctx context.Context, f Filter) (ReceivableReport, error) {
	rows, e := s.pool.Query(ctx, `SELECT credit_account_id,customer_id,status,current_balance::bigint,credit_limit::bigint FROM customer_credit_accounts WHERE tenant_id=$1 AND ($4='' OR status=$4) AND ($2::timestamptz IS NULL OR created_at >= $2) AND ($3::timestamptz IS NULL OR created_at < $3) AND ($5='' OR credit_account_id::text < $5) ORDER BY credit_account_id DESC LIMIT $6`, f.TenantID, f.From, f.To, f.Status, f.AfterID, f.Limit+1)
	if e != nil {
		return ReceivableReport{}, e
	}
	defer rows.Close()
	out := ReceivableReport{Items: make([]ReceivableRow, 0, f.Limit)}
	for rows.Next() {
		var x ReceivableRow
		if e = rows.Scan(&x.ID, &x.CustomerID, &x.Status, &x.CurrentBalance, &x.CreditLimit); e != nil {
			return out, e
		}
		out.Count++
		out.Outstanding += x.CurrentBalance
		out.Items = append(out.Items, x)
	}
	if len(out.Items) > f.Limit {
		out.HasMore = true
		out.Items = out.Items[:f.Limit]
		out.NextID = out.Items[len(out.Items)-1].ID
	}
	return out, rows.Err()
}

func (s *PGStore) Dashboard(ctx context.Context, f Filter) (DashboardSummary, error) {
	out := DashboardSummary{KPIs: map[string]DashboardKPI{}, DailySeries: []DashboardDaily{}, TopProducts: []DashboardProduct{}, PaymentMethods: []DashboardPayment{}}
	now := time.Now().UTC()
	periods := []struct {
		name     string
		from, to time.Time
	}{
		{"today", time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), now},
		{"month", time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), now},
		{"prev_month", time.Date(now.Year(), now.Month()-1, 1, 0, 0, 0, 0, time.UTC), time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)},
		{"year", time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC), now},
	}
	for _, p := range periods {
		var k DashboardKPI
		err := s.pool.QueryRow(ctx, `SELECT COALESCE(SUM(total),0)::bigint, COUNT(*) FROM sales WHERE tenant_id=$1 AND status IN ('completed','partially_returned') AND sold_at >= $2 AND sold_at < $3 AND ($4='' OR location_id=$4::uuid)`, f.TenantID, p.from, p.to, f.LocationID).Scan(&k.Total, &k.Count)
		if err != nil {
			return out, err
		}
		out.KPIs[p.name] = k
	}
	rows, err := s.pool.Query(ctx, `SELECT sold_at::date, COALESCE(SUM(total),0)::bigint FROM sales WHERE tenant_id=$1 AND status IN ('completed','partially_returned') AND sold_at >= $2 AND sold_at < $3 AND ($4='' OR location_id=$4::uuid) GROUP BY sold_at::date ORDER BY sold_at::date`, f.TenantID, now.AddDate(0, 0, -29), now.AddDate(0, 0, 1), f.LocationID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var d time.Time
		var total int64
		if err = rows.Scan(&d, &total); err != nil {
			return out, err
		}
		out.DailySeries = append(out.DailySeries, DashboardDaily{Date: d.Format("2006-01-02"), Total: total})
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows, err = s.pool.Query(ctx, `SELECT p.name || CASE WHEN v.name <> '' THEN ' ('||v.name||')' ELSE '' END, COALESCE(SUM(sl.line_total),0)::bigint, COALESCE(SUM(sl.quantity),0)::bigint FROM sale_lines sl JOIN sales s ON s.tenant_id=sl.tenant_id AND s.sale_id=sl.sale_id JOIN product_variants v ON v.tenant_id=sl.tenant_id AND v.variant_id=sl.variant_id JOIN products p ON p.tenant_id=v.tenant_id AND p.product_id=v.product_id WHERE sl.tenant_id=$1 AND s.status IN ('completed','partially_returned') AND s.sold_at >= $2 AND s.sold_at < $3 AND ($4='' OR s.location_id=$4::uuid) GROUP BY p.name,v.name ORDER BY SUM(sl.line_total) DESC LIMIT 7`, f.TenantID, time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), now, f.LocationID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var x DashboardProduct
		if err = rows.Scan(&x.Name, &x.Revenue, &x.Qty); err != nil {
			return out, err
		}
		out.TopProducts = append(out.TopProducts, x)
	}
	rows, err = s.pool.Query(ctx, `SELECT COALESCE(pm.code,pm.name), COALESCE(SUM(sp.amount),0)::bigint FROM sale_payments sp JOIN sales s ON s.tenant_id=sp.tenant_id AND s.sale_id=sp.sale_id JOIN payment_methods pm ON pm.tenant_id=sp.tenant_id AND pm.payment_method_id=sp.payment_method_id WHERE sp.tenant_id=$1 AND s.status IN ('completed','partially_returned') AND s.sold_at >= $2 AND s.sold_at < $3 AND ($4='' OR s.location_id=$4::uuid) GROUP BY pm.code,pm.name ORDER BY SUM(sp.amount) DESC`, f.TenantID, time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), now, f.LocationID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var x DashboardPayment
		if err = rows.Scan(&x.Method, &x.Total); err != nil {
			return out, err
		}
		out.PaymentMethods = append(out.PaymentMethods, x)
	}
	return out, rows.Err()
}
