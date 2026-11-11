package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ofirone/backend-go/internal/auth"
)

type roleMenuStore struct{}

func (roleMenuStore) ListMenus(_ context.Context, p auth.Principal) ([]menuItem, error) {
	if p.Tenant.ID != "tenant-a" {
		return nil, nil
	}
	if p.Identity.ID == "admin" {
		return []menuItem{{Code: "DASHBOARD", Label: "Escritorio"}, {Code: "USERS", Label: "Usuarios"}}, nil
	}
	return []menuItem{{Code: "DASHBOARD", Label: "Escritorio"}, {Code: "SALES", Label: "Ventas"}}, nil
}

func menuRequest(identity string) *http.Request {
	ctx, _ := auth.WithPrincipal(context.Background(), auth.Principal{
		Identity: auth.Identity{ID: auth.IdentityID(identity)},
		Tenant:   auth.Tenant{ID: "tenant-a"},
	})
	return httptest.NewRequest(http.MethodGet, "/api/v1/me/menu", nil).WithContext(ctx)
}

func TestMenuByRoleAndTenant(t *testing.T) {
	server, err := New(Config{Menus: roleMenuStore{}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		identity string
		want     string
		absent   string
	}{
		{"admin", "USERS", "SALES"},
		{"cashier", "SALES", "USERS"},
	} {
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, menuRequest(tc.identity))
		if w.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", tc.identity, w.Code, w.Body.String())
		}
		var body struct {
			Data []menuItem `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		seenWant, seenAbsent := false, false
		for _, item := range body.Data {
			seenWant = seenWant || item.Code == tc.want
			seenAbsent = seenAbsent || item.Code == tc.absent
		}
		if !seenWant || seenAbsent {
			t.Fatalf("%s menu=%+v", tc.identity, body.Data)
		}
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/me/menu", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d", w.Code)
	}
}
