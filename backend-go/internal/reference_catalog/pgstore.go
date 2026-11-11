package reference_catalog

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool} }
func schema(k Kind) (string, string, string, error) {
	switch k {
	case Units:
		return "units_of_measure", "unit_id", "decimal_places, NULL::uuid", nil
	case Categories:
		return "categories", "category_id", "0, parent_category_id", nil
	}
	return "", "", "", ErrInvalid
}
func dbError(e error) error {
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var p *pgconn.PgError
	if errors.As(e, &p) {
		switch p.Code {
		case "23505":
			return ErrConflict
		case "23503":
			return ErrParent
		case "23514", "22P02":
			return ErrInvalid
		}
	}
	return e
}
func (s *PGStore) begin(ctx context.Context, t string) (pgx.Tx, error) {
	if !ValidID(t) {
		return nil, ErrInvalid
	}
	if s == nil || s.pool == nil {
		return nil, errors.New("reference catalog database unavailable")
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	if _, e = tx.Exec(ctx, `SELECT set_config('app.tenant_id',$1,true)`, t); e != nil {
		_ = tx.Rollback(ctx)
		return nil, e
	}
	return tx, nil
}
func scan(row pgx.Row) (Item, error) {
	var v Item
	e := row.Scan(&v.ID, &v.TenantID, &v.Code, &v.Name, &v.Active, &v.DecimalPlaces, &v.ParentID)
	return v, dbError(e)
}
func (s *PGStore) Get(ctx context.Context, k Kind, t, id string) (Item, error) {
	table, key, extra, e := schema(k)
	if e != nil || !ValidID(id) {
		return Item{}, ErrInvalid
	}
	tx, e := s.begin(ctx, t)
	if e != nil {
		return Item{}, e
	}
	defer tx.Rollback(ctx)
	v, e := scan(tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s,tenant_id,code,name,is_active,%s FROM public.%s WHERE tenant_id=$1 AND %s=$2`, key, extra, table, key), t, id))
	return v, e
}
func (s *PGStore) List(ctx context.Context, k Kind, t string, q Query) (Page, error) {
	table, key, extra, e := schema(k)
	if e != nil {
		return Page{}, e
	}
	if e = ValidateQuery(q); e != nil {
		return Page{}, e
	}
	tx, e := s.begin(ctx, t)
	if e != nil {
		return Page{}, e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, fmt.Sprintf(`SELECT %s,tenant_id,code,name,is_active,%s FROM public.%s WHERE tenant_id=$1 AND ($2='' OR (name,%s)>($2,NULLIF($3,'')::uuid)) ORDER BY name,%s LIMIT $4`, key, extra, table, key, key), t, q.AfterName, q.AfterID, q.Limit+1)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	p := Page{Items: []Item{}}
	for rows.Next() {
		v, e := scan(rows)
		if e != nil {
			return Page{}, e
		}
		p.Items = append(p.Items, v)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(p.Items) > q.Limit {
		p.HasMore = true
		p.Items = p.Items[:q.Limit]
		last := p.Items[q.Limit-1]
		p.NextName, p.NextID = last.Name, last.ID
	}
	return p, nil
}

// A tenant-scoped transaction lock serializes hierarchy changes, including
// deactivation, so concurrent reparenting cannot introduce a cycle.
func lock(ctx context.Context, tx pgx.Tx, t string) error {
	_, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "reference_catalog:"+t)
	return e
}
func (s *PGStore) Save(ctx context.Context, k Kind, v Item, create bool) (Item, error) {
	if e := Validate(k, v); e != nil {
		return Item{}, e
	}
	if !create && !ValidID(v.ID) {
		return Item{}, ErrInvalid
	}
	table, key, extra, e := schema(k)
	if e != nil {
		return Item{}, e
	}
	tx, e := s.begin(ctx, v.TenantID)
	if e != nil {
		return Item{}, e
	}
	defer tx.Rollback(ctx)
	if k == Categories {
		if e = lock(ctx, tx, v.TenantID); e != nil {
			return Item{}, e
		}
		if v.ParentID != nil {
			var valid bool
			e = tx.QueryRow(ctx, `WITH RECURSIVE ancestors AS (
    SELECT category_id,parent_category_id,is_active FROM public.categories WHERE tenant_id=$1 AND category_id=$2
    UNION SELECT c.category_id,c.parent_category_id,c.is_active FROM public.categories c JOIN ancestors a ON c.category_id=a.parent_category_id WHERE c.tenant_id=$1
   ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE category_id=$2 AND is_active) AND NOT EXISTS(SELECT 1 FROM ancestors WHERE category_id=NULLIF($3,'')::uuid)`, v.TenantID, *v.ParentID, v.ID).Scan(&valid)
			if e != nil {
				return Item{}, e
			}
			if !valid {
				return Item{}, ErrParent
			}
		}
	}
	field, value := "decimal_places", any(v.DecimalPlaces)
	if k == Categories {
		field, value = "parent_category_id", v.ParentID
	}
	var sql string
	if create {
		sql = fmt.Sprintf(`INSERT INTO public.%s (%s,tenant_id,code,name,is_active,%s) VALUES (COALESCE(NULLIF($1,'')::uuid,gen_random_uuid()),$2,$3,$4,$5,$6)`, table, key, field)
	} else {
		sql = fmt.Sprintf(`UPDATE public.%s SET code=$3,name=$4,is_active=$5,%s=$6 WHERE tenant_id=$2 AND %s=$1`, table, field, key)
	}
	// Inactivation through update follows the same child guard as DELETE.
	if k == Categories && !v.Active && v.ID != "" {
		if e = checkChildren(ctx, tx, v.TenantID, v.ID); e != nil {
			return Item{}, e
		}
	}
	result, e := scan(tx.QueryRow(ctx, sql+fmt.Sprintf(` RETURNING %s,tenant_id,code,name,is_active,%s`, key, extra), v.ID, v.TenantID, v.Code, v.Name, v.Active, value))
	if e != nil {
		return Item{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Item{}, dbError(e)
	}
	return result, nil
}
func checkChildren(ctx context.Context, tx pgx.Tx, t, id string) error {
	var exists bool
	e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.categories WHERE tenant_id=$1 AND parent_category_id=$2 AND is_active)`, t, id).Scan(&exists)
	if e != nil {
		return e
	}
	if exists {
		return ErrConflict
	}
	return nil
}
func (s *PGStore) Deactivate(ctx context.Context, k Kind, t, id string) error {
	table, key, _, e := schema(k)
	if e != nil || !ValidID(id) {
		return ErrInvalid
	}
	tx, e := s.begin(ctx, t)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if k == Categories {
		if e = lock(ctx, tx, t); e != nil {
			return e
		}
		if e = checkChildren(ctx, tx, t, id); e != nil {
			return e
		}
	}
	result, e := tx.Exec(ctx, fmt.Sprintf(`UPDATE public.%s SET is_active=false WHERE tenant_id=$1 AND %s=$2`, table, key), t, id)
	if e != nil {
		return dbError(e)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return dbError(tx.Commit(ctx))
}
