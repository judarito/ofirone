package purchases

import (
	"context"
	"crypto/rand"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ pool *pgxpool.Pool }

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) CreateReceived(ctx context.Context, p Purchase) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("purchases: nil postgres pool")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if p.PurchaseNumber == 0 {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, p.TenantID+":"+p.LocationID); err != nil {
			return err
		}
		if err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(purchase_number),0)+1 FROM public.purchases WHERE tenant_id=$1 AND location_id=$2`, p.TenantID, p.LocationID).Scan(&p.PurchaseNumber); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO public.purchases(purchase_id,tenant_id,location_id,supplier_id,purchase_number,status,subtotal,tax_total,discount_total,total) VALUES($1,$2,$3,$4,$5,'received',$6,$7,$8,$9)`, p.ID, p.TenantID, p.LocationID, p.SupplierID, p.PurchaseNumber, p.Subtotal, p.TaxTotal, p.Discount, p.Total); err != nil {
		return err
	}
	for i, line := range p.Lines {
		lineID := newID()
		lineTotal := line.Quantity * line.UnitCost
		if _, err = tx.Exec(ctx, `INSERT INTO public.purchase_lines(purchase_line_id,tenant_id,purchase_id,variant_id,line_number,quantity,unit_cost,line_total,quantity_received) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6)`, lineID, p.TenantID, p.ID, line.VariantID, i+1, line.Quantity, line.UnitCost, lineTotal); err != nil {
			return err
		}
		batchID := newID()
		batchNumber := fmt.Sprintf("%s-%d", p.ID, i+1)
		if _, err = tx.Exec(ctx, `INSERT INTO public.inventory_batches(batch_id,tenant_id,location_id,variant_id,batch_number,quantity_on_hand,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`, batchID, p.TenantID, p.LocationID, line.VariantID, batchNumber, line.Quantity, line.UnitCost); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO public.inventory_moves(movement_id,tenant_id,location_id,variant_id,batch_id,quantity_delta,movement_type,source_type,source_id,unit_cost) VALUES($1,$2,$3,$4,$5,$6,'purchase_in','purchase',$7,$8)`, newID(), p.TenantID, p.LocationID, line.VariantID, batchID, line.Quantity, p.ID, line.UnitCost); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *PGStore) List(ctx context.Context, tenant string, limit int, afterAt, afterID string) (Page, error) {
	if s == nil || s.pool == nil {
		return Page{}, fmt.Errorf("purchases: nil postgres pool")
	}
	rows, err := s.pool.Query(ctx, `SELECT purchase_id,tenant_id,location_id,supplier_id,status,subtotal,tax_total,discount_total,total,purchase_number FROM public.purchases WHERE tenant_id=$1 AND ($2='' OR (purchased_at,purchase_id::text)<($2::timestamptz,$3)) ORDER BY purchased_at DESC,purchase_id DESC LIMIT $4`, tenant, afterAt, afterID, limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	page := Page{Items: make([]Purchase, 0, limit)}
	for rows.Next() {
		var p Purchase
		var id, tid, lid, sid string
		if err := rows.Scan(&id, &tid, &lid, &sid, &p.Status, &p.Subtotal, &p.TaxTotal, &p.Discount, &p.Total, &p.PurchaseNumber); err != nil {
			return Page{}, err
		}
		p.ID, p.TenantID, p.LocationID, p.SupplierID = id, tid, lid, sid
		p.Lines = make([]Line, 0)
		lineRows, lineErr := s.pool.Query(ctx, `SELECT variant_id,quantity::bigint,unit_cost::bigint FROM public.purchase_lines WHERE tenant_id=$1 AND purchase_id=$2 ORDER BY line_number`, tenant, id)
		if lineErr != nil {
			return Page{}, lineErr
		}
		for lineRows.Next() {
			var line Line
			if lineErr = lineRows.Scan(&line.VariantID, &line.Quantity, &line.UnitCost); lineErr != nil {
				lineRows.Close()
				return Page{}, lineErr
			}
			p.Lines = append(p.Lines, line)
		}
		lineErr = lineRows.Err()
		lineRows.Close()
		if lineErr != nil {
			return Page{}, lineErr
		}
		page.Items = append(page.Items, p)
	}
	if len(page.Items) > limit {
		page.HasMore = true
		page.Items = page.Items[:limit]
	}
	return page, rows.Err()
}
func (s *PGStore) Get(ctx context.Context, tenant, id string) (Detail, error) {
	var d Detail
	p := &d.Purchase
	err := s.pool.QueryRow(ctx, `SELECT pu.purchase_id,pu.tenant_id,pu.location_id,pu.supplier_id,pu.status,pu.subtotal,pu.tax_total,pu.discount_total,pu.total,pu.purchase_number,pu.purchased_at,COALESCE(l.name,''),COALESCE(tp.legal_name,'') FROM public.purchases pu LEFT JOIN public.locations l ON l.tenant_id=pu.tenant_id AND l.location_id=pu.location_id LEFT JOIN public.third_parties tp ON tp.tenant_id=pu.tenant_id AND tp.third_party_id=pu.supplier_id WHERE pu.tenant_id=$1 AND pu.purchase_id=$2`, tenant, id).Scan(&p.ID, &p.TenantID, &p.LocationID, &p.SupplierID, &p.Status, &p.Subtotal, &p.TaxTotal, &p.Discount, &p.Total, &p.PurchaseNumber, &p.CreatedAt, &p.LocationName, &p.SupplierName)
	if err != nil {
		return d, err
	}
	d.Lines = []Line{}
	rows, err := s.pool.Query(ctx, `SELECT pl.variant_id,p.name,v.name,v.sku,pl.quantity::bigint,pl.unit_cost::bigint,pl.line_total::bigint FROM public.purchase_lines pl JOIN public.product_variants v ON v.variant_id=pl.variant_id JOIN public.products p ON p.product_id=v.product_id WHERE pl.tenant_id=$1 AND pl.purchase_id=$2 ORDER BY pl.line_number`, tenant, id)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.VariantID, &l.ProductName, &l.VariantName, &l.SKU, &l.Quantity, &l.UnitCost, &l.LineTotal); err != nil {
			return d, err
		}
		d.Lines = append(d.Lines, l)
	}
	return d, rows.Err()
}
func (s *PGStore) Cancel(ctx context.Context, tenant, id string) error {
	// Received purchases already affected inventory; cancellation requires a
	// dedicated reversal/return workflow, so do not silently change status.
	r, err := s.pool.Exec(ctx, `UPDATE public.purchases SET status='cancelled' WHERE tenant_id=$1 AND purchase_id=$2 AND status IN ('draft','ordered')`, tenant, id)
	if err != nil {
		return err
	}
	if r.RowsAffected() != 1 {
		return fmt.Errorf("purchases: purchase not found or already closed")
	}
	return nil
}
