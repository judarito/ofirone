package reference_tax

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

// Identifiers are selected from constants only, never from request input.
func table(r Resource) (string, string, string, error) {
	switch r {
	case Taxes:
		return "public.taxes", "tax_id", `jsonb_build_object('id',tax_id,'code',code,'name',name,'rate',rate,'is_inclusive',is_inclusive,'is_active',is_active)`, nil
	case Currencies:
		return "public.reference_currencies", "id", `jsonb_build_object('id',id,'code',code,'name',name,'decimal_places',decimal_places,'is_active',is_active)`, nil
	case RegionalSettings:
		return "public.reference_regional_settings", "id", `jsonb_build_object('id',id,'code',code,'name',name,'currency_code',currency_code,'locale',locale,'timezone',timezone,'is_active',is_active)`, nil
	}
	return "", "", "", ErrInvalid
}

func dbError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var p *pgconn.PgError
	if errors.As(err, &p) {
		switch p.Code {
		case "23505", "23503":
			return ErrConflict
		case "23514", "22P02", "22003":
			return ErrInvalid
		}
	}
	return err
}

func (s *PGStore) transaction(ctx context.Context, tenant string, fn func(pgx.Tx) error) error {
	if !ValidID(tenant) {
		return ErrInvalid
	}
	if s == nil || s.pool == nil {
		return errors.New("reference store unavailable")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT set_config('app.tenant_id',$1,true)`, tenant); err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		return dbError(err)
	}
	return dbError(tx.Commit(ctx))
}

func read(row pgx.Row) (Record, error) {
	var raw []byte
	var v Record
	if err := row.Scan(&raw); err != nil {
		return v, err
	}
	err := json.Unmarshal(raw, &v)
	return v, err
}

func (s *PGStore) List(ctx context.Context, r Resource, tenant string, q Query) (Page, error) {
	var page Page
	tbl, id, fields, err := table(r)
	if err != nil {
		return page, err
	}
	if q.Limit < 1 || q.Limit > 100 || (q.Cursor.ID != "" && (!ValidID(q.Cursor.ID) || q.Cursor.Tenant != tenant || q.Cursor.Resource != r)) {
		return page, ErrInvalid
	}
	err = s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		var afterID any
		if q.Cursor.ID != "" {
			afterID = q.Cursor.ID
		}
		rows, e := tx.Query(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE tenant_id=$1 AND ($3::uuid IS NULL OR (code,%s)>($2,$3::uuid)) ORDER BY code,%s LIMIT $4`, fields, tbl, id, id), tenant, q.Cursor.Code, afterID, q.Limit+1)
		if e != nil {
			return e
		}
		defer rows.Close()
		items := []Record{}
		for rows.Next() {
			v, e := read(rows)
			if e != nil {
				return e
			}
			items = append(items, v)
		}
		if e = rows.Err(); e != nil {
			return e
		}
		page = NewPage(items, q, r, tenant)
		return nil
	})
	return page, err
}

// TaxInfoForVariant mirrors fn_get_tax_info_for_variant: the most-specific
// active rule wins, then priority; no match means no tax.
func (s *PGStore) TaxInfoForVariant(ctx context.Context, tenant, variant string) (TaxInfo, error) {
	var info TaxInfo
	if !ValidID(variant) {
		return info, ErrInvalid
	}
	err := s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			WITH target AS (
				SELECT pv.variant_id, pv.product_id, p.category_id
				FROM public.product_variants pv
				JOIN public.products p ON p.tenant_id = pv.tenant_id AND p.product_id = pv.product_id
				WHERE pv.tenant_id = $1 AND pv.variant_id = $2
			), applicable AS (
				SELECT t.rate, t.code, t.name,
					CASE tr.scope WHEN 'VARIANT' THEN 4 WHEN 'PRODUCT' THEN 3 WHEN 'CATEGORY' THEN 2 WHEN 'TENANT' THEN 1 ELSE 0 END AS scope_rank,
					tr.priority, tr.tax_rule_id
				FROM public.tax_rules tr
				JOIN public.taxes t ON t.tenant_id = tr.tenant_id AND t.tax_id = tr.tax_id
				JOIN target v ON true
				WHERE tr.tenant_id = $1 AND tr.is_active AND t.is_active
				AND ((tr.scope = 'VARIANT' AND tr.variant_id = v.variant_id)
				  OR (tr.scope = 'PRODUCT' AND tr.product_id = v.product_id)
				  OR (tr.scope = 'CATEGORY' AND tr.category_id = v.category_id)
				  OR tr.scope = 'TENANT')
			)
			SELECT COALESCE((SELECT rate FROM applicable ORDER BY scope_rank DESC, priority DESC, tax_rule_id LIMIT 1), 0),
			       (SELECT code FROM applicable ORDER BY scope_rank DESC, priority DESC, tax_rule_id LIMIT 1),
			       (SELECT name FROM applicable ORDER BY scope_rank DESC, priority DESC, tax_rule_id LIMIT 1)
		`, tenant, variant).Scan(&info.Rate, &info.Code, &info.Name)
	})
	return info, err
}

func (s *PGStore) Get(ctx context.Context, r Resource, tenant, id string) (Record, error) {
	var v Record
	tbl, key, fields, err := table(r)
	if err != nil || !ValidID(id) {
		return v, ErrInvalid
	}
	err = s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		var e error
		v, e = read(tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE tenant_id=$1 AND %s=$2`, fields, tbl, key), tenant, id))
		return e
	})
	return v, err
}

func (s *PGStore) Create(ctx context.Context, r Resource, tenant string, v Record) (Record, error) {
	return s.save(ctx, r, tenant, v, false)
}
func (s *PGStore) Update(ctx context.Context, r Resource, tenant string, v Record) (Record, error) {
	return s.save(ctx, r, tenant, v, true)
}

func (s *PGStore) save(ctx context.Context, r Resource, tenant string, v Record, update bool) (Record, error) {
	if err := v.Validate(r); err != nil {
		return Record{}, err
	}
	if update && !ValidID(v.ID) {
		return Record{}, ErrInvalid
	}
	tbl, key, fields, _ := table(r)
	var result Record
	err := s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		if update {
			if e := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s::text FROM %s WHERE tenant_id=$1 AND %s=$2 FOR UPDATE`, key, tbl, key), tenant, v.ID).Scan(new(string)); e != nil {
				return e
			}
		}
		if r == RegionalSettings && v.Active {
			var code string
			if e := tx.QueryRow(ctx, `SELECT code FROM public.reference_currencies WHERE tenant_id=$1 AND code=$2 AND is_active FOR SHARE`, tenant, v.CurrencyCode).Scan(&code); e != nil {
				if errors.Is(e, pgx.ErrNoRows) {
					return ErrConflict
				}
				return e
			}
		}
		if r == Currencies && update && !v.Active {
			var used bool
			if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.reference_regional_settings WHERE tenant_id=$1 AND currency_code=(SELECT code FROM public.reference_currencies WHERE tenant_id=$1 AND id=$2) AND is_active)`, tenant, v.ID).Scan(&used); e != nil {
				return e
			}
			if used {
				return ErrConflict
			}
		}
		raw, e := json.Marshal(v)
		if e != nil {
			return e
		}
		// jsonb_populate_record keeps numeric rates exact in PostgreSQL; only validated
		// resource fields are persisted, and tenant always comes from trusted context.
		columns := "code,name,is_active"
		values := "x.code,x.name,x.is_active"
		assignments := "code=x.code,name=x.name,is_active=x.is_active"
		switch r {
		case Taxes:
			columns += ",rate,is_inclusive"
			values += ",x.rate,COALESCE(x.is_inclusive,false)"
			assignments += ",rate=x.rate,is_inclusive=COALESCE(x.is_inclusive,false)"
		case Currencies:
			columns += ",decimal_places"
			values += ",x.decimal_places"
			assignments += ",decimal_places=x.decimal_places"
		case RegionalSettings:
			columns += ",currency_code,locale,timezone"
			values += ",x.currency_code,x.locale,x.timezone"
			assignments += ",currency_code=x.currency_code,locale=x.locale,timezone=x.timezone"
		}
		// The wire ID is 'id', while the existing tax table calls it tax_id.
		if !update {
			result, e = read(tx.QueryRow(ctx, fmt.Sprintf(`INSERT INTO %s (%s,tenant_id,%s) SELECT COALESCE(NULLIF($3,'')::uuid,gen_random_uuid()),$1,%s FROM jsonb_populate_record(NULL::%s,$2::jsonb) x RETURNING %s`, tbl, key, columns, values, tbl, fields), tenant, string(raw), v.ID))
		} else {
			// Qualify RETURNING fields through the updated row to avoid ambiguity with x.
			result, e = read(tx.QueryRow(ctx, fmt.Sprintf(`WITH changed AS (UPDATE %s AS target SET %s FROM jsonb_populate_record(NULL::%s,$2::jsonb) x WHERE target.tenant_id=$1 AND target.%s=$3 RETURNING target.*) SELECT %s FROM changed`, tbl, assignments, tbl, key, fields), tenant, string(raw), v.ID))
		}
		return e
	})
	return result, err
}

func (s *PGStore) Deactivate(ctx context.Context, r Resource, tenant, id string) error {
	tbl, key, _, err := table(r)
	if err != nil || !ValidID(id) {
		return ErrInvalid
	}
	return s.transaction(ctx, tenant, func(tx pgx.Tx) error {
		var code string
		if e := tx.QueryRow(ctx, fmt.Sprintf(`SELECT code FROM %s WHERE tenant_id=$1 AND %s=$2 FOR UPDATE`, tbl, key), tenant, id).Scan(&code); e != nil {
			return e
		}
		if r == Currencies {
			var used bool
			if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.reference_regional_settings WHERE tenant_id=$1 AND currency_code=$2 AND is_active)`, tenant, code).Scan(&used); e != nil {
				return e
			}
			if used {
				return ErrConflict
			}
		}
		_, e := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET is_active=false WHERE tenant_id=$1 AND %s=$2`, tbl, key), tenant, id)
		return e
	})
}
