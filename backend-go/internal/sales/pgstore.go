package sales

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) Create(ctx context.Context, sale Sale) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("sales: nil postgres pool")
	}
	if sale.ID == "" {
		id, err := uuid()
		if err != nil {
			return err
		}
		sale.ID = id
	}
	if err := sale.Recalculate(); err != nil {
		return err
	}
	if err := sale.ValidatePayments(); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if sale.SaleNumber <= 0 {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, sale.TenantID+":"+sale.LocationID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(sale_number), 0) + 1 FROM public.sales WHERE tenant_id=$1 AND location_id=$2`, sale.TenantID, sale.LocationID).Scan(&sale.SaleNumber); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO public.sales
		(sale_id, tenant_id, location_id, created_by_identity_id, customer_id, cash_session_id, sale_number, idempotency_key,
		 status, subtotal, tax_total, discount_total, total)
		VALUES ($1,$2,$3,NULLIF($4,'')::uuid,NULLIF($5,'')::uuid,NULLIF($6,'')::uuid,$7,NULLIF($8,''),$9,$10,$11,$12,$13)`,
		sale.ID, sale.TenantID, sale.LocationID, sale.CreatedByIdentityID, sale.CustomerID, sale.CashSessionID, sale.SaleNumber,
		sale.IdempotencyKey, sale.Status, sale.Subtotal, sale.Tax, sale.Discount, sale.Total)
	if err != nil {
		return err
	}
	for i, line := range sale.Lines {
		lineTotal, _ := line.Total()
		lineID, err := uuid()
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO public.sale_lines
            (sale_line_id, tenant_id, sale_id, variant_id, line_number, quantity,
             unit_price, discount_total, tax_total, line_total)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, lineID, sale.TenantID, sale.ID,
			line.VariantID, i+1, line.Quantity, line.UnitPrice, line.Discount, line.Tax, lineTotal)
		if err != nil {
			return err
		}
		if line.BatchID != "" {
			result, stockErr := tx.Exec(ctx, `UPDATE public.inventory_batches SET quantity_on_hand=quantity_on_hand-$1 WHERE tenant_id=$2 AND batch_id=$3 AND location_id=$4 AND variant_id=$5 AND quantity_on_hand-quantity_reserved >= $1`, line.Quantity, sale.TenantID, line.BatchID, sale.LocationID, line.VariantID)
			if stockErr != nil {
				return stockErr
			}
			if result.RowsAffected() != 1 {
				return fmt.Errorf("sales: insufficient stock or batch mismatch")
			}
			movementID, idErr := uuid()
			if idErr != nil {
				return idErr
			}
			if _, stockErr = tx.Exec(ctx, `INSERT INTO public.inventory_moves(movement_id,tenant_id,location_id,variant_id,batch_id,quantity_delta,movement_type,source_type,source_id) VALUES($1,$2,$3,$4,$5,$6,'sale_out','sale',$7)`, movementID, sale.TenantID, sale.LocationID, line.VariantID, line.BatchID, -line.Quantity, sale.ID); stockErr != nil {
				return stockErr
			}
		}
	}
	for _, payment := range sale.Payments {
		methodID := payment.MethodID
		if methodID == "" && payment.MethodCode != "" {
			if err := tx.QueryRow(ctx, `SELECT payment_method_id FROM public.payment_methods WHERE tenant_id=$1 AND code=$2 AND is_active=true`, sale.TenantID, payment.MethodCode).Scan(&methodID); err != nil {
				return err
			}
		}
		paymentID, err := uuid()
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO public.sale_payments
            (payment_id, tenant_id, sale_id, payment_method_id, amount, reference)
			VALUES ($1,$2,$3,$4,$5,$6)`, paymentID, sale.TenantID, sale.ID, methodID, payment.Amount, payment.Reference)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *PGStore) List(ctx context.Context, tenantID string, limit int, afterSoldAt, afterID string) (Page, error) {
	if s == nil || s.pool == nil {
		return Page{}, fmt.Errorf("sales: nil postgres pool")
	}
	if tenantID == "" || limit < 1 || limit > 100 {
		return Page{}, fmt.Errorf("sales: invalid list request")
	}
	rows, err := s.pool.Query(ctx, `SELECT s.sale_id, s.tenant_id, s.location_id, s.sale_number, s.status, s.total::bigint, s.sold_at::text FROM public.sales AS s WHERE s.tenant_id=$1 AND ($2='' OR (s.sold_at, s.sale_id::text) < ($2::timestamptz, $3)) ORDER BY s.sold_at DESC, s.sale_id DESC LIMIT $4`, tenantID, afterSoldAt, afterID, limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	items := make([]Summary, 0, limit+1)
	times, ids := make([]string, 0, limit+1), make([]string, 0, limit+1)
	for rows.Next() {
		var item Summary
		var rowID string
		if err := rows.Scan(&item.ID, &item.TenantID, &item.LocationID, &item.SaleNumber, &item.Status, &item.Total, &item.SoldAt, &rowID); err != nil {
			return Page{}, err
		}
		items = append(items, item)
		times = append(times, item.SoldAt)
		ids = append(ids, rowID)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	p := Page{Items: items}
	if len(items) > limit {
		p.HasMore = true
		p.Items = items[:limit]
		p.NextSoldAt, p.NextID = times[limit-1], ids[limit-1]
	}
	return p, nil
}
func (s *PGStore) Get(ctx context.Context, tenantID, saleID string) (Detail, error) {
	var d Detail
	err := s.pool.QueryRow(ctx, `SELECT sale_id,tenant_id,location_id,sale_number,status,total::bigint,sold_at::text FROM public.sales WHERE tenant_id=$1 AND sale_id=$2`, tenantID, saleID).Scan(&d.Sale.ID, &d.Sale.TenantID, &d.Sale.LocationID, &d.Sale.SaleNumber, &d.Sale.Status, &d.Sale.Total, &d.Sale.SoldAt)
	if err != nil {
		return d, err
	}
	d.Lines = []Line{}
	rows, err := s.pool.Query(ctx, `SELECT variant_id,quantity::bigint,unit_price::bigint,discount_total::bigint,tax_total::bigint FROM public.sale_lines WHERE tenant_id=$1 AND sale_id=$2 ORDER BY line_number`, tenantID, saleID)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.VariantID, &l.Quantity, &l.UnitPrice, &l.Discount, &l.Tax); err != nil {
			return d, err
		}
		d.Lines = append(d.Lines, l)
	}
	d.Payments = []Payment{}
	rows2, err := s.pool.Query(ctx, `SELECT payment_method_id,amount::bigint,COALESCE(reference,'') FROM public.sale_payments WHERE tenant_id=$1 AND sale_id=$2 ORDER BY paid_at,payment_id`, tenantID, saleID)
	if err != nil {
		return d, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var p Payment
		if err := rows2.Scan(&p.MethodID, &p.Amount, &p.Reference); err != nil {
			return d, err
		}
		d.Payments = append(d.Payments, p)
	}
	return d, rows2.Err()
}
func (s *PGStore) SetStatus(ctx context.Context, tenantID, saleID string, status Status) error {
	if status != Voided {
		return fmt.Errorf("sales: unsupported status transition")
	}
	r, err := s.pool.Exec(ctx, `UPDATE public.sales SET status='voided' WHERE tenant_id=$1 AND sale_id=$2 AND status IN ('draft','completed')`, tenantID, saleID)
	if err != nil {
		return err
	}
	if r.RowsAffected() != 1 {
		return fmt.Errorf("sales: sale not found or already closed")
	}
	return nil
}

func uuid() (string, error) {
	b := make([]byte, 16)
	if _, err := cryptorand.Read(b); err != nil {
		return "", fmt.Errorf("sales: generate id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:], nil
}
