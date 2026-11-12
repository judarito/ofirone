package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/catalog"
	"ofirone/backend-go/internal/customers"
	"ofirone/backend-go/internal/sales"
)

type fakeCustomerStore struct{ page customers.Page }

func (s *fakeCustomerStore) Create(context.Context, customers.Customer) error { return nil }
func (s *fakeCustomerStore) List(context.Context, string, int, string, string) (customers.Page, error) {
	return s.page, nil
}
func (s *fakeCustomerStore) Update(context.Context, string, customers.Customer) error { return nil }
func (s *fakeCustomerStore) Delete(context.Context, string, string) error             { return nil }

type fakeSalesStore struct{ page sales.Page }

func (s *fakeSalesStore) Create(context.Context, *sales.Sale) error { return nil }
func (s *fakeSalesStore) List(context.Context, string, int, string, string) (sales.Page, error) {
	return s.page, nil
}

func authedRequest(method, target string) *http.Request {
	ctx, _ := auth.WithPrincipal(context.Background(), auth.Principal{
		Identity: auth.Identity{ID: "identity-1"},
		Tenant:   auth.Tenant{ID: "tenant-1"},
	})
	return httptest.NewRequest(method, target, nil).WithContext(ctx)
}

func TestListingContracts(t *testing.T) {
	productSvc, _ := catalog.NewService(&captureProductStore{})
	customerSvc, _ := customers.NewService(&fakeCustomerStore{})
	salesSvc, _ := sales.NewService(&fakeSalesStore{})
	server, err := New(Config{Catalog: productSvc, Customers: customerSvc, Sales: salesSvc}, nil)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name, method, target string
		authed               bool
		want                 int
		code                 string
	}{
		{"products unauthenticated", "GET", "/api/v1/products", false, 401, "UNAUTHENTICATED"},
		{"products invalid limit", "GET", "/api/v1/products?limit=0", true, 400, "INVALID_PAGINATION"},
		{"products oversized limit", "GET", "/api/v1/products?limit=101", true, 400, "INVALID_PAGINATION"},
		{"products half cursor", "GET", "/api/v1/products?after_name=A", true, 400, "INVALID_REQUEST"},
		{"products page", "GET", "/api/v1/products?limit=10", true, 200, ""},
		{"customers unauthenticated", "GET", "/api/v1/customers", false, 401, "UNAUTHENTICATED"},
		{"customers invalid limit", "GET", "/api/v1/customers?limit=abc", true, 400, "INVALID_PAGINATION"},
		{"customers half cursor", "GET", "/api/v1/customers?after_id=x", true, 400, "INVALID_REQUEST"},
		{"customers page", "GET", "/api/v1/customers?limit=10", true, 200, ""},
		{"sales unauthenticated", "GET", "/api/v1/sales", false, 401, "UNAUTHENTICATED"},
		{"sales invalid limit", "GET", "/api/v1/sales?limit=-1", true, 400, "INVALID_PAGINATION"},
		{"sales half cursor", "GET", "/api/v1/sales?after_id=x", true, 400, "INVALID_REQUEST"},
		{"sales page", "GET", "/api/v1/sales?limit=10", true, 200, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.target, nil)
			if tc.authed {
				req = authedRequest(tc.method, tc.target)
			}
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
			if !json.Valid(w.Body.Bytes()) {
				t.Fatalf("invalid JSON: %s", w.Body.String())
			}
			if tc.code != "" {
				var body ErrorResponse
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Code != tc.code {
					t.Fatalf("error=%+v err=%v", body, err)
				}
			}
		})
	}
}
