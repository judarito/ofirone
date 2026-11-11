package reference_catalog

import "testing"

const tenant = "11111111-1111-4111-8111-111111111111"

func TestValidation(t *testing.T) {
	self := "22222222-2222-4222-8222-222222222222"
	tests := []struct {
		name  string
		k     Kind
		v     Item
		valid bool
	}{
		{"unit", Units, Item{TenantID: tenant, Code: "KG", Name: "Kilogramo", DecimalPlaces: 3}, true},
		{"category", Categories, Item{TenantID: tenant, Code: "food", Name: "Alimentos"}, true},
		{"missing tenant", Units, Item{Code: "KG", Name: "Kilo"}, false},
		{"decimal range", Units, Item{TenantID: tenant, Code: "KG", Name: "Kilo", DecimalPlaces: 7}, false},
		{"negative precision", Units, Item{TenantID: tenant, Code: "KG", Name: "Kilo", DecimalPlaces: -1}, false},
		{"self parent", Categories, Item{ID: self, TenantID: tenant, Code: "food", Name: "Food", ParentID: &self}, false},
		{"unit parent", Units, Item{TenantID: tenant, Code: "KG", Name: "Kilo", ParentID: &self}, false},
		{"trim code", Units, Item{TenantID: tenant, Code: " KG", Name: "Kilo"}, false},
		{"blank name", Categories, Item{TenantID: tenant, Code: "food", Name: "  "}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if e := Validate(tt.k, tt.v); (e == nil) != tt.valid {
				t.Fatalf("Validate=%v valid=%v", e, tt.valid)
			}
		})
	}
}
func TestPagination(t *testing.T) {
	for _, q := range []Query{{Limit: 0}, {Limit: 101}, {Limit: 5, AfterName: "A"}, {Limit: 5, AfterID: tenant}, {Limit: 5, AfterName: "A", AfterID: "bad"}} {
		if ValidateQuery(q) == nil {
			t.Fatalf("accepted %+v", q)
		}
	}
	if ValidateQuery(Query{Limit: 5, AfterName: "A", AfterID: tenant}) != nil {
		t.Fatal("valid cursor rejected")
	}
}
