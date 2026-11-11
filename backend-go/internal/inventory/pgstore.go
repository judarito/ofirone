package inventory

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const listBatchesSQL = `SELECT batch_id, tenant_id, location_id, variant_id,
       quantity_on_hand::bigint, quantity_reserved::bigint, is_active,
       updated_at::text, batch_id::text
FROM public.inventory_batches
WHERE tenant_id = $1 AND location_id = $2 AND variant_id = $3
  AND ($4 = '' OR (updated_at, batch_id::text) < ($4::timestamptz, $5))
ORDER BY updated_at DESC, batch_id DESC
LIMIT $6`

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) ListBatches(ctx context.Context, tenantID, locationID, variantID string, limit int, afterUpdatedAt, afterID string) (Page, error) {
	if s == nil || s.pool == nil {
		return Page{}, fmt.Errorf("inventory: nil postgres pool")
	}
	if tenantID == "" || locationID == "" || variantID == "" || limit < 1 || limit > 100 {
		return Page{}, fmt.Errorf("inventory: invalid list request")
	}
	rows, err := s.pool.Query(ctx, listBatchesSQL, tenantID, locationID, variantID, afterUpdatedAt, afterID, limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	items := make([]Batch, 0, limit+1)
	updatedCursors := make([]string, 0, limit+1)
	idCursors := make([]string, 0, limit+1)
	var updatedAt, rowID string
	for rows.Next() {
		var b Batch
		if err := rows.Scan(&b.ID, &b.TenantID, &b.LocationID, &b.VariantID, &b.OnHand, &b.Reserved, &b.Active, &updatedAt, &rowID); err != nil {
			return Page{}, err
		}
		items = append(items, b)
		updatedCursors = append(updatedCursors, updatedAt)
		idCursors = append(idCursors, rowID)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	p := Page{Items: items}
	if len(items) > limit {
		p.HasMore = true
		p.Items = items[:limit]
		p.NextUpdatedAt, p.NextID = updatedCursors[limit-1], idCursors[limit-1]
	}
	return p, nil
}

func (s *PGStore) ListStock(ctx context.Context, tenantID, locationID, variantID string, limit int, afterUpdatedAt, afterID string) (StockPage, error) {
	if s == nil || s.pool == nil {
		return StockPage{}, fmt.Errorf("inventory: nil postgres pool")
	}
	if tenantID == "" || limit < 1 || limit > 100 {
		return StockPage{}, fmt.Errorf("inventory: invalid stock request")
	}
	rows, err := s.pool.Query(ctx, `SELECT b.tenant_id, b.location_id, b.variant_id,
       sum(b.quantity_on_hand)::bigint, sum(b.quantity_reserved)::bigint, max(b.updated_at)::text,
       l.name, v.name, v.sku,
       CASE WHEN sum(b.quantity_on_hand) = 0 THEN 0
            ELSE (sum(b.quantity_on_hand * b.unit_cost) / sum(b.quantity_on_hand))::bigint
       END,
       0::bigint,
       p.name, (p.product_type = 'manufactured')
FROM public.inventory_batches b
JOIN public.locations l ON l.tenant_id=b.tenant_id AND l.location_id=b.location_id
JOIN public.product_variants v ON v.tenant_id=b.tenant_id AND v.variant_id=b.variant_id
JOIN public.products p ON p.tenant_id=v.tenant_id AND p.product_id=v.product_id
WHERE b.tenant_id=$1 AND b.is_active
  AND ($2='' OR b.location_id=$2::uuid)
  AND ($3='' OR b.variant_id=$3::uuid)
  AND ($4='' OR (b.updated_at, b.location_id::text || ':' || b.variant_id::text) < ($4::timestamptz, $5))
GROUP BY b.tenant_id,b.location_id,b.variant_id,l.name,v.name,v.sku,v.cost,p.name,p.product_type
ORDER BY max(b.updated_at) DESC, b.location_id DESC, b.variant_id DESC
LIMIT $6`, tenantID, locationID, variantID, afterUpdatedAt, afterID, limit+1)
	if err != nil {
		return StockPage{}, err
	}
	defer rows.Close()
	items := make([]StockBalance, 0, limit+1)
	cursorAt := make([]string, 0, limit+1)
	cursorID := make([]string, 0, limit+1)
	for rows.Next() {
		var b StockBalance
		if err := rows.Scan(&b.TenantID, &b.LocationID, &b.VariantID, &b.OnHand, &b.Reserved, &b.UpdatedAt, &b.LocationName, &b.VariantName, &b.SKU, &b.Cost, &b.MinStock, &b.ProductName, &b.IsComponent); err != nil {
			return StockPage{}, err
		}
		items = append(items, b)
		cursorAt = append(cursorAt, b.UpdatedAt)
		cursorID = append(cursorID, b.LocationID+":"+b.VariantID)
	}
	if err := rows.Err(); err != nil {
		return StockPage{}, err
	}
	page := StockPage{Items: items}
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
		page.NextUpdatedAt, page.NextID = cursorAt[limit-1], cursorID[limit-1]
	}
	return page, nil
}
func (s *PGStore) ListMoves(ctx context.Context, t, l, v string, n int, a, id string) (MovePage, error) {
	rows, e := s.pool.Query(ctx, `SELECT m.movement_id,m.location_id,m.variant_id,m.quantity_delta::bigint,m.movement_type,m.occurred_at::text,l.name,p.name,v.name,v.sku,COALESCE(m.unit_cost,b.unit_cost,0)::bigint FROM public.inventory_moves m JOIN public.locations l ON l.tenant_id=m.tenant_id AND l.location_id=m.location_id JOIN public.product_variants v ON v.tenant_id=m.tenant_id AND v.variant_id=m.variant_id JOIN public.products p ON p.tenant_id=v.tenant_id AND p.product_id=v.product_id LEFT JOIN public.inventory_batches b ON b.tenant_id=m.tenant_id AND b.batch_id=m.batch_id WHERE m.tenant_id=$1 AND ($2='' OR m.location_id=$2::uuid) AND ($3='' OR m.variant_id=$3::uuid) AND ($4='' OR (m.occurred_at,m.movement_id::text)<($4::timestamptz,$5)) ORDER BY m.occurred_at DESC,m.movement_id DESC LIMIT $6`, t, l, v, a, id, n+1)
	if e != nil {
		return MovePage{}, e
	}
	defer rows.Close()
	p := MovePage{Items: make([]Move, 0, n)}
	for rows.Next() {
		var m Move
		if e = rows.Scan(&m.ID, &m.LocationID, &m.VariantID, &m.Delta, &m.Type, &m.OccurredAt, &m.LocationName, &m.ProductName, &m.VariantName, &m.SKU, &m.UnitCost); e != nil {
			return p, e
		}
		p.Items = append(p.Items, m)
	}
	if len(p.Items) > n {
		p.HasMore = true
		p.Items = p.Items[:n]
		p.NextAt = p.Items[n-1].OccurredAt
		p.NextID = p.Items[n-1].ID
	}
	return p, rows.Err()
}

func (s *PGStore) ApplyMovement(ctx context.Context, m Movement, batchID string) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("inventory: nil postgres pool")
	}
	if err := m.Validate(); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE public.inventory_batches SET quantity_on_hand=quantity_on_hand+$1 WHERE tenant_id=$2 AND batch_id=$3 AND location_id=$4 AND variant_id=$5 AND quantity_on_hand+$1>=quantity_reserved`, m.Delta, m.TenantID, batchID, m.LocationID, m.VariantID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("inventory: insufficient stock or batch mismatch")
	}
	_, err = tx.Exec(ctx, `INSERT INTO public.inventory_moves(movement_id,tenant_id,location_id,variant_id,batch_id,quantity_delta,movement_type) VALUES($1,$2,$3,$4,$5,$6,$7)`, m.ID, m.TenantID, m.LocationID, m.VariantID, batchID, m.Delta, m.Type)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PGStore) Available(ctx context.Context, tenantID, locationID, variantID string) (int64, error) {
	if s == nil || s.pool == nil {
		return 0, fmt.Errorf("inventory: nil postgres pool")
	}
	var available int64
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(SUM(quantity_on_hand-quantity_reserved),0)::bigint FROM public.inventory_batches WHERE tenant_id=$1 AND location_id=$2 AND variant_id=$3 AND is_active`, tenantID, locationID, variantID).Scan(&available)
	return available, err
}
func (s *PGStore) ListAlerts(ctx context.Context, t string, n int) ([]Alert, error) {
	rows, e := s.pool.Query(ctx, `SELECT b.location_id,b.variant_id,b.on_hand::bigint,b.reserved::bigint,coalesce(v.min_stock,0)::bigint,(b.on_hand-b.reserved)::bigint FROM stock_balances b JOIN product_variants v ON v.tenant_id=b.tenant_id AND v.variant_id=b.variant_id WHERE b.tenant_id=$1 AND b.on_hand-b.reserved<=coalesce(v.min_stock,0) ORDER BY (b.on_hand-b.reserved),b.location_id,b.variant_id LIMIT $2`, t, n)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var a Alert
		if e = rows.Scan(&a.LocationID, &a.VariantID, &a.OnHand, &a.Reserved, &a.MinStock, &a.Available); e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
