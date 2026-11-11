package config

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func reader(overrides map[string]string) func(string) string {
	return func(key string) string {
		if v, ok := overrides[key]; ok {
			return v
		}
		if key == "DATABASE_URL" {
			return "postgres://app:private-password@localhost:5432/ofirone?sslmode=disable"
		}
		return ""
	}
}

func TestDefaults(t *testing.T) {
	c, err := LoadFrom(reader(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Environment != "development" || c.Port != 8080 || c.LogLevel != slog.LevelInfo || len(c.CORSAllowedOrigins) != 0 || c.DBMaxConns != 10 || c.HTTPMaxBodyBytes != 1048576 {
		t.Fatal("unexpected defaults")
	}
	if c.HTTPReadHeaderTimeout != 5*time.Second || c.HTTPReadTimeout != 15*time.Second || c.HTTPWriteTimeout != 30*time.Second || c.HTTPIdleTimeout != time.Minute || c.ShutdownTimeout != 15*time.Second || c.DBPingTimeout != time.Second {
		t.Fatal("unexpected timeout defaults")
	}
}

func TestOverrides(t *testing.T) {
	c, err := LoadFrom(reader(map[string]string{
		"APP_ENV": "production", "PORT": "9000", "LOG_LEVEL": "DEBUG",
		"DATABASE_URL":             "postgresql://app:secret@db:5433/main?sslmode=require",
		"CORS_ALLOWED_ORIGINS":     "https://app.example.com, http://localhost:5173,https://app.example.com",
		"HTTP_READ_HEADER_TIMEOUT": "2s", "HTTP_READ_TIMEOUT": "10s",
		"HTTP_WRITE_TIMEOUT": "20s", "HTTP_IDLE_TIMEOUT": "90s",
		"HTTP_MAX_BODY_BYTES": "2048", "SHUTDOWN_TIMEOUT": "8s",
		"DB_PING_TIMEOUT": "500ms", "DB_MAX_CONNS": "20",
		"JWT_ISSUER": "https://issuer.example", "JWT_AUDIENCE": "ofirone-api",
		"JWT_ALGORITHM": "HS256", "JWT_HMAC_KEY": strings.Repeat("k", 32),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Environment != "production" || c.Port != 9000 || c.LogLevel != slog.LevelDebug || c.DBMaxConns != 20 || c.HTTPMaxBodyBytes != 2048 || len(c.CORSAllowedOrigins) != 2 || c.DBPingTimeout != 500*time.Millisecond || c.HTTPReadHeaderTimeout != 2*time.Second || c.HTTPReadTimeout != 10*time.Second || c.HTTPWriteTimeout != 20*time.Second || c.HTTPIdleTimeout != 90*time.Second || c.ShutdownTimeout != 8*time.Second || c.JWTIssuer != "https://issuer.example" || c.JWTAudience != "ofirone-api" || c.JWTAlgorithm != "HS256" || len(c.JWTHMACKey) != 32 {
		t.Fatal("overrides not applied")
	}
}

func TestInvalidJWTConfiguration(t *testing.T) {
	for key, value := range map[string]string{
		"JWT_ISSUER":    "https://issuer.example",
		"JWT_AUDIENCE":  "ofirone-api",
		"JWT_ALGORITHM": "HS256",
		"JWT_HMAC_KEY":  strings.Repeat("k", 31),
	} {
		_, err := LoadFrom(reader(map[string]string{key: value}))
		if err == nil || !strings.Contains(err.Error(), "JWT_") {
			t.Fatalf("expected JWT validation error for %s", key)
		}
	}
}

func TestInvalidConfiguration(t *testing.T) {
	cases := map[string][]string{
		"APP_ENV":                  {"unknown"},
		"PORT":                     {"0", "-1", "65536", "text"},
		"DATABASE_URL":             {"", "https://db/main", "postgres://db", "postgres:///main", "postgres://db:99999/main", "postgres://user:secret%zz@db/main", "postgres://db/main#fragment"},
		"LOG_LEVEL":                {"trace", "INFO+1"},
		"CORS_ALLOWED_ORIGINS":     {"*", "https://*.example.com", "https://example.com/", "https://example.com/path", "https://u:secret@example.com", "https://example.com?x=1", "https://example.com#x", "https://example.com,", "http://localhost:99999"},
		"HTTP_READ_HEADER_TIMEOUT": {"0s", "-1s", "broken", "16s"},
		"HTTP_READ_TIMEOUT":        {"0s", "-1s", "broken"},
		"HTTP_WRITE_TIMEOUT":       {"0s", "-1s", "broken"},
		"HTTP_IDLE_TIMEOUT":        {"0s", "-1s", "broken"},
		"SHUTDOWN_TIMEOUT":         {"0s", "-1s", "broken"},
		"DB_PING_TIMEOUT":          {"0s", "-1s", "broken"},
		"HTTP_MAX_BODY_BYTES":      {"0", "-1", "broken", "9223372036854775808"},
		"DB_MAX_CONNS":             {"0", "-1", "broken", "2147483648"},
	}
	for key, values := range cases {
		for _, value := range values {
			t.Run(key+"/"+value, func(t *testing.T) {
				_, err := LoadFrom(reader(map[string]string{key: value}))
				if err == nil || !strings.Contains(err.Error(), key) {
					t.Fatalf("expected variable-specific validation error for %s", key)
				}
				if strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "private-password") {
					t.Fatal("error leaked a secret")
				}
			})
		}
	}
}

func TestEnvironmentAndLevelValues(t *testing.T) {
	for _, env := range []string{"development", "test", "staging", "production"} {
		for name, level := range map[string]slog.Level{"debug": slog.LevelDebug, "info": slog.LevelInfo, "warn": slog.LevelWarn, "error": slog.LevelError} {
			c, err := LoadFrom(reader(map[string]string{"APP_ENV": env, "LOG_LEVEL": name}))
			if err != nil || c.Environment != env || c.LogLevel != level {
				t.Fatalf("invalid environment/level handling: %s/%s", env, name)
			}
		}
	}
}

func TestLoadFromNilReader(t *testing.T) {
	if _, err := LoadFrom(nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestConfigStructuredLoggingExcludesDatabaseURL(t *testing.T) {
	c, err := LoadFrom(reader(nil))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("configuration loaded", "config", c)
	if !json.Valid(bytes.TrimSpace(buf.Bytes())) || strings.Contains(buf.String(), "private-password") || strings.Contains(buf.String(), "postgres://") {
		t.Fatal("configuration log is invalid or contains credentials")
	}
}
