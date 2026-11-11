package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/catalog"
)

type captureProductStore struct{ product catalog.Product }

func (s *captureProductStore) CreateProduct(_ context.Context, p catalog.Product) error {
	s.product = p
	return nil
}
func (s *captureProductStore) ListProducts(context.Context, string, int, string, string) (catalog.ProductPage, error) {
	return catalog.ProductPage{}, nil
}

func TestCreateProductUsesAuthenticatedTenant(t *testing.T) {
	store := &captureProductStore{}
	service, _ := catalog.NewService(store)
	server, err := New(Config{Catalog: service}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, err := auth.WithPrincipal(context.Background(), auth.Principal{Identity: auth.Identity{ID: "identity-1"}, Tenant: auth.Tenant{ID: "tenant-auth"}})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"id":"product-1","tenant_id":"attacker","code":"SKU-1","name":"Producto","product_type":"stocked","active":true}`)).WithContext(ctx)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	if store.product.TenantID != "tenant-auth" {
		t.Fatalf("tenant = %q", store.product.TenantID)
	}
}

func TestCreateProductRequiresAuthentication(t *testing.T) {
	service, _ := catalog.NewService(&captureProductStore{})
	server, _ := New(Config{Catalog: service}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}
