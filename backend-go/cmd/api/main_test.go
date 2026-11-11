package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ofirone/backend-go/internal/config"
)

type pingFunc func(context.Context) error

func (f pingFunc) Ping(ctx context.Context) error { return f(ctx) }

func TestServerComposition(t *testing.T) {
	c, err := config.LoadFrom(func(key string) string {
		switch key {
		case "DATABASE_URL":
			return "postgresql://user:secret@localhost/test"
		case "DB_PING_TIMEOUT":
			return "250ms"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	called := false
	server, err := newServer(c, pingFunc(func(ctx context.Context) error {
		called = true
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 250*time.Millisecond {
			t.Error("configured Ping timeout was not propagated")
		}
		return nil
	}), nil, nil, nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	probe := func(path string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != status {
			t.Fatalf("%s: got %d, want %d", path, w.Code, status)
		}
		return w
	}
	probe("/healthz", http.StatusOK)
	if called {
		t.Fatal("liveness queried PostgreSQL")
	}
	probe("/readyz", http.StatusOK)
	if !called {
		t.Fatal("readiness did not use the injected pool")
	}
	w := probe("/api/v1/version", http.StatusOK)
	var metadata map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["version"] != version || metadata["commit"] != commit || metadata["service"] != "ofirone-api" {
		t.Fatalf("incorrect build metadata: %v", metadata)
	}
	server.BeginShutdown()
	probe("/readyz", http.StatusServiceUnavailable)
}
