package reports

import (
	"context"
	"fmt"
	"time"
)

type Filter struct {
	TenantID   string
	From       *time.Time
	To         *time.Time
	LocationID string
	Status     string
	Limit      int
	AfterAt    *time.Time
	AfterID    string
}

func (f Filter) Validate() error {
	if f.TenantID == "" || f.Limit < 1 || f.Limit > 100 {
		return fmt.Errorf("reports: invalid filter")
	}
	if f.From != nil && f.To != nil && f.To.Before(*f.From) {
		return fmt.Errorf("reports: invalid date range")
	}
	return nil
}

type SalesRow struct {
	ID         string    `json:"id"`
	At         time.Time `json:"at"`
	LocationID string    `json:"location_id"`
	Status     string    `json:"status"`
	Total      int64     `json:"total"`
}
type PurchaseRow struct {
	ID         string    `json:"id"`
	At         time.Time `json:"at"`
	LocationID string    `json:"location_id"`
	Status     string    `json:"status"`
	Total      int64     `json:"total"`
}
type InventoryRow struct {
	ID            string    `json:"id"`
	At            time.Time `json:"at"`
	LocationID    string    `json:"location_id"`
	VariantID     string    `json:"variant_id"`
	MovementType  string    `json:"movement_type"`
	QuantityDelta int64     `json:"quantity_delta"`
}
type ReceivableRow struct {
	ID             string `json:"id"`
	CustomerID     string `json:"customer_id"`
	Status         string `json:"status"`
	CurrentBalance int64  `json:"current_balance"`
	CreditLimit    int64  `json:"credit_limit"`
}

type SalesReport struct {
	Total   int64      `json:"total"`
	Count   int64      `json:"count"`
	Items   []SalesRow `json:"items"`
	HasMore bool       `json:"has_more"`
	NextAt  *time.Time `json:"next_at,omitempty"`
	NextID  string     `json:"next_id,omitempty"`
}
type PurchaseReport struct {
	Total   int64         `json:"total"`
	Count   int64         `json:"count"`
	Items   []PurchaseRow `json:"items"`
	HasMore bool          `json:"has_more"`
	NextAt  *time.Time    `json:"next_at,omitempty"`
	NextID  string        `json:"next_id,omitempty"`
}
type InventoryReport struct {
	NetQuantity int64          `json:"net_quantity"`
	Items       []InventoryRow `json:"items"`
	HasMore     bool           `json:"has_more"`
	NextAt      *time.Time     `json:"next_at,omitempty"`
	NextID      string         `json:"next_id,omitempty"`
}
type ReceivableReport struct {
	Outstanding int64           `json:"outstanding"`
	Count       int64           `json:"count"`
	Items       []ReceivableRow `json:"items"`
	HasMore     bool            `json:"has_more"`
	NextID      string          `json:"next_id,omitempty"`
}

type DashboardKPI struct {
	Total int64 `json:"total"`
	Count int64 `json:"count"`
}
type DashboardDaily struct {
	Date  string `json:"date"`
	Total int64  `json:"total"`
}
type DashboardProduct struct {
	Name    string `json:"name"`
	Revenue int64  `json:"revenue"`
	Qty     int64  `json:"qty"`
}
type DashboardPayment struct {
	Method string `json:"method"`
	Total  int64  `json:"total"`
}
type DashboardSummary struct {
	KPIs           map[string]DashboardKPI `json:"kpis"`
	DailySeries    []DashboardDaily        `json:"daily_series"`
	TopProducts    []DashboardProduct      `json:"top_products"`
	PaymentMethods []DashboardPayment      `json:"payment_methods"`
}

type Store interface {
	Sales(context.Context, Filter) (SalesReport, error)
	Purchases(context.Context, Filter) (PurchaseReport, error)
	Inventory(context.Context, Filter) (InventoryReport, error)
	Receivables(context.Context, Filter) (ReceivableReport, error)
	Dashboard(context.Context, Filter) (DashboardSummary, error)
}
type Service struct{ store Store }

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("reports: nil store")
	}
	return &Service{store: store}, nil
}
func (s *Service) Sales(ctx context.Context, f Filter) (SalesReport, error) {
	if e := f.Validate(); e != nil {
		return SalesReport{}, e
	}
	return s.store.Sales(ctx, f)
}
func (s *Service) Purchases(ctx context.Context, f Filter) (PurchaseReport, error) {
	if e := f.Validate(); e != nil {
		return PurchaseReport{}, e
	}
	return s.store.Purchases(ctx, f)
}
func (s *Service) Inventory(ctx context.Context, f Filter) (InventoryReport, error) {
	if e := f.Validate(); e != nil {
		return InventoryReport{}, e
	}
	return s.store.Inventory(ctx, f)
}
func (s *Service) Receivables(ctx context.Context, f Filter) (ReceivableReport, error) {
	if e := f.Validate(); e != nil {
		return ReceivableReport{}, e
	}
	return s.store.Receivables(ctx, f)
}
func (s *Service) Dashboard(ctx context.Context, f Filter) (DashboardSummary, error) {
	if e := f.Validate(); e != nil {
		return DashboardSummary{}, e
	}
	return s.store.Dashboard(ctx, f)
}
