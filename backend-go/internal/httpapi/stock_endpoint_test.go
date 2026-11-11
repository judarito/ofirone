package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/inventory"
)

type stockHTTPStore struct{ page inventory.StockPage }

func (s *stockHTTPStore) ListBatches(context.Context, string, string, string, int, string, string) (inventory.Page, error) {
	return inventory.Page{}, nil
}
func (s *stockHTTPStore) ListStock(context.Context, string, string, string, int, string, string) (inventory.StockPage, error) {
	return s.page, nil
}

func TestStockBalancesEndpoint(t *testing.T) {
	svc, err := inventory.NewService(&stockHTTPStore{page: inventory.StockPage{Items: []inventory.StockBalance{{TenantID: "tenant-a", LocationID: "loc", VariantID: "var", OnHand: 7, Reserved: 2}}, HasMore: true, NextID: "loc:var"}})
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Inventory: svc}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, _ := auth.WithPrincipal(context.Background(), auth.Principal{Identity: auth.Identity{ID: "i"}, Tenant: auth.Tenant{ID: "tenant-a"}})
	for _, tc := range []struct {
		target string
		want   int
		code   string
	}{
		{"/api/v1/inventory/stock-balances", 200, ""},
		{"/api/v1/inventory/stock-balances?location_id=loc", 200, ""},
		{"/api/v1/inventory/stock-balances?limit=0", 400, "INVALID_PAGINATION"},
		{"/api/v1/inventory/stock-balances?after_updated_at=2026-01-01", 400, "INVALID_REQUEST"},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.target, nil).WithContext(ctx)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Fatalf("%s status=%d body=%s", tc.target, w.Code, w.Body.String())
		}
		if !json.Valid(w.Body.Bytes()) {
			t.Fatalf("%s invalid JSON", tc.target)
		}
		if tc.code != "" {
			var body ErrorResponse
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if body.Code != tc.code {
				t.Fatalf("%s code=%s want=%s", tc.target, body.Code, tc.code)
			}
		}
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/inventory/stock-balances", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d", w.Code)
	}
}
