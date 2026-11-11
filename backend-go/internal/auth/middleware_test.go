package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type verifierFunc func(context.Context, string) (Principal, error)

func (f verifierFunc) Verify(ctx context.Context, token string) (Principal, error) {
	return f(ctx, token)
}

func TestMiddlewareSuccess(t *testing.T) {
	type marker struct{}
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), marker{}, "kept"))
	defer cancel()
	for _, header := range []string{"Bearer opaque-token", "bearer opaque-token", "BEARER opaque-token", "Bearer abc+/==", "Bearer eyJ.x.y"} {
		t.Run(header, func(t *testing.T) {
			calls := 0
			middleware, err := NewMiddleware(verifierFunc(func(got context.Context, token string) (Principal, error) {
				calls++
				if got != ctx || token != strings.SplitN(header, " ", 2)[1] {
					t.Fatal("token or context changed")
				}
				return testPrincipal(), nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				p, ok := PrincipalFromContext(r.Context())
				if !ok || p.Tenant.ID != "tenant-1" || !HasPermission(r.Context(), "sales:read") || r.Context().Value(marker{}) != "kept" {
					t.Fatal("missing request authority or context")
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			r := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
			r.Header.Set("Authorization", header)
			r.Header.Set("X-Tenant-ID", "attacker-tenant")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != http.StatusNoContent || calls != 1 {
				t.Fatalf("status=%d calls=%d", w.Code, calls)
			}
			if _, ok := PrincipalFromContext(r.Context()); ok {
				t.Fatal("original request mutated")
			}
		})
	}
}

func TestMiddlewareRejectsMalformedHeaders(t *testing.T) {
	headers := [][]string{
		nil, {""}, {"Basic abc"}, {"Bearer"}, {"Bearer "}, {"Bearer  abc"}, {" Bearer abc"},
		{"Bearer abc "}, {"Bearer abc\tdef"}, {"Bearer abc,def"}, {"Bearer ☃"},
		{"Bearer ="}, {"Bearer ab=c"}, {"Bearer abc", "Bearer def"}, {"Bearer " + strings.Repeat("a", 8192)},
	}
	for i, values := range headers {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			middleware, err := NewMiddleware(verifierFunc(func(context.Context, string) (Principal, error) {
				t.Fatal("verifier called for malformed input")
				return Principal{}, nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodGet, "/?access_token=ignored", nil)
			for _, value := range values {
				r.Header.Add("Authorization", value)
			}
			r.AddCookie(&http.Cookie{Name: "access_token", Value: "ignored"})
			w := httptest.NewRecorder()
			middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unauthorized handler called") })).ServeHTTP(w, r)
			if w.Code != http.StatusUnauthorized || w.Header().Get("WWW-Authenticate") == "" {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
}

func TestMiddlewareVerifierFailures(t *testing.T) {
	for _, tc := range []struct {
		name      string
		principal Principal
		err       error
		status    int
	}{
		{"invalid", Principal{}, fmt.Errorf("private-token: %w", ErrInvalidToken), 401},
		{"expired", Principal{}, fmt.Errorf("private-token: %w", ErrExpiredToken), 401},
		{"unavailable", Principal{}, errors.New("private-token database password"), 503},
		{"cancelled", Principal{}, context.Canceled, 503},
		{"missing identity", Principal{Tenant: Tenant{ID: "tenant"}}, nil, 503},
		{"missing tenant", Principal{Identity: Identity{ID: "user"}}, nil, 503},
		{"principal with rejection", testPrincipal(), ErrInvalidToken, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			middleware, err := NewMiddleware(verifierFunc(func(context.Context, string) (Principal, error) { return tc.principal, tc.err }))
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.Header.Set("Authorization", "Bearer private-token")
			w := httptest.NewRecorder()
			w.Header().Set("X-Request-ID", "server-request-id")
			middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("handler called on failure") })).ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d, want %d", w.Code, tc.status)
			}
			if strings.Contains(w.Body.String(), "private-token") || strings.Contains(w.Body.String(), "password") {
				t.Fatal("error leaks secrets")
			}
			var body struct {
				Code      string `json:"code"`
				RequestID string `json:"request_id"`
				Retryable bool   `json:"retryable"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Code == "" || body.RequestID != "server-request-id" || body.Retryable != (tc.status == 503) || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("incorrect error envelope")
			}
		})
	}
}

func TestMiddlewareNilVerifier(t *testing.T) {
	if middleware, err := NewMiddleware(nil); err == nil || middleware != nil {
		t.Fatal("nil verifier accepted")
	}
}

func TestMiddlewareHead(t *testing.T) {
	middleware, err := NewMiddleware(verifierFunc(func(context.Context, string) (Principal, error) { return Principal{}, ErrInvalidToken }))
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("handler called") })).ServeHTTP(w, httptest.NewRequest(http.MethodHead, "/", nil))
	if w.Code != 401 || w.Body.Len() != 0 {
		t.Fatal("HEAD must return status without body")
	}
}
