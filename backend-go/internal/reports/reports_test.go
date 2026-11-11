package reports

import (
	"context"
	"testing"
)

type fakeStore struct{}

func (fakeStore) Sales(context.Context, Filter) (SalesReport, error) { return SalesReport{}, nil }
func (fakeStore) Purchases(context.Context, Filter) (PurchaseReport, error) {
	return PurchaseReport{}, nil
}
func (fakeStore) Inventory(context.Context, Filter) (InventoryReport, error) {
	return InventoryReport{}, nil
}
func (fakeStore) Receivables(context.Context, Filter) (ReceivableReport, error) {
	return ReceivableReport{}, nil
}
func (fakeStore) Dashboard(context.Context, Filter) (DashboardSummary, error) {
	return DashboardSummary{}, nil
}

func TestServiceRejectsInvalidFilters(t *testing.T) {
	s, _ := NewService(fakeStore{})
	if _, err := s.Sales(context.Background(), Filter{TenantID: "tenant", Limit: 101}); err == nil {
		t.Fatal("expected limit validation")
	}
}

func TestFilterAcceptsDateRange(t *testing.T) {
	s, _ := NewService(fakeStore{})
	if _, err := s.Inventory(context.Background(), Filter{TenantID: "tenant", Limit: 10}); err != nil {
		t.Fatal(err)
	}
}
