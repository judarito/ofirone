package sales

import "testing"

func TestSaleRecalculateAndPayment(t *testing.T) {
	s := Sale{ID: "s1", TenantID: "t1", LocationID: "l1", SaleNumber: 1, Status: Completed, Lines: []Line{{VariantID: "v1", Quantity: 2, UnitPrice: 1000, Tax: 190, Discount: 90}}, Payments: []Payment{{MethodID: "cash", Amount: 2100}}}
	if err := s.Recalculate(); err != nil {
		t.Fatal(err)
	}
	if s.Subtotal != 2000 || s.Total != 2100 {
		t.Fatalf("totals = %#v", s)
	}
	if err := s.ValidatePayments(); err != nil {
		t.Fatal(err)
	}
	s.Payments[0].Amount = 2000
	if err := s.ValidatePayments(); err == nil {
		t.Fatal("underpaid completed sale accepted")
	}
}

func TestSaleRejectsInvalidLine(t *testing.T) {
	s := Sale{ID: "s1", TenantID: "t1", LocationID: "l1", SaleNumber: 1, Status: Draft, Lines: []Line{{VariantID: "v1", Quantity: 1, UnitPrice: 10, Discount: 20}}}
	if err := s.Recalculate(); err == nil {
		t.Fatal("negative line total accepted")
	}
}
