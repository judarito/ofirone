package customers

import (
	"context"
	"fmt"
)

type Service struct{ store Store }

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("customers: store is required")
	}
	return &Service{store: store}, nil
}
func (s *Service) Create(ctx context.Context, c Customer) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("customers: service not configured")
	}
	if err := c.Validate(); err != nil {
		return err
	}
	return s.store.Create(ctx, c)
}
func (s *Service) List(ctx context.Context, tenant string, limit int, afterAt, afterID string) (Page, error) {
	if s == nil || s.store == nil {
		return Page{}, fmt.Errorf("customers: service not configured")
	}
	if (afterAt == "") != (afterID == "") {
		return Page{}, fmt.Errorf("customers: incomplete cursor")
	}
	return s.store.List(ctx, tenant, limit, afterAt, afterID)
}
func (s *Service) Update(ctx context.Context, tenant string, c Customer) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("customers: service not configured")
	}
	if c.TenantID != tenant {
		return fmt.Errorf("customers: tenant mismatch")
	}
	return s.store.Update(ctx, tenant, c)
}
func (s *Service) Delete(ctx context.Context, tenant, id string) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("customers: service not configured")
	}
	if tenant == "" || id == "" {
		return fmt.Errorf("customers: invalid id")
	}
	return s.store.Delete(ctx, tenant, id)
}
