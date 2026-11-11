// Package purchases contains the MVP purchase and receiving rules.
package purchases

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type Store interface {
	CreateReceived(context.Context, Purchase) error
	List(context.Context, string, int, string, string) (Page, error)
}
type DetailStore interface {
	Get(context.Context, string, string) (Detail, error)
	Cancel(context.Context, string, string) error
}
type Detail struct {
	Purchase Purchase `json:"purchase"`
	Lines    []Line   `json:"lines"`
}

type Page struct {
	Items           []Purchase `json:"items"`
	HasMore         bool       `json:"has_more"`
	NextPurchasedAt string     `json:"next_purchased_at,omitempty"`
	NextID          string     `json:"next_id,omitempty"`
}

type Service struct{ store Store }

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("purchases: store is required")
	}
	return &Service{store: store}, nil
}

func (s *Service) Receive(ctx context.Context, p Purchase) error {
	if s == nil || s.store == nil {
		return fmt.Errorf("purchases: service is not configured")
	}
	if err := p.Validate(); err != nil {
		return err
	}
	if p.Status != Received {
		return fmt.Errorf("%w: purchase must be received", ErrInvalidPurchase)
	}
	return s.store.CreateReceived(ctx, p)
}

func (s *Service) List(ctx context.Context, tenant string, limit int, afterAt, afterID string) (Page, error) {
	if s == nil || s.store == nil {
		return Page{}, fmt.Errorf("purchases: service is not configured")
	}
	if tenant == "" || limit < 1 || limit > 100 {
		return Page{}, fmt.Errorf("%w: invalid list request", ErrInvalidPurchase)
	}
	return s.store.List(ctx, tenant, limit, afterAt, afterID)
}
func (s *Service) Get(ctx context.Context, tenant, id string) (Detail, error) {
	v, ok := s.store.(DetailStore)
	if !ok {
		return Detail{}, fmt.Errorf("purchases: detail is not supported")
	}
	return v.Get(ctx, tenant, id)
}
func (s *Service) Cancel(ctx context.Context, tenant, id string) error {
	v, ok := s.store.(DetailStore)
	if !ok {
		return fmt.Errorf("purchases: cancel is not supported")
	}
	return v.Cancel(ctx, tenant, id)
}

var ErrInvalidPurchase = errors.New("purchases: invalid purchase")

type Status string

const (
	Draft     Status = "draft"
	Received  Status = "received"
	Cancelled Status = "cancelled"
)

type Line struct {
	VariantID   string `json:"variant_id"`
	ProductName string `json:"product_name,omitempty"`
	VariantName string `json:"variant_name,omitempty"`
	SKU         string `json:"sku,omitempty"`
	Quantity    int64  `json:"quantity"`
	UnitCost    int64  `json:"unit_cost"`
	LineTotal   int64  `json:"line_total"`
}

type Purchase struct {
	ID             string    `json:"purchase_id"`
	TenantID       string    `json:"tenant_id"`
	LocationID     string    `json:"location_id"`
	SupplierID     string    `json:"supplier_id"`
	Status         Status    `json:"status"`
	Lines          []Line    `json:"lines"`
	Subtotal       int64     `json:"subtotal"`
	TaxTotal       int64     `json:"tax_total"`
	Discount       int64     `json:"discount"`
	Total          int64     `json:"total"`
	PurchaseNumber int64     `json:"purchase_number"`
	LocationName   string    `json:"location_name,omitempty"`
	SupplierName   string    `json:"supplier_name,omitempty"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
}

func (p Purchase) Validate() error {
	if p.ID == "" || p.TenantID == "" || p.LocationID == "" || p.SupplierID == "" {
		return fmt.Errorf("%w: identity fields are required", ErrInvalidPurchase)
	}
	if p.Status != Draft && p.Status != Received && p.Status != Cancelled {
		return fmt.Errorf("%w: unsupported status", ErrInvalidPurchase)
	}
	if len(p.Lines) == 0 && p.Status != Cancelled {
		return fmt.Errorf("%w: at least one line is required", ErrInvalidPurchase)
	}
	var subtotal int64
	for _, line := range p.Lines {
		if line.VariantID == "" || line.Quantity <= 0 || line.UnitCost < 0 {
			return fmt.Errorf("%w: invalid line", ErrInvalidPurchase)
		}
		subtotal += line.Quantity * line.UnitCost
	}
	if p.Subtotal != subtotal || p.TaxTotal < 0 || p.Discount < 0 || p.Total != p.Subtotal+p.TaxTotal-p.Discount || p.Total < 0 {
		return fmt.Errorf("%w: totals do not reconcile", ErrInvalidPurchase)
	}
	return nil
}

func NewReceived(id, tenantID, locationID, supplierID string, lines []Line, tax, discount int64) (Purchase, error) {
	p := Purchase{ID: id, TenantID: tenantID, LocationID: locationID, SupplierID: supplierID, Status: Received, Lines: lines, TaxTotal: tax, Discount: discount}
	for _, line := range lines {
		p.Subtotal += line.Quantity * line.UnitCost
	}
	p.Total = p.Subtotal + p.TaxTotal - p.Discount
	return p, p.Validate()
}
