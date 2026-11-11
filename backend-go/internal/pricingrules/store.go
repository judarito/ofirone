package pricingrules

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("pricing rule not found")
var ErrInvalid = errors.New("invalid pricing rule")

type Rule struct {
	ID         string   `json:"pricing_rule_id"`
	TenantID   string   `json:"tenant_id,omitempty"`
	Scope      string   `json:"scope"`
	LocationID *string  `json:"location_id"`
	CategoryID *string  `json:"category_id"`
	ProductID  *string  `json:"product_id"`
	VariantID  *string  `json:"variant_id"`
	Method     string   `json:"pricing_method"`
	Markup     float64  `json:"markup_percentage"`
	Rounding   string   `json:"price_rounding"`
	RoundingTo float64  `json:"rounding_to"`
	Priority   int      `json:"priority"`
	Active     bool     `json:"is_active"`
	CreatedAt  string   `json:"created_at,omitempty"`
	UpdatedAt  string   `json:"updated_at,omitempty"`
	Location   *Named   `json:"location,omitempty"`
	Category   *Named   `json:"category,omitempty"`
	Product    *Named   `json:"product,omitempty"`
	Variant    *Variant `json:"variant,omitempty"`
}
type Named struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Variant struct {
	ID   string `json:"variant_id"`
	SKU  string `json:"sku"`
	Name string `json:"variant_name"`
}
type Page struct {
	Items []Rule `json:"items"`
	Total int    `json:"total"`
}
type Store interface {
	List(context.Context, string, int, int, string, *bool) (Page, error)
	Create(context.Context, string, Rule) (Rule, error)
	Update(context.Context, string, string, Rule) (Rule, error)
	Delete(context.Context, string, string) error
}
type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

const selectRules = `SELECT r.pricing_rule_id::text,r.tenant_id::text,r.scope,r.location_id::text,r.category_id::text,r.product_id::text,r.variant_id::text,r.pricing_method,r.markup_percentage::float8,r.price_rounding,r.rounding_to::float8,r.priority,r.is_active,r.created_at::text,r.updated_at::text,
 CASE WHEN l.location_id IS NULL THEN NULL ELSE jsonb_build_object('id',l.location_id::text,'name',l.name) END,
 CASE WHEN c.category_id IS NULL THEN NULL ELSE jsonb_build_object('id',c.category_id::text,'name',c.name) END,
 CASE WHEN p.product_id IS NULL THEN NULL ELSE jsonb_build_object('id',p.product_id::text,'name',p.name) END,
 CASE WHEN v.variant_id IS NULL THEN NULL ELSE jsonb_build_object('variant_id',v.variant_id::text,'sku',v.sku,'variant_name',v.name) END
 FROM public.pricing_rules r
 LEFT JOIN public.locations l ON l.tenant_id=r.tenant_id AND l.location_id=r.location_id
 LEFT JOIN public.categories c ON c.tenant_id=r.tenant_id AND c.category_id=r.category_id
 LEFT JOIN public.products p ON p.tenant_id=r.tenant_id AND p.product_id=r.product_id
 LEFT JOIN public.product_variants v ON v.tenant_id=r.tenant_id AND v.variant_id=r.variant_id`

func (s *PGStore) tx(ctx context.Context, tenant string, fn func(pgx.Tx) error) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT set_config('app.tenant_id',$1,true)", tenant); e != nil {
		return e
	}
	if e = fn(tx); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func scan(row pgx.Row) (v Rule, e error) {
	e = row.Scan(&v.ID, &v.TenantID, &v.Scope, &v.LocationID, &v.CategoryID, &v.ProductID, &v.VariantID, &v.Method, &v.Markup, &v.Rounding, &v.RoundingTo, &v.Priority, &v.Active, &v.CreatedAt, &v.UpdatedAt, &v.Location, &v.Category, &v.Product, &v.Variant)
	return
}
func (s *PGStore) List(ctx context.Context, t string, page, size int, scope string, active *bool) (out Page, e error) {
	if page < 1 || size < 1 || size > 100 {
		return out, ErrInvalid
	}
	out.Items = []Rule{}
	e = s.tx(ctx, t, func(tx pgx.Tx) error {
		where := ` WHERE r.tenant_id=$1::uuid AND ($2='' OR r.scope=$2) AND ($3::boolean IS NULL OR r.is_active=$3)`
		if er := tx.QueryRow(ctx, `SELECT count(*) FROM public.pricing_rules r`+where, t, scope, active).Scan(&out.Total); er != nil {
			return er
		}
		rows, er := tx.Query(ctx, selectRules+where+` ORDER BY r.priority DESC,r.created_at DESC LIMIT $4 OFFSET $5`, t, scope, active, size, (page-1)*size)
		if er != nil {
			return er
		}
		defer rows.Close()
		for rows.Next() {
			v, er := scan(rows)
			if er != nil {
				return er
			}
			out.Items = append(out.Items, v)
		}
		return rows.Err()
	})
	return
}
func validate(v Rule) error {
	if v.Method != "MARKUP" && v.Method != "FIXED" {
		return ErrInvalid
	}
	if v.Markup < 0 || v.Markup > 100000 || v.RoundingTo <= 0 {
		return ErrInvalid
	}
	if v.Rounding != "NONE" && v.Rounding != "UP" && v.Rounding != "DOWN" && v.Rounding != "NEAREST" {
		return ErrInvalid
	}
	count := 0
	for _, id := range []*string{v.LocationID, v.CategoryID, v.ProductID, v.VariantID} {
		if id != nil && strings.TrimSpace(*id) != "" {
			count++
		}
	}
	want := map[string]int{"TENANT": 0, "LOCATION": 1, "CATEGORY": 1, "PRODUCT": 1, "VARIANT": 1}[v.Scope]
	if _, ok := map[string]bool{"TENANT": true, "LOCATION": true, "CATEGORY": true, "PRODUCT": true, "VARIANT": true}[v.Scope]; !ok || count != want {
		return ErrInvalid
	}
	if (v.Scope == "LOCATION") != (v.LocationID != nil) || (v.Scope == "CATEGORY") != (v.CategoryID != nil) || (v.Scope == "PRODUCT") != (v.ProductID != nil) || (v.Scope == "VARIANT") != (v.VariantID != nil) {
		return ErrInvalid
	}
	return nil
}
func (s *PGStore) Create(ctx context.Context, t string, v Rule) (Rule, error) {
	if e := validate(v); e != nil {
		return Rule{}, e
	}
	var out Rule
	e := s.tx(ctx, t, func(tx pgx.Tx) error {
		q := `INSERT INTO public.pricing_rules(tenant_id,scope,location_id,category_id,product_id,variant_id,pricing_method,markup_percentage,price_rounding,rounding_to,priority,is_active) VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12) RETURNING pricing_rule_id::text`
		if e := tx.QueryRow(ctx, q, t, v.Scope, v.LocationID, v.CategoryID, v.ProductID, v.VariantID, v.Method, v.Markup, v.Rounding, v.RoundingTo, v.Priority, v.Active).Scan(&out.ID); e != nil {
			return e
		}
		return nil
	})
	if e != nil {
		return Rule{}, e
	}
	return s.get(ctx, t, out.ID)
}
func (s *PGStore) get(ctx context.Context, t, id string) (out Rule, e error) {
	e = s.tx(ctx, t, func(tx pgx.Tx) error {
		var er error
		out, er = scan(tx.QueryRow(ctx, selectRules+` WHERE r.tenant_id=$1::uuid AND r.pricing_rule_id=$2::uuid`, t, id))
		return er
	})
	return
}
func (s *PGStore) Update(ctx context.Context, t, id string, v Rule) (Rule, error) {
	if e := validate(v); e != nil {
		return Rule{}, e
	}
	e := s.tx(ctx, t, func(tx pgx.Tx) error {
		tag, er := tx.Exec(ctx, `UPDATE public.pricing_rules SET scope=$3,location_id=$4::uuid,category_id=$5::uuid,product_id=$6::uuid,variant_id=$7::uuid,pricing_method=$8,markup_percentage=$9,price_rounding=$10,rounding_to=$11,priority=$12,is_active=$13 WHERE tenant_id=$1::uuid AND pricing_rule_id=$2::uuid`, t, id, v.Scope, v.LocationID, v.CategoryID, v.ProductID, v.VariantID, v.Method, v.Markup, v.Rounding, v.RoundingTo, v.Priority, v.Active)
		if er != nil {
			return er
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
	if e != nil {
		return Rule{}, e
	}
	return s.get(ctx, t, id)
}
func (s *PGStore) Delete(ctx context.Context, t, id string) error {
	return s.tx(ctx, t, func(tx pgx.Tx) error {
		tag, e := tx.Exec(ctx, `DELETE FROM public.pricing_rules WHERE tenant_id=$1::uuid AND pricing_rule_id=$2::uuid`, t, id)
		if e == nil && tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return e
	})
}

var _ Store = (*PGStore)(nil)
