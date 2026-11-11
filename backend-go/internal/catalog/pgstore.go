package catalog

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const createProductSQL = `INSERT INTO public.products
    (product_id, tenant_id, code, name, product_type, is_active)
VALUES ($1, $2, $3, $4, $5, $6)`

const listProductsSQL = `SELECT product_id, tenant_id, code, name, product_type, is_active
FROM public.products
WHERE tenant_id = $1
  AND ($2 = '' OR (name, product_id::text) > ($2, $3))
ORDER BY name ASC, product_id ASC
LIMIT $4`

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) CreateProduct(ctx context.Context, product Product) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("catalog: nil postgres pool")
	}
	if err := product.Validate(); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, createProductSQL, product.ID, product.TenantID, product.Code, product.Name, product.ProductType, product.Active)
	return err
}

func (s *PGStore) CreateVariant(ctx context.Context, variant Variant) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("catalog: nil postgres pool")
	}
	if err := variant.Validate(); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO public.product_variants
        (variant_id, tenant_id, product_id, sku, name, cost, sale_price, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, variant.ID, variant.TenantID, variant.ProductID, variant.SKU, variant.Name, variant.Cost, variant.SalePrice, variant.Active)
	return err
}
func (s *PGStore) UpdateProduct(ctx context.Context, p Product) error {
	_, e := s.pool.Exec(ctx, `UPDATE public.products SET code=$1,name=$2,product_type=$3,is_active=$4 WHERE tenant_id=$5 AND product_id=$6`, p.Code, p.Name, p.ProductType, p.Active, p.TenantID, p.ID)
	return e
}
func (s *PGStore) DeleteProduct(ctx context.Context, t, id string) error {
	_, e := s.pool.Exec(ctx, `UPDATE public.products SET is_active=false WHERE tenant_id=$1 AND product_id=$2`, t, id)
	return e
}
func (s *PGStore) UpdateVariant(ctx context.Context, v Variant) error {
	_, e := s.pool.Exec(ctx, `UPDATE public.product_variants SET sku=$1,name=$2,cost=$3,sale_price=$4,is_active=$5 WHERE tenant_id=$6 AND variant_id=$7`, v.SKU, v.Name, v.Cost, v.SalePrice, v.Active, v.TenantID, v.ID)
	return e
}
func (s *PGStore) DeleteVariant(ctx context.Context, t, id string) error {
	_, e := s.pool.Exec(ctx, `UPDATE public.product_variants SET is_active=false WHERE tenant_id=$1 AND variant_id=$2`, t, id)
	return e
}

func (s *PGStore) ListVariants(ctx context.Context, tenantID string, limit int, afterName, afterID string) (VariantPage, error) {
	if s == nil || s.pool == nil {
		return VariantPage{}, fmt.Errorf("catalog: nil postgres pool")
	}
	if tenantID == "" || limit < 1 || limit > 100 {
		return VariantPage{}, fmt.Errorf("catalog: invalid list request")
	}
	rows, err := s.pool.Query(ctx, `SELECT variant_id, tenant_id, product_id, sku, name, cost::bigint, sale_price::bigint, is_active FROM public.product_variants WHERE tenant_id=$1 AND ($2='' OR (name,variant_id::text)>($2,$3)) ORDER BY name ASC, variant_id ASC LIMIT $4`, tenantID, afterName, afterID, limit+1)
	if err != nil {
		return VariantPage{}, err
	}
	defer rows.Close()
	items := make([]Variant, 0, limit+1)
	for rows.Next() {
		var v Variant
		if err := rows.Scan(&v.ID, &v.TenantID, &v.ProductID, &v.SKU, &v.Name, &v.Cost, &v.SalePrice, &v.Active); err != nil {
			return VariantPage{}, err
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return VariantPage{}, err
	}
	p := VariantPage{Items: items}
	if len(items) > limit {
		p.HasMore = true
		p.Items = items[:limit]
		last := p.Items[len(p.Items)-1]
		p.NextName, p.NextID = last.Name, last.ID
	}
	return p, nil
}
func (s *PGStore) SearchVariants(ctx context.Context, t, term string, n int) (VariantPage, error) {
	return s.SearchVariantsAtLocation(ctx, t, term, "", n)
}

func (s *PGStore) SearchVariantsAtLocation(ctx context.Context, t, term, locationID string, n int) (VariantPage, error) {
	// A product without explicit variants is still sellable as a unique item.
	// Provision its default variant before searching so POS can return a real
	// FK-backed variant instead of a non-persisted placeholder.
	if _, e := s.pool.Exec(ctx, `
		INSERT INTO public.product_variants
			(variant_id, tenant_id, product_id, sku, name, cost, sale_price, is_active)
		SELECT gen_random_uuid(), p.tenant_id, p.product_id, p.code, 'Predeterminado', 0, 0, p.is_active
		FROM public.products p
		WHERE p.tenant_id=$1
		  AND p.is_active
		  AND (p.name ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%')
		  AND NOT EXISTS (
			SELECT 1 FROM public.product_variants v
			WHERE v.tenant_id=p.tenant_id AND v.product_id=p.product_id
		  )`, t, term); e != nil {
		return VariantPage{}, e
	}
	rows, e := s.pool.Query(ctx, `SELECT v.variant_id,v.tenant_id,v.product_id,p.name,v.sku,v.name,
        COALESCE(cost.avg_cost,v.cost,0)::bigint,
        CASE
          WHEN COALESCE(policy.pricing_method,'MARKUP')='FIXED' THEN v.sale_price
          WHEN COALESCE(cost.avg_cost,v.cost,0)>0 THEN
            CASE COALESCE(policy.price_rounding,'NONE')
              WHEN 'UP' THEN ceil((COALESCE(cost.avg_cost,v.cost)*(1+COALESCE(policy.markup_percentage,20)/100.0))/COALESCE(NULLIF(policy.rounding_to,0),1))*COALESCE(NULLIF(policy.rounding_to,0),1)
              WHEN 'DOWN' THEN floor((COALESCE(cost.avg_cost,v.cost)*(1+COALESCE(policy.markup_percentage,20)/100.0))/COALESCE(NULLIF(policy.rounding_to,0),1))*COALESCE(NULLIF(policy.rounding_to,0),1)
              WHEN 'NEAREST' THEN round((COALESCE(cost.avg_cost,v.cost)*(1+COALESCE(policy.markup_percentage,20)/100.0))/COALESCE(NULLIF(policy.rounding_to,0),1))*COALESCE(NULLIF(policy.rounding_to,0),1)
              ELSE COALESCE(cost.avg_cost,v.cost)*(1+COALESCE(policy.markup_percentage,20)/100.0)
            END
          ELSE v.sale_price
        END::bigint,
        v.is_active,COALESCE(stock.on_hand,0)::bigint
      FROM public.product_variants v
      JOIN public.products p ON p.tenant_id=v.tenant_id AND p.product_id=v.product_id
      LEFT JOIN LATERAL (
        SELECT SUM(b.quantity_on_hand) AS on_hand
        FROM public.inventory_batches b
        WHERE b.tenant_id=v.tenant_id AND b.variant_id=v.variant_id AND b.is_active
          AND (NULLIF($3,'') IS NULL OR b.location_id=NULLIF($3,'')::uuid)
      ) stock ON true
      LEFT JOIN LATERAL (
        SELECT SUM(b.quantity_on_hand*b.unit_cost)/NULLIF(SUM(b.quantity_on_hand),0) AS avg_cost
        FROM public.inventory_batches b
        WHERE b.tenant_id=v.tenant_id AND b.variant_id=v.variant_id AND b.is_active AND b.quantity_on_hand>0
          AND (NULLIF($3,'') IS NULL OR b.location_id=NULLIF($3,'')::uuid)
      ) cost ON true
      LEFT JOIN LATERAL (
        SELECT pr.pricing_method,pr.markup_percentage,pr.price_rounding,pr.rounding_to
        FROM public.pricing_rules pr
        WHERE pr.tenant_id=v.tenant_id AND pr.is_active AND
          ((pr.scope='VARIANT' AND pr.variant_id=v.variant_id) OR
           (pr.scope='PRODUCT' AND pr.product_id=v.product_id) OR
           (pr.scope='CATEGORY' AND pr.category_id=p.category_id) OR
           (pr.scope='LOCATION' AND pr.location_id=NULLIF($3,'')::uuid) OR
           pr.scope='TENANT')
        ORDER BY CASE pr.scope WHEN 'VARIANT' THEN 5 WHEN 'PRODUCT' THEN 4 WHEN 'CATEGORY' THEN 3 WHEN 'LOCATION' THEN 2 ELSE 1 END DESC,
          pr.priority DESC,pr.created_at DESC,pr.pricing_rule_id
        LIMIT 1
      ) policy ON true
      WHERE v.tenant_id=$1 AND v.is_active
        AND (v.sku ILIKE '%'||$2||'%' OR v.name ILIKE '%'||$2||'%' OR p.name ILIKE '%'||$2||'%')
      ORDER BY p.name,v.name,v.variant_id LIMIT $4`, t, term, locationID, n)
	if e != nil {
		return VariantPage{}, e
	}
	defer rows.Close()
	p := VariantPage{Items: []Variant{}}
	for rows.Next() {
		var v Variant
		if e = rows.Scan(&v.ID, &v.TenantID, &v.ProductID, &v.ProductName, &v.SKU, &v.Name, &v.Cost, &v.SalePrice, &v.Active, &v.StockOnHand); e != nil {
			return p, e
		}
		p.Items = append(p.Items, v)
	}
	return p, rows.Err()
}

func (s *PGStore) ListProducts(ctx context.Context, tenantID string, limit int, afterName, afterID string) (ProductPage, error) {
	if s == nil || s.pool == nil {
		return ProductPage{}, fmt.Errorf("catalog: nil postgres pool")
	}
	if tenantID == "" || limit < 1 || limit > 100 {
		return ProductPage{}, fmt.Errorf("catalog: invalid list request")
	}
	rows, err := s.pool.Query(ctx, listProductsSQL, tenantID, afterName, afterID, limit+1)
	if err != nil {
		return ProductPage{}, err
	}
	defer rows.Close()
	items := make([]Product, 0, limit+1)
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.TenantID, &p.Code, &p.Name, &p.ProductType, &p.Active); err != nil {
			return ProductPage{}, err
		}
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return ProductPage{}, err
	}
	page := ProductPage{Items: items}
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		page.NextName, page.NextID = last.Name, last.ID
	}
	return page, nil
}
