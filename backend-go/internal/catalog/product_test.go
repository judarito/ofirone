package catalog

import "testing"

func TestProductAndVariantValidation(t *testing.T) {
	p := Product{ID: "p1", TenantID: "t1", Code: "SKU-1", Name: "Producto", ProductType: "stocked", Active: true}
	if err := p.Validate(); err != nil {
		t.Fatalf("product rejected: %v", err)
	}
	v := Variant{ID: "v1", TenantID: "t1", ProductID: "p1", SKU: "SKU-1-A", Name: "Principal", Cost: 100, SalePrice: 150, Active: true}
	if err := v.Validate(); err != nil {
		t.Fatalf("variant rejected: %v", err)
	}
	for _, bad := range []Product{{ProductType: "stocked"}, {ID: "p", TenantID: "t", Code: "c", Name: "n", ProductType: "invalid"}} {
		if err := bad.Validate(); err == nil {
			t.Fatalf("invalid product accepted: %#v", bad)
		}
	}
	badVariant := v
	badVariant.SalePrice = -1
	if err := badVariant.Validate(); err == nil {
		t.Fatal("negative price accepted")
	}
}
