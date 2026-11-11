package suppliers

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ p *pgxpool.Pool }

func NewPGStore(p *pgxpool.Pool) *PGStore { return &PGStore{p} }
func (s *PGStore) Create(c context.Context, v Supplier) error {
	_, e := s.p.Exec(c, `INSERT INTO third_parties(third_party_id,tenant_id,legal_name,document_type,document_number,email,phone,is_supplier,is_active) VALUES($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),true,$8)`, v.ID, v.TenantID, v.Name, v.DocumentType, v.DocumentNumber, v.Email, v.Phone, v.Active)
	return e
}
func (s *PGStore) List(c context.Context, t string, n int, a string) (Page, error) {
	rows, e := s.p.Query(c, `SELECT third_party_id,tenant_id,legal_name,coalesce(document_type,''),coalesce(document_number,''),coalesce(email,''),coalesce(phone,''),is_active FROM third_parties WHERE tenant_id=$1 AND is_supplier AND ($2='' OR third_party_id::text<$2) ORDER BY third_party_id DESC LIMIT $3`, t, a, n+1)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	p := Page{Items: []Supplier{}}
	for rows.Next() {
		var v Supplier
		if e = rows.Scan(&v.ID, &v.TenantID, &v.Name, &v.DocumentType, &v.DocumentNumber, &v.Email, &v.Phone, &v.Active); e != nil {
			return p, e
		}
		p.Items = append(p.Items, v)
	}
	if len(p.Items) > n {
		p.HasMore = true
		p.Items = p.Items[:n]
		p.NextID = p.Items[n-1].ID
	}
	return p, rows.Err()
}

var _ = fmt.Sprintf
