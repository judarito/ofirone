package customers

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }
func (s *PGStore) Create(ctx context.Context, c Customer) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("customers: nil postgres pool")
	}
	if err := c.Validate(); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO public.third_parties(third_party_id,tenant_id,legal_name,document_type,document_number,email,phone,is_customer,is_active) VALUES($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),true,$8)`, c.ThirdPartyID, c.TenantID, c.LegalName, c.DocumentType, c.DocumentNumber, c.Email, c.Phone, c.Active)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO public.customers(customer_id,tenant_id,third_party_id,credit_enabled,credit_limit,notes) VALUES($1,$2,$3,$4,$5,NULL)`, c.ID, c.TenantID, c.ThirdPartyID, c.CreditEnabled, c.CreditLimit)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *PGStore) List(ctx context.Context, tenant string, limit int, afterAt, afterID string) (Page, error) {
	if s == nil || s.pool == nil {
		return Page{}, fmt.Errorf("customers: nil postgres pool")
	}
	if tenant == "" || limit < 1 || limit > 100 {
		return Page{}, fmt.Errorf("customers: invalid list request")
	}
	rows, err := s.pool.Query(ctx, `SELECT c.customer_id,c.tenant_id,c.third_party_id,tp.legal_name,coalesce(tp.document_type,''),coalesce(tp.document_number,''),coalesce(tp.email,''),coalesce(tp.phone,''),c.credit_enabled,c.credit_limit::bigint,c.created_at::text,c.customer_id::text FROM public.customers c JOIN public.third_parties tp ON tp.tenant_id=c.tenant_id AND tp.third_party_id=c.third_party_id WHERE c.tenant_id=$1 AND ($2='' OR (c.created_at,c.customer_id::text)<($2::timestamptz,$3)) ORDER BY c.created_at DESC,c.customer_id DESC LIMIT $4`, tenant, afterAt, afterID, limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	items := make([]Customer, 0, limit+1)
	ats := make([]string, 0, limit+1)
	ids := make([]string, 0, limit+1)
	for rows.Next() {
		var c Customer
		var at, id string
		if err := rows.Scan(&c.ID, &c.TenantID, &c.ThirdPartyID, &c.LegalName, &c.DocumentType, &c.DocumentNumber, &c.Email, &c.Phone, &c.CreditEnabled, &c.CreditLimit, &at, &id); err != nil {
			return Page{}, err
		}
		items = append(items, c)
		ats = append(ats, at)
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	p := Page{Items: items}
	if len(items) > limit {
		p.HasMore = true
		p.Items = items[:limit]
		p.NextCreatedAt = ats[limit-1]
		p.NextID = ids[limit-1]
	}
	return p, nil
}

func (s *PGStore) Update(ctx context.Context, tenant string, c Customer) error {
	if err := c.Validate(); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE public.third_parties SET legal_name=$1,document_type=NULLIF($2,''),document_number=NULLIF($3,''),email=NULLIF($4,''),phone=NULLIF($5,''),is_active=$6 WHERE tenant_id=$7 AND third_party_id=$8`, c.LegalName, c.DocumentType, c.DocumentNumber, c.Email, c.Phone, c.Active, tenant, c.ThirdPartyID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE public.customers SET credit_enabled=$1,credit_limit=$2 WHERE tenant_id=$3 AND customer_id=$4`, c.CreditEnabled, c.CreditLimit, tenant, c.ID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *PGStore) Delete(ctx context.Context, tenant, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE public.third_parties tp SET is_active=false FROM public.customers c WHERE c.tenant_id=$1 AND c.customer_id=$2 AND tp.tenant_id=c.tenant_id AND tp.third_party_id=c.third_party_id`, tenant, id)
	return err
}
