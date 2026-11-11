package catalog

import (
	"context"
	"fmt"
)

type Service struct {
	store       Store
	variants    VariantStore
	variantList VariantListStore
}

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("catalog: store is required")
	}
	service := &Service{store: store}
	if variants, ok := store.(VariantStore); ok {
		service.variants = variants
	}
	if variants, ok := store.(VariantListStore); ok {
		service.variantList = variants
	}
	return service, nil
}

func (s *Service) CreateVariant(ctx context.Context, variant Variant) error {
	if s == nil || s.variants == nil {
		return fmt.Errorf("catalog: variant store is not configured")
	}
	if err := variant.Validate(); err != nil {
		return err
	}
	return s.variants.CreateVariant(ctx, variant)
}

func (s *Service) ListVariants(ctx context.Context, tenantID string, limit int, afterName, afterID string) (VariantPage, error) {
	if s == nil || s.variantList == nil {
		return VariantPage{}, fmt.Errorf("catalog: variant list store is not configured")
	}
	if (afterName == "") != (afterID == "") {
		return VariantPage{}, fmt.Errorf("catalog: cursor must contain name and id")
	}
	return s.variantList.ListVariants(ctx, tenantID, limit, afterName, afterID)
}
func (s *Service) SearchVariants(ctx context.Context, tenant, term string, limit int) (VariantPage, error) {
	x, ok := s.store.(VariantSearchStore)
	if !ok {
		return VariantPage{}, fmt.Errorf("catalog: search unavailable")
	}
	return x.SearchVariants(ctx, tenant, term, limit)
}
func (s *Service) SearchVariantsAtLocation(ctx context.Context, tenant, term, locationID string, limit int) (VariantPage, error) {
	x, ok := s.store.(VariantSearchAtLocationStore)
	if !ok {
		return s.SearchVariants(ctx, tenant, term, limit)
	}
	return x.SearchVariantsAtLocation(ctx, tenant, term, locationID, limit)
}

func (s *Service) CreateProduct(ctx context.Context, product Product) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("catalog: service is not configured")
	}
	if err := product.Validate(); err != nil {
		return err
	}
	return s.store.CreateProduct(ctx, product)
}

func (s *Service) ListProducts(ctx context.Context, tenantID string, limit int, afterName, afterID string) (ProductPage, error) {
	if s == nil || s.store == nil {
		return ProductPage{}, fmt.Errorf("catalog: service is not configured")
	}
	if tenantID == "" || limit < 1 || limit > 100 {
		return ProductPage{}, fmt.Errorf("catalog: invalid list request")
	}
	if (afterName == "") != (afterID == "") {
		return ProductPage{}, fmt.Errorf("catalog: cursor must contain name and id")
	}
	return s.store.ListProducts(ctx, tenantID, limit, afterName, afterID)
}
func (s *Service) UpdateProduct(ctx context.Context, p Product) error {
	x, ok := s.store.(ProductUpdateStore)
	if !ok {
		return fmt.Errorf("catalog: product update unavailable")
	}
	if err := p.Validate(); err != nil {
		return err
	}
	return x.UpdateProduct(ctx, p)
}
func (s *Service) DeleteProduct(ctx context.Context, tenant, id string) error {
	x, ok := s.store.(ProductUpdateStore)
	if !ok {
		return fmt.Errorf("catalog: product delete unavailable")
	}
	return x.DeleteProduct(ctx, tenant, id)
}
func (s *Service) UpdateVariant(ctx context.Context, v Variant) error {
	x, ok := s.store.(VariantUpdateStore)
	if !ok {
		return fmt.Errorf("catalog: variant update unavailable")
	}
	if err := v.Validate(); err != nil {
		return err
	}
	return x.UpdateVariant(ctx, v)
}
func (s *Service) DeleteVariant(ctx context.Context, tenant, id string) error {
	x, ok := s.store.(VariantUpdateStore)
	if !ok {
		return fmt.Errorf("catalog: variant delete unavailable")
	}
	return x.DeleteVariant(ctx, tenant, id)
}
