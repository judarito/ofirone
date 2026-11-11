package reference_locations

import "testing"

func TestValidation(t *testing.T) {
	for _, tc := range []struct {
		kind, code, name, method string
		valid                    bool
	}{
		{"locations", "main", "Principal", "", true},
		{"locations", " main", "Principal", "", false},
		{"locations", "main", " ", "", false},
		{"payment-methods", "cash", "Efectivo", "cash", true},
		{"payment-methods", "cash", "Efectivo", "bitcoin", false},
		{"sales", "x", "x", "", false},
	} {
		t.Run(tc.kind+tc.code+tc.method, func(t *testing.T) {
			e := Validate(tc.kind, Record{Code: tc.code, Name: tc.name, MethodType: tc.method})
			if (e == nil) != tc.valid {
				t.Fatalf("error=%v valid=%v", e, tc.valid)
			}
		})
	}
}
