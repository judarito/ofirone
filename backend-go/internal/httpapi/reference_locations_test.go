package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"ofirone/backend-go/internal/auth"
	refs "ofirone/backend-go/internal/reference_locations"
	"strings"
	"testing"
)

type referenceFake struct {
	record              refs.Record
	tenant, kind, after string
	limit               int
	deleted             bool
}

func (f *referenceFake) List(_ context.Context, tenant, kind string, limit int, after string) (refs.Page, error) {
	f.tenant = tenant
	f.kind = kind
	f.limit = limit
	f.after = after
	return refs.Page{Items: []refs.Record{f.record}}, nil
}
func (f *referenceFake) Get(_ context.Context, tenant, kind, key string) (refs.Record, error) {
	f.tenant = tenant
	return f.record, nil
}
func (f *referenceFake) Create(_ context.Context, tenant, kind string, r refs.Record) (refs.Record, error) {
	f.tenant = tenant
	f.kind = kind
	f.record = r
	return r, nil
}
func (f *referenceFake) Update(ctx context.Context, tenant, kind, key string, r refs.Record) (refs.Record, error) {
	return f.Create(ctx, tenant, kind, r)
}
func (f *referenceFake) Delete(_ context.Context, tenant, kind, key string) error {
	f.tenant = tenant
	f.deleted = true
	return nil
}
func referenceRequest(method, path, body string, authenticated bool) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if authenticated {
		ctx, _ := auth.WithPrincipal(r.Context(), auth.Principal{Identity: auth.Identity{ID: "identity"}, Tenant: auth.Tenant{ID: "trusted-tenant"}})
		r = r.WithContext(ctx)
	}
	return r
}
func TestReferenceCRUD(t *testing.T) {
	const key = "00000000-0000-0000-0000-000000000001"
	for _, kind := range []string{"locations", "payment-methods"} {
		t.Run(kind, func(t *testing.T) {
			f := &referenceFake{}
			h := NewReferenceLocationsHandler(f, nil)
			for _, tc := range []struct {
				method, path, body string
				status             int
			}{
				{"POST", "", `{"code":"cash","name":"Principal","tenant_id":"untrusted","method_type":"cash"}`, 201},
				{"GET", "?limit=2&after_id=" + key, "", 200},
				{"GET", "/" + key, "", 200},
				{"PATCH", "/" + key, `{"name":"Actualizado","is_active":false}`, 200},
				{"DELETE", "/" + key, "", 204},
			} {
				w := httptest.NewRecorder()
				h.ServeHTTP(w, referenceRequest(tc.method, "/api/v1/"+kind+tc.path, tc.body, true))
				if w.Code != tc.status {
					t.Fatalf("%s: %d %s", tc.method, w.Code, w.Body.String())
				}
				if f.tenant != "trusted-tenant" {
					t.Fatal("tenant not from principal")
				}
			}
			if !f.deleted || f.record.Name != "Actualizado" || f.record.IsActive || f.record.Code != "cash" || f.limit != 2 || f.after != key {
				t.Fatalf("incorrect CRUD state: %+v", f)
			}
			data, _ := json.Marshal(f.record)
			if !strings.Contains(string(data), `"tenant_id"`) {
				t.Fatal("missing snake_case")
			}
		})
	}
}
func TestReferenceRejectedRequests(t *testing.T) {
	for _, tc := range []struct {
		method, path, body string
		auth               bool
		status             int
	}{
		{"GET", "/api/v1/locations", "", false, 401},
		{"GET", "/api/v1/locations?limit=101", "", true, 400},
		{"GET", "/api/v1/locations?after_id=bad", "", true, 400},
		{"GET", "/api/v1/locations/bad", "", true, 400},
		{"POST", "/api/v1/locations", `{"code":"","name":"x"}`, true, 422},
		{"POST", "/api/v1/locations", `{"code":"a","name":"x"} {}`, true, 400},
		{"POST", "/api/v1/payment-methods", `{"code":"a","name":"x","method_type":"invalid"}`, true, 422},
		{"PUT", "/api/v1/locations", "", true, 405},
	} {
		w := httptest.NewRecorder()
		NewReferenceLocationsHandler(&referenceFake{}, nil).ServeHTTP(w, referenceRequest(tc.method, tc.path, tc.body, tc.auth))
		if w.Code != tc.status {
			t.Errorf("%s %s: got %d want %d", tc.method, tc.path, w.Code, tc.status)
		}
	}
}
