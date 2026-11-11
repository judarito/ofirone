package logging

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
)

func testOptions() Options {
	return Options{Service: "ofirone-api", Environment: "test", Version: "test-build", Level: slog.LevelInfo}
}

func decode(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var record map[string]any
	if err := json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestJSONMetadataAndLevelFiltering(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, testOptions())
	logger.Debug("filtered")
	if buf.Len() != 0 {
		t.Fatal("debug message was not filtered")
	}
	logger.Info("request completed", "method", "GET", "route", "/healthz", "status", 200, "duration_ms", 2)
	r := decode(t, buf.Bytes())
	for key, want := range map[string]any{
		"service": "ofirone-api", "environment": "test", "version": "test-build",
		"level": "INFO", "msg": "request completed", "method": "GET",
		"route": "/healthz", "status": float64(200), "duration_ms": float64(2),
	} {
		if r[key] != want {
			t.Errorf("%s = %v, want %v", key, r[key], want)
		}
	}
	if r["time"] == nil {
		t.Fatal("missing timestamp")
	}
}

func TestRequestIDsAreScopedToContext(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, testOptions()).With("component", "http")
	ctx := WithRequestIDs(context.Background(), "request-1", "correlation_1.2")
	logger.InfoContext(ctx, "first")
	logger.InfoContext(context.Background(), "second")
	scanner := bufio.NewScanner(&buf)
	if !scanner.Scan() {
		t.Fatal("missing first log")
	}
	first := decode(t, scanner.Bytes())
	if first["request_id"] != "request-1" || first["correlation_id"] != "correlation_1.2" || first["component"] != "http" {
		t.Fatal("missing context IDs or static attributes")
	}
	if !scanner.Scan() {
		t.Fatal("missing second log")
	}
	second := decode(t, scanner.Bytes())
	if second["request_id"] != nil || second["correlation_id"] != nil {
		t.Fatal("request IDs leaked between contexts")
	}
	if scanner.Scan() || scanner.Err() != nil {
		t.Fatal("unexpected log output")
	}
}

func TestInvalidIDsAreOmitted(t *testing.T) {
	for _, id := range []string{"", "line\nbreak", "space here", strings.Repeat("a", 129), "á", "token=secret"} {
		t.Run(id, func(t *testing.T) {
			var buf bytes.Buffer
			ctx := WithRequestIDs(context.Background(), id, id)
			New(&buf, testOptions()).ErrorContext(ctx, "operation failed")
			r := decode(t, buf.Bytes())
			if r["request_id"] != nil || r["correlation_id"] != nil {
				t.Fatal("invalid ID emitted")
			}
		})
	}
}

func TestRedactionWithDerivedLoggersAndGroups(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, testOptions()).With("Authorization", "private-one")
	logger.WithGroup("http").With("Cookie", "private-two").Info("request",
		slog.Group("credentials", "database_url", "private-three", "refresh_token", "private-four"),
		"status", 200,
	)
	if strings.Contains(buf.String(), "private-") {
		t.Fatal("sensitive attribute escaped redaction")
	}
	r := decode(t, buf.Bytes())
	if r["Authorization"] != "[REDACTED]" {
		t.Fatal("static attribute not redacted")
	}
	http := r["http"].(map[string]any)
	credentials := http["credentials"].(map[string]any)
	if http["Cookie"] != "[REDACTED]" || credentials["database_url"] != "[REDACTED]" || credentials["refresh_token"] != "[REDACTED]" || http["status"] != float64(200) {
		t.Fatal("incorrect grouping or redaction")
	}
}

func TestConcurrentContexts(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, testOptions())
	var wg sync.WaitGroup
	for _, id := range []string{"first", "second", "third", "fourth"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			ctx := WithRequestIDs(context.Background(), id, id)
			logger.InfoContext(ctx, "completed", "expected_id", id)
		}(id)
	}
	wg.Wait()
	scanner := bufio.NewScanner(&buf)
	count := 0
	for scanner.Scan() {
		r := decode(t, scanner.Bytes())
		if r["request_id"] != r["expected_id"] || r["correlation_id"] != r["expected_id"] {
			t.Fatal("concurrent contexts contaminated each other")
		}
		count++
	}
	if scanner.Err() != nil || count != 4 {
		t.Fatal("incomplete concurrent output")
	}
}

func TestMinimumLevelAndDefaultLoggerIsolation(t *testing.T) {
	var buf bytes.Buffer
	before := slog.Default()
	opts := testOptions()
	opts.Level = slog.LevelError
	logger := New(&buf, opts)
	logger.Warn("filtered")
	if buf.Len() != 0 {
		t.Fatal("warn message was not filtered")
	}
	logger.Error("failure")
	if decode(t, buf.Bytes())["level"] != "ERROR" || slog.Default() != before {
		t.Fatal("incorrect severity or global logger modified")
	}
}
