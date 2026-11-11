package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ofirone/backend-go/internal/auth"
	ref "ofirone/backend-go/internal/reference_tax"
)

const refTenantA = "6ff8da55-4bfc-4082-b6fe-9e794f8dd326"
const refTenantB = "5cc9b7b7-e023-4126-918e-9748d232fc14"
const refID = "38323d67-30f4-42a9-91f2-749750d16b56"

type referenceTaxFake struct {
	rows map[string]ref.Record
	fail error
}

func (s *referenceTaxFake) key(r ref.Resource, tenant, id string) string {
	return string(r) + tenant + id
}
func (s *referenceTaxFake) List(_ context.Context, r ref.Resource, tenant string, q ref.Query) (ref.Page, error) {
	if s.fail != nil {
		return ref.Page{}, s.fail
	}
	items := []ref.Record{}
	for key, v := range s.rows {
		if strings.HasPrefix(key, string(r)+tenant) {
			items = append(items, v)
		}
	}
	return ref.NewPage(items, q, r, tenant), nil
}
func (s *referenceTaxFake) Get(_ context.Context, r ref.Resource, tenant, id string) (ref.Record, error) {
	v, ok := s.rows[s.key(r, tenant, id)]
	if !ok {
		return v, ref.ErrNotFound
	}
	return v, s.fail
}
func (s *referenceTaxFake) Create(_ context.Context, r ref.Resource, tenant string, v ref.Record) (ref.Record, error) {
	if s.fail != nil {
		return v, s.fail
	}
	if v.ID == "" {
		v.ID = refID
	}
	key := s.key(r, tenant, v.ID)
	if _, ok := s.rows[key]; ok {
		return v, ref.ErrConflict
	}
	s.rows[key] = v
	return v, nil
}
func (s *referenceTaxFake) Update(ctx context.Context, r ref.Resource, tenant string, v ref.Record) (ref.Record, error) {
	if _, e := s.Get(ctx, r, tenant, v.ID); e != nil {
		return v, e
	}
	s.rows[s.key(r, tenant, v.ID)] = v
	return v, nil
}
func (s *referenceTaxFake) Deactivate(ctx context.Context, r ref.Resource, tenant, id string) error {
	v, e := s.Get(ctx, r, tenant, id)
	if e != nil {
		return e
	}
	v.Active = false
	s.rows[s.key(r, tenant, id)] = v
	return nil
}
func referenceCall(h http.Handler, method, path, body, tenant string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if tenant != "" {
		ctx, _ := auth.WithPrincipal(req.Context(), auth.Principal{Identity: auth.Identity{ID: "verified-user"}, Tenant: auth.Tenant{ID: auth.TenantID(tenant)}})
		req = req.WithContext(ctx)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestReferenceCRUDAndTenantIsolation(t *testing.T) {
	cases := map[string]string{
		"taxes":             `{"code":"VAT","name":"IVA","rate":19,"is_inclusive":true}`,
		"currencies":        `{"code":"COP","name":"Peso","decimal_places":2}`,
		"regional-settings": `{"code":"default","name":"Colombia","currency_code":"COP","locale":"es-CO","timezone":"America/Bogota"}`,
	}
	for resource, body := range cases {
		t.Run(resource, func(t *testing.T) {
			s := &referenceTaxFake{rows: map[string]ref.Record{}}
			h := NewReferenceTaxHandler(s)
			path := "/api/v1/" + resource
			if w := referenceCall(h, "POST", path, body, refTenantA); w.Code != 201 {
				t.Fatalf("create %d %s", w.Code, w.Body)
			}
			if w := referenceCall(h, "POST", path, body, refTenantA); w.Code != 409 {
				t.Fatal("duplicate", w.Code)
			}
			if w := referenceCall(h, "GET", path+"/"+refID, "", refTenantB); w.Code != 404 {
				t.Fatal("cross tenant", w.Code)
			}
			if w := referenceCall(h, "DELETE", path+"/"+refID, "", refTenantB); w.Code != 404 {
				t.Fatal("cross tenant delete", w.Code)
			}
			update := strings.Replace(body, `"name":`, `"is_active":false,"name":`, 1)
			if w := referenceCall(h, "PUT", path+"/"+refID, update, refTenantA); w.Code != 200 {
				t.Fatal(w.Code, w.Body)
			}
			w := referenceCall(h, "GET", path+"?limit=1", "", refTenantA)
			var page ref.Page
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Items[0].Active {
				t.Fatal(w.Code, w.Body)
			}
			if w := referenceCall(h, "HEAD", path, "", refTenantA); w.Code != 200 || w.Body.Len() != 0 {
				t.Fatal("head", w.Code, w.Body)
			}
			if w := referenceCall(h, "DELETE", path+"/"+refID, "", refTenantA); w.Code != 204 || w.Body.Len() != 0 {
				t.Fatal(w.Code, w.Body)
			}
			if w := referenceCall(h, "GET", path+"/"+refID, "", refTenantA); w.Code != 200 {
				t.Fatal("soft deletion lost history", w.Code)
			}
		})
	}
}

func TestReferenceRejectsBadRequests(t *testing.T) {
	h := NewReferenceTaxHandler(&referenceTaxFake{rows: map[string]ref.Record{}})
	cases := []struct {
		method, path, body, tenant string
		status                     int
	}{
		{"GET", "/api/v1/taxes", "", "", 401},
		{"GET", "/api/v1/taxes?limit=101", "", refTenantA, 422},
		{"GET", "/api/v1/taxes?limit=abc", "", refTenantA, 422},
		{"GET", "/api/v1/taxes?cursor=bad", "", refTenantA, 422},
		{"GET", "/api/v1/taxes/not-uuid", "", refTenantA, 422},
		{"POST", "/api/v1/taxes", `{"code":"T","name":"Tax","rate":101}`, refTenantA, 422},
		{"POST", "/api/v1/taxes", `{"code":"T","name":"Tax","rate":0,"tenant_id":"spoof"}`, refTenantA, 400},
		{"POST", "/api/v1/taxes", `{"code":"T","name":"Tax","rate":0} {}`, refTenantA, 400},
		{"POST", "/api/v1/currencies", `{"code":"ZZZ","name":"Unknown","decimal_places":2}`, refTenantA, 422},
		{"PATCH", "/api/v1/taxes/" + refID, `{}`, refTenantA, 405},
		{"GET", "/api/v1/other", "", refTenantA, 404},
	}
	for _, tc := range cases {
		w := referenceCall(h, tc.method, tc.path, tc.body, tc.tenant)
		if w.Code != tc.status {
			t.Errorf("%s %s: %d want %d (%s)", tc.method, tc.path, w.Code, tc.status, w.Body)
		}
	}
}

func TestReferenceInternalErrorSanitized(t *testing.T) {
	h := NewReferenceTaxHandler(&referenceTaxFake{fail: errors.New("postgres://secret:password@host")})
	w := referenceCall(h, "GET", "/api/v1/taxes", "", refTenantA)
	if w.Code != 500 || strings.Contains(w.Body.String(), "password") {
		t.Fatal(w.Code, w.Body)
	}
	w = referenceCall(NewReferenceTaxHandler(nil), "GET", "/api/v1/taxes", "", refTenantA)
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
