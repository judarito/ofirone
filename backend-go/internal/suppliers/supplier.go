package suppliers

import (
	"context"
	"fmt"
)

type Supplier struct {
	ID             string `json:"id"`
	TenantID       string `json:"tenant_id"`
	Name           string `json:"name"`
	DocumentType   string `json:"document_type"`
	DocumentNumber string `json:"document_number"`
	Email          string `json:"email"`
	Phone          string `json:"phone"`
	Active         bool   `json:"is_active"`
}
type Page struct {
	Items   []Supplier `json:"items"`
	HasMore bool       `json:"has_more"`
	NextID  string     `json:"next_id,omitempty"`
}
type Store interface {
	Create(context.Context, Supplier) error
	List(context.Context, string, int, string) (Page, error)
}
type Service struct{ s Store }

func New(s Store) (*Service, error) {
	if s == nil {
		return nil, fmt.Errorf("suppliers: store required")
	}
	return &Service{s}, nil
}
func (x *Service) Create(c context.Context, v Supplier) error {
	if v.ID == "" || v.TenantID == "" || v.Name == "" {
		return fmt.Errorf("suppliers: invalid supplier")
	}
	return x.s.Create(c, v)
}
func (x *Service) List(c context.Context, t string, n int, a string) (Page, error) {
	return x.s.List(c, t, n, a)
}
