package inventory

import "testing"

func TestMovementValidationAndAvailable(t *testing.T) {
	m := Movement{ID: "m1", TenantID: "t1", LocationID: "l1", VariantID: "v1", Delta: -2, Type: "sale_out"}
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	if got, err := Available(10, 3); err != nil || got != 7 {
		t.Fatalf("available = %d, %v", got, err)
	}
	if _, err := Available(2, 3); err == nil {
		t.Fatal("reserved greater than stock accepted")
	}
	m.Delta = 0
	if err := m.Validate(); err == nil {
		t.Fatal("zero movement accepted")
	}
}
