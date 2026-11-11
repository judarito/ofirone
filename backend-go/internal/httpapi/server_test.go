package httpapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type pingFunc func(context.Context) error

func (f pingFunc) Ping(ctx context.Context) error { return f(ctx) }

func newTestServer(t *testing.T, db Pinger) *Server {
	t.Helper()
	s, err := New(Config{Service: "ofirone-api", Version: "1.0.0", Commit: "abc123", PingTimeout: 10 * time.Millisecond}, db)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func request(handler http.Handler, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func TestOperationalRoutes(t *testing.T) {
	s := newTestServer(t, pingFunc(func(context.Context) error { return nil }))
	for _, tc := range []struct {
		method, path string
		status       int
		code         string
	}{
		{"GET", "/healthz", 200, ""},
		{"GET", "/readyz", 200, ""},
		{"GET", "/api/v1/version", 200, ""},
		{"GET", "/api/v1/products", 401, "UNAUTHENTICATED"},
		{"GET", "/missing", 404, "NOT_FOUND"},
		{"GET", "/healthz/", 404, "NOT_FOUND"},
		{"POST", "/healthz", 405, "METHOD_NOT_ALLOWED"},
		{"DELETE", "/readyz", 405, "METHOD_NOT_ALLOWED"},
		{"PUT", "/api/v1/version", 405, "METHOD_NOT_ALLOWED"},
		{"HEAD", "/healthz", 200, ""},
		{"HEAD", "/readyz", 200, ""},
		{"HEAD", "/api/v1/version", 200, ""},
		{"HEAD", "/missing", 404, "NOT_FOUND"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			w := request(s.Handler(), tc.method, tc.path)
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if got := w.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
				t.Fatalf("Content-Type = %q", got)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("operational response must not be cached")
			}
			if w.Header().Get("X-Request-ID") == "" {
				t.Fatal("missing request ID")
			}
			if tc.status == 405 && w.Header().Get("Allow") != "GET, HEAD" {
				t.Fatal("missing Allow header")
			}
			if tc.method == "HEAD" {
				if w.Body.Len() != 0 {
					t.Fatal("HEAD must not return a body")
				}
				return
			}
			if !json.Valid(w.Body.Bytes()) {
				t.Fatal("response is not JSON")
			}
			if tc.code != "" {
				var result ErrorResponse
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result.Code != tc.code || result.RequestID != w.Header().Get("X-Request-ID") || result.Details != nil || result.Retryable {
					t.Fatalf("unexpected error: %+v", result)
				}
			}
		})
	}
	w := request(s.Handler(), "GET", "/api/v1/version")
	var version map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	if version["service"] != "ofirone-api" || version["version"] != "1.0.0" || version["commit"] != "abc123" {
		t.Fatalf("unexpected version: %v", version)
	}
}

func TestProtectedResponsesIncludeCORSHeaders(t *testing.T) {
	s, err := New(Config{
		Service:            "ofirone-api",
		CORSAllowedOrigins: []string{"http://127.0.0.1:5173"},
		AuthMiddleware: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			})
		},
	}, pingFunc(func(context.Context) error { return nil }))
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/products", nil)
	r.Header.Set("Origin", "http://127.0.0.1:5173")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestReadinessFailureRecoveryAndShutdown(t *testing.T) {
	var failing atomic.Bool
	var calls atomic.Int32
	failing.Store(true)
	s := newTestServer(t, pingFunc(func(context.Context) error {
		calls.Add(1)
		if failing.Load() {
			return errors.New("postgres://user:secret@internal-db")
		}
		return nil
	}))
	w := request(s.Handler(), "GET", "/readyz")
	if w.Code != 503 || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("unavailable response leaks details or has wrong status: %s", w.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 5 || result["code"] != "DEPENDENCY_UNAVAILABLE" || result["retryable"] != true || result["details"] != nil {
		t.Fatalf("unexpected error contract: %v", result)
	}
	if w := request(s.Handler(), "GET", "/healthz"); w.Code != 200 || calls.Load() != 1 {
		t.Fatal("liveness must not query the database")
	}
	failing.Store(false)
	if w := request(s.Handler(), "GET", "/readyz"); w.Code != 200 {
		t.Fatal("readiness did not recover")
	}
	s.BeginShutdown()
	if w := request(s.Handler(), "GET", "/readyz"); w.Code != 503 || calls.Load() != 2 {
		t.Fatal("shutdown must fail readiness without pinging")
	}
	if w := request(s.Handler(), "GET", "/healthz"); w.Code != 200 {
		t.Fatal("liveness must remain successful while draining")
	}
}

func TestReadinessDeadlineAndCancellation(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		s := newTestServer(t, pingFunc(func(ctx context.Context) error {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("Ping must receive a deadline")
			}
			<-ctx.Done()
			return ctx.Err()
		}))
		r := httptest.NewRequest("GET", "/readyz", nil)
		ctx, cancel := context.WithCancel(r.Context())
		if canceled {
			cancel()
		}
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r.WithContext(ctx))
		cancel()
		if w.Code != 503 {
			t.Fatalf("readiness = %d, want 503", w.Code)
		}
	}
}

func TestShutdownDuringPing(t *testing.T) {
	var s *Server
	s = newTestServer(t, pingFunc(func(context.Context) error {
		s.BeginShutdown()
		return nil
	}))
	if w := request(s.Handler(), "GET", "/readyz"); w.Code != 503 {
		t.Fatal("probe must recheck shutdown after Ping")
	}
}

func TestNilDatabaseAndConfiguration(t *testing.T) {
	s := newTestServer(t, nil)
	if w := request(s.Handler(), "GET", "/readyz"); w.Code != 503 {
		t.Fatal("nil database must not be ready")
	}
	if _, err := New(Config{PingTimeout: -time.Second}, nil); err == nil {
		t.Fatal("negative timeout accepted")
	}
	s, err := New(Config{}, nil)
	if err != nil || s.http.ReadHeaderTimeout <= 0 || s.http.IdleTimeout <= 0 || s.config.Version == "" {
		t.Fatalf("missing defaults: server=%+v err=%v", s, err)
	}
}

func TestRequestIDIsUniqueAndAvailableInContext(t *testing.T) {
	seen := make(map[string]bool)
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if RequestIDFromContext(r.Context()) != w.Header().Get("X-Request-ID") {
			t.Error("context and response IDs differ")
		}
	}))
	for i := 0; i < 20; i++ {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-Request-ID", "untrusted-client-value")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		id := w.Header().Get("X-Request-ID")
		if raw, err := hex.DecodeString(id); err != nil || len(raw) != 16 || seen[id] {
			t.Fatalf("invalid or repeated request ID: %q", id)
		}
		seen[id] = true
	}
	if RequestIDFromContext(context.Background()) != "" {
		t.Fatal("context without ID must return empty string")
	}
}
