package sales

import (
	"context"
	"fmt"
)

type Service struct{ store Store }

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("sales: store is required")
	}
	return &Service{store: store}, nil
}

func (s *Service) Create(ctx context.Context, sale Sale) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("sales: service is not configured")
	}
	if err := sale.Recalculate(); err != nil {
		return err
	}
	if err := sale.ValidatePayments(); err != nil {
		return err
	}
	return s.store.Create(ctx, sale)
}

func (s *Service) List(ctx context.Context, tenantID string, limit int, afterSoldAt, afterID string) (Page, error) {
	if s == nil || s.store == nil {
		return Page{}, fmt.Errorf("sales: service is not configured")
	}
	if (afterSoldAt == "") != (afterID == "") {
		return Page{}, fmt.Errorf("sales: cursor must contain timestamp and id")
	}
	return s.store.List(ctx, tenantID, limit, afterSoldAt, afterID)
}
func (s *Service) Get(ctx context.Context, tenantID, saleID string) (Detail, error) {
	v, ok := s.store.(DetailStore)
	if !ok {
		return Detail{}, fmt.Errorf("sales: detail is not supported")
	}
	return v.Get(ctx, tenantID, saleID)
}
func (s *Service) Void(ctx context.Context, tenantID, saleID string) error {
	v, ok := s.store.(DetailStore)
	if !ok {
		return fmt.Errorf("sales: void is not supported")
	}
	return v.SetStatus(ctx, tenantID, saleID, Voided)
}
