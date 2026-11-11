package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"ofirone/backend-go/internal/auth"
	ref "ofirone/backend-go/internal/reference_catalog"
	"strings"
	"testing"
)

type referenceCatalogFake struct {
	saved   ref.Item
	query   ref.Query
	tenant  string
	failure error
}

func (f *referenceCatalogFake) List(_ context.Context, _ ref.Kind, t string, q ref.Query) (ref.Page, error) {
	f.tenant = t
	f.query = q
	return ref.Page{Items: []ref.Item{}}, f.failure
}
func (f *referenceCatalogFake) Get(_ context.Context, _ ref.Kind, t, id string) (ref.Item, error) {
	f.tenant = t
	return ref.Item{ID: id, TenantID: t, Code: "KG", Name: "Kilogramo", DecimalPlaces: 3, Active: true}, f.failure
}
func (f *referenceCatalogFake) Save(_ context.Context, _ ref.Kind, v ref.Item, _ bool) (ref.Item, error) {
	f.saved = v
	return v, f.failure
}
func (f *referenceCatalogFake) Deactivate(_ context.Context, _ ref.Kind, t, _ string) error {
	f.tenant = t
	return f.failure
}
func referenceCatalogRequest(t *testing.T, method, path, body string, authenticated bool) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if authenticated {
		ctx, e := auth.WithPrincipal(r.Context(), auth.Principal{Identity: auth.Identity{ID: "identity"}, Tenant: auth.Tenant{ID: "11111111-1111-4111-8111-111111111111"}})
		if e != nil {
			t.Fatal(e)
		}
		r = r.WithContext(ctx)
	}
	return r
}
func TestReferenceCatalogHandler(t *testing.T) {
	id := "22222222-2222-4222-8222-222222222222"
	cases := []struct {
		name, method, path, body string
		auth                     bool
		failure                  error
		want                     int
	}{
		{"jwt required", "GET", "/api/v1/categories", "", false, nil, 401},
		{"list", "GET", "/api/v1/categories?limit=3", "", true, nil, 200},
		{"bad pagination", "GET", "/api/v1/categories?limit=101", "", true, nil, 400},
		{"partial cursor", "GET", "/api/v1/categories?after_name=A", "", true, nil, 400},
		{"create", "POST", "/api/v1/units-of-measure", `{"code":"KG","name":"Kilogramo"}`, true, nil, 201},
		{"reject tenant spoof", "POST", "/api/v1/categories", `{"code":"A","name":"A","tenant_id":"other"}`, true, nil, 400},
		{"partial update", "PATCH", "/api/v1/units-of-measure/" + id, `{"name":"Kilos"}`, true, nil, 200},
		{"invalid parent", "POST", "/api/v1/categories", `{"code":"A","name":"A","parent_category_id":"bad"}`, true, nil, 422},
		{"parent rejected by store", "POST", "/api/v1/categories", `{"code":"A","name":"A"}`, true, ref.ErrParent, 422},
		{"duplicate", "POST", "/api/v1/categories", `{"code":"A","name":"A"}`, true, ref.ErrConflict, 409},
		{"deactivate", "DELETE", "/api/v1/categories/" + id, "", true, nil, 204},
		{"missing", "GET", "/api/v1/categories/" + id, "", true, ref.ErrNotFound, 404},
		{"internal error", "GET", "/api/v1/categories", "", true, context.DeadlineExceeded, 500},
		{"json trailing", "POST", "/api/v1/categories", `{"code":"A","name":"A"} {}`, true, nil, 400},
		{"method", "PUT", "/api/v1/categories/" + id, `{}`, true, nil, 405},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &referenceCatalogFake{failure: tc.failure}
			w := httptest.NewRecorder()
			NewReferenceCatalogHandler(f).ServeHTTP(w, referenceCatalogRequest(t, tc.method, tc.path, tc.body, tc.auth))
			if w.Code != tc.want {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.name == "partial update" && (f.saved.Code != "KG" || f.saved.DecimalPlaces != 3 || f.saved.Name != "Kilos" || f.saved.TenantID != "11111111-1111-4111-8111-111111111111") {
				t.Fatalf("patch lost fields: %+v", f.saved)
			}
		})
	}
}
