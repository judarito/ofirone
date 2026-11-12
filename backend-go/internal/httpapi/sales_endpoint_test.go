package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/sales"
)

type captureSaleStore struct {
	got       sales.Sale
	createErr error
}

func (s *captureSaleStore) Create(_ context.Context, sale *sales.Sale) error {
	s.got = *sale
	return s.createErr
}
func (s *captureSaleStore) List(context.Context, string, int, string, string) (sales.Page, error) {
	return sales.Page{}, nil
}

func TestCreateSaleUsesAuthenticatedTenant(t *testing.T) {
	store := &captureSaleStore{}
	service, err := sales.NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Catalog: nil, Sales: service, PingTimeout: time.Second}, nil)
	if err != nil {
		t.Fatal(err)
	}
	principal := auth.Principal{Identity: auth.Identity{ID: "identity-1"}, Tenant: auth.Tenant{ID: "tenant-auth"}}
	ctx, err := auth.WithPrincipal(context.Background(), principal)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"id":"00000000-0000-4000-8000-000000000001","tenant_id":"tenant-attacker","location_id":"location-1","sale_number":1,"status":"draft","lines":[{"variant_id":"variant-1","quantity":1,"unit_price":100}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sales", strings.NewReader(body)).WithContext(ctx)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	if store.got.TenantID != "tenant-auth" || store.got.CreatedByIdentityID != "identity-1" {
		t.Fatalf("untrusted identity context: %#v", store.got)
	}
	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["id"] != store.got.ID || response["total"] != float64(100) {
		t.Fatalf("response = %#v", response)
	}
}

func TestCreateSaleRequiresAuthentication(t *testing.T) {
	service, _ := sales.NewService(&captureSaleStore{})
	server, _ := New(Config{Sales: service}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sales", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestCreateSaleReportsIdempotencyConflict(t *testing.T) {
	service, err := sales.NewService(&captureSaleStore{createErr: sales.ErrIdempotencyConflict})
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Sales: service}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, err := auth.WithPrincipal(context.Background(), auth.Principal{
		Identity: auth.Identity{ID: "identity-1"}, Tenant: auth.Tenant{ID: "tenant-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	body := `{"id":"sale-1","location_id":"location-1","status":"draft","idempotency_key":"same","lines":[{"variant_id":"variant-1","quantity":1,"unit_price":100}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sales", strings.NewReader(body)).WithContext(ctx)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "SALE_IDEMPOTENCY_CONFLICT") {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
}
