package inventory

import (
	"context"
	"fmt"
)

type Service struct{ store Store }

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("inventory: store is required")
	}
	return &Service{store: store}, nil
}

func (s *Service) ApplyMovement(ctx context.Context, movement Movement, batchID string) error {
	mutator, ok := s.store.(MutationStore)
	if !ok {
		return fmt.Errorf("inventory: mutation store is not configured")
	}
	if err := movement.Validate(); err != nil {
		return err
	}
	if batchID == "" {
		return fmt.Errorf("inventory: batch is required")
	}
	return mutator.ApplyMovement(ctx, movement, batchID)
}

func (s *Service) ListBatches(ctx context.Context, tenantID, locationID, variantID string, limit int, afterUpdatedAt, afterID string) (Page, error) {
	if s == nil || s.store == nil {
		return Page{}, fmt.Errorf("inventory: service is not configured")
	}
	if (afterUpdatedAt == "") != (afterID == "") {
		return Page{}, fmt.Errorf("inventory: cursor must contain timestamp and id")
	}
	return s.store.ListBatches(ctx, tenantID, locationID, variantID, limit, afterUpdatedAt, afterID)
}
func (s *Service) ListStock(ctx context.Context, tenantID, locationID, variantID string, limit int, afterUpdatedAt, afterID string) (StockPage, error) {
	lister, ok := s.store.(StockStore)
	if !ok {
		return StockPage{}, fmt.Errorf("inventory: stock store is not configured")
	}
	if tenantID == "" || limit < 1 || limit > 100 {
		return StockPage{}, fmt.Errorf("inventory: invalid stock request")
	}
	if (afterUpdatedAt == "") != (afterID == "") {
		return StockPage{}, fmt.Errorf("inventory: cursor must contain timestamp and id")
	}
	return lister.ListStock(ctx, tenantID, locationID, variantID, limit, afterUpdatedAt, afterID)
}
func (s *Service) ListMoves(ctx context.Context, t, l, v string, n int, a, id string) (MovePage, error) {
	x, ok := s.store.(MoveStore)
	if !ok {
		return MovePage{}, fmt.Errorf("inventory: move store not configured")
	}
	return x.ListMoves(ctx, t, l, v, n, a, id)
}

func (s *Service) Available(ctx context.Context, tenantID, locationID, variantID string) (int64, error) {
	q, ok := s.store.(AvailabilityStore)
	if !ok {
		return 0, fmt.Errorf("inventory: availability store is not configured")
	}
	return q.Available(ctx, tenantID, locationID, variantID)
}
func (s *Service) ListAlerts(ctx context.Context, tenant string, limit int) ([]Alert, error) {
	x, ok := s.store.(AlertStore)
	if !ok {
		return nil, fmt.Errorf("inventory: alerts unavailable")
	}
	return x.ListAlerts(ctx, tenant, limit)
}
