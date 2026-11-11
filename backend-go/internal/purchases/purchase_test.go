package purchases

import (
	"context"
	"testing"
)

type memoryStore struct{ created Purchase }

func (m *memoryStore) CreateReceived(_ context.Context, p Purchase) error { m.created = p; return nil }
func (m *memoryStore) List(context.Context, string, int, string, string) (Page, error) {
	return Page{}, nil
}

func TestNewReceivedReconcilesTotals(t *testing.T) {
	p, err := NewReceived("purchase-1", "tenant-1", "location-1", "supplier-1", []Line{{VariantID: "variant-1", Quantity: 2, UnitCost: 1500}}, 300, 100)
	if err != nil {
		t.Fatal(err)
	}
	if p.Subtotal != 3000 || p.Total != 3200 {
		t.Fatalf("unexpected totals: %+v", p)
	}
}

func TestPurchaseRejectsInvalidLineAndTotals(t *testing.T) {
	if _, err := NewReceived("p", "t", "l", "s", []Line{{VariantID: "", Quantity: 1, UnitCost: 1}}, 0, 0); err == nil {
		t.Fatal("expected invalid line")
	}
	p := Purchase{ID: "p", TenantID: "t", LocationID: "l", SupplierID: "s", Status: Received, Lines: []Line{{VariantID: "v", Quantity: 1, UnitCost: 10}}, Subtotal: 9, Total: 9}
	if err := p.Validate(); err == nil {
		t.Fatal("expected totals mismatch")
	}
}

func TestCancelledPurchaseMayHaveNoLines(t *testing.T) {
	p := Purchase{ID: "p", TenantID: "t", LocationID: "l", SupplierID: "s", Status: Cancelled, Total: 0}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
}
