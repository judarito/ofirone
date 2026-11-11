// Package reference_locations owns tenant locations and payment methods.
package reference_locations

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalid = errors.New("invalid reference data")
var ErrNotFound = errors.New("reference not found")
var ErrConflict = errors.New("reference code already exists")

type Record struct {
	ID         string  `json:"id"`
	TenantID   string  `json:"tenant_id"`
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	Address    *string `json:"address,omitempty"`
	MethodType string  `json:"method_type,omitempty"`
	SortOrder  int     `json:"sort_order"`
	IsActive   bool    `json:"is_active"`
}
type Page struct {
	Items   []Record `json:"items"`
	HasMore bool     `json:"has_more"`
	NextID  string   `json:"next_id,omitempty"`
}
type Store interface {
	List(context.Context, string, string, int, string) (Page, error)
	Get(context.Context, string, string, string) (Record, error)
	Create(context.Context, string, string, Record) (Record, error)
	Update(context.Context, string, string, string, Record) (Record, error)
	Delete(context.Context, string, string, string) error
}

func table(kind string) (string, string, error) {
	switch kind {
	case "locations":
		return "locations", "location_id", nil
	case "payment-methods":
		return "payment_methods", "payment_method_id", nil
	}
	return "", "", ErrInvalid
}
func Validate(kind string, r Record) error {
	if _, _, e := table(kind); e != nil {
		return e
	}
	if r.Code != strings.TrimSpace(r.Code) || utf8.RuneCountInString(r.Code) < 1 || utf8.RuneCountInString(r.Code) > 50 || len(strings.TrimSpace(r.Name)) == 0 || utf8.RuneCountInString(strings.TrimSpace(r.Name)) > 200 {
		return ErrInvalid
	}
	if kind == "payment-methods" {
		switch r.MethodType {
		case "cash", "card", "transfer", "credit", "other":
		default:
			return ErrInvalid
		}
	}
	return nil
}

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }
func (s *PGStore) transaction(ctx context.Context, tenant string, fn func(pgx.Tx) error) error {
	if strings.TrimSpace(tenant) == "" {
		return ErrInvalid
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenant); e != nil {
		return e
	}
	if e = fn(tx); e != nil {
		var pe *pgconn.PgError
		if errors.As(e, &pe) && pe.Code == "23505" {
			return ErrConflict
		}
		if errors.Is(e, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return e
	}
	return tx.Commit(ctx)
}
func fields(kind, id string) string {
	if kind == "locations" {
		return id + "::text, tenant_id::text, code, name, address, ''::text, 0, is_active"
	}
	return id + "::text, tenant_id::text, code, name, NULL::text, method_type, sort_order, is_active"
}
func scan(row pgx.Row) (r Record, e error) {
	e = row.Scan(&r.ID, &r.TenantID, &r.Code, &r.Name, &r.Address, &r.MethodType, &r.SortOrder, &r.IsActive)
	return
}
func (s *PGStore) List(ctx context.Context, tenant, kind string, limit int, after string) (p Page, e error) {
	t, id, e := table(kind)
	if e != nil {
		return p, e
	}
	if limit < 1 || limit > 100 {
		return p, ErrInvalid
	}
	p.Items = []Record{}
	e = s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		rows, e := tx.Query(ctx, fmt.Sprintf("SELECT %s FROM public.%s WHERE tenant_id=$1::uuid AND ($2='' OR %s > NULLIF($2,'')::uuid) ORDER BY %s LIMIT $3", fields(kind, id), t, id, id), tenant, after, limit+1)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			r, e := scan(rows)
			if e != nil {
				return e
			}
			p.Items = append(p.Items, r)
		}
		return rows.Err()
	})
	if len(p.Items) > limit {
		p.HasMore = true
		p.Items = p.Items[:limit]
		p.NextID = p.Items[limit-1].ID
	}
	return
}
func (s *PGStore) Get(ctx context.Context, tenant, kind, key string) (r Record, e error) {
	t, id, e := table(kind)
	if e != nil {
		return r, e
	}
	e = s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		var e error
		r, e = scan(tx.QueryRow(ctx, fmt.Sprintf("SELECT %s FROM public.%s WHERE tenant_id=$1::uuid AND %s=$2::uuid", fields(kind, id), t, id), tenant, key))
		return e
	})
	return
}
func (s *PGStore) Create(ctx context.Context, tenant, kind string, r Record) (out Record, e error) {
	if e = Validate(kind, r); e != nil {
		return
	}
	t, id, _ := table(kind)
	e = s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		var row pgx.Row
		if kind == "locations" {
			row = tx.QueryRow(ctx, fmt.Sprintf("INSERT INTO public.%s (tenant_id,code,name,address,is_active) VALUES ($1::uuid,$2,$3,$4,$5) RETURNING %s", t, fields(kind, id)), tenant, r.Code, r.Name, r.Address, r.IsActive)
		} else {
			row = tx.QueryRow(ctx, fmt.Sprintf("INSERT INTO public.%s (tenant_id,code,name,method_type,sort_order,is_active) VALUES ($1::uuid,$2,$3,$4,$5,$6) RETURNING %s", t, fields(kind, id)), tenant, r.Code, r.Name, r.MethodType, r.SortOrder, r.IsActive)
		}
		var err error
		out, err = scan(row)
		return err
	})
	return
}
func (s *PGStore) Update(ctx context.Context, tenant, kind, key string, r Record) (out Record, e error) {
	if e = Validate(kind, r); e != nil {
		return
	}
	t, id, _ := table(kind)
	e = s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		var row pgx.Row
		if kind == "locations" {
			row = tx.QueryRow(ctx, fmt.Sprintf("UPDATE public.%s SET code=$3,name=$4,address=$5,is_active=$6 WHERE tenant_id=$1::uuid AND %s=$2::uuid RETURNING %s", t, id, fields(kind, id)), tenant, key, r.Code, r.Name, r.Address, r.IsActive)
		} else {
			row = tx.QueryRow(ctx, fmt.Sprintf("UPDATE public.%s SET code=$3,name=$4,method_type=$5,sort_order=$6,is_active=$7 WHERE tenant_id=$1::uuid AND %s=$2::uuid RETURNING %s", t, id, fields(kind, id)), tenant, key, r.Code, r.Name, r.MethodType, r.SortOrder, r.IsActive)
		}
		var err error
		out, err = scan(row)
		return err
	})
	return
}
func (s *PGStore) Delete(ctx context.Context, tenant, kind, key string) error {
	t, id, e := table(kind)
	if e != nil {
		return e
	}
	return s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		tag, e := tx.Exec(ctx, fmt.Sprintf("UPDATE public.%s SET is_active=false WHERE tenant_id=$1::uuid AND %s=$2::uuid", t, id), tenant, key)
		if e == nil && tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return e
	})
}
