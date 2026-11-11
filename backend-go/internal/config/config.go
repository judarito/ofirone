// Package config loads process configuration from environment variables.
// It does not load dotenv files: the deployment supplies the environment.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is immutable after startup. DatabaseURL contains credentials and must
// never be logged. Each process receives only its own environment's connection.
type Config struct {
	Environment           string
	Port                  int
	DatabaseURL           string
	AuthDatabaseURL       string
	LogLevel              slog.Level
	CORSAllowedOrigins    []string
	HTTPReadHeaderTimeout time.Duration
	HTTPReadTimeout       time.Duration
	HTTPWriteTimeout      time.Duration
	HTTPIdleTimeout       time.Duration
	HTTPMaxBodyBytes      int64
	ShutdownTimeout       time.Duration
	DBPingTimeout         time.Duration
	DBMaxConns            int32
	WorkerID              string
	WorkerTenantID        string
	WorkerPoll            time.Duration
	WorkerConcurrency     int
	JWTIssuer             string
	JWTAudience           string
	JWTAlgorithm          string
	JWTHMACKey            []byte
}

// Load reads the current process environment.
func Load() (Config, error) { return LoadFrom(os.Getenv) }

// LoadFrom permits deterministic tests without mutating the process environment.
// An empty optional variable uses its default. Errors name the variable but
// deliberately discard parser errors, which may include credentials.
func LoadFrom(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, fmt.Errorf("configuration: environment reader is required")
	}
	value := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	invalid := func(key string) (Config, error) {
		return Config{}, fmt.Errorf("configuration: invalid or missing %s", key)
	}
	c := Config{Environment: value("APP_ENV", "development")}
	switch c.Environment {
	case "development", "test", "staging", "production":
	default:
		return invalid("APP_ENV")
	}
	port, err := strconv.Atoi(value("PORT", "8080"))
	if err != nil || port < 1 || port > 65535 {
		return invalid("PORT")
	}
	c.Port = port
	c.DatabaseURL = value("DATABASE_URL", "")
	u, err := url.Parse(c.DatabaseURL)
	if err != nil || u == nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || strings.Trim(u.Path, "/") == "" || u.Fragment != "" {
		return invalid("DATABASE_URL")
	}
	if p := u.Port(); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > 65535 {
			return invalid("DATABASE_URL")
		}
	}
	c.AuthDatabaseURL = value("AUTH_DATABASE_URL", c.DatabaseURL)
	authURL, err := url.Parse(c.AuthDatabaseURL)
	if err != nil || authURL == nil || (authURL.Scheme != "postgres" && authURL.Scheme != "postgresql") || authURL.Hostname() == "" || strings.Trim(authURL.Path, "/") == "" || authURL.Fragment != "" {
		return invalid("AUTH_DATABASE_URL")
	}
	switch strings.ToLower(value("LOG_LEVEL", "info")) {
	case "debug":
		c.LogLevel = slog.LevelDebug
	case "info":
		c.LogLevel = slog.LevelInfo
	case "warn":
		c.LogLevel = slog.LevelWarn
	case "error":
		c.LogLevel = slog.LevelError
	default:
		return invalid("LOG_LEVEL")
	}
	seen := make(map[string]bool)
	if origins := value("CORS_ALLOWED_ORIGINS", ""); origins != "" {
		for _, origin := range strings.Split(origins, ",") {
			origin = strings.TrimSpace(origin)
			u, err := url.Parse(origin)
			if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(u.Host, "*") {
				return invalid("CORS_ALLOWED_ORIGINS")
			}
			if p := u.Port(); p != "" {
				n, err := strconv.Atoi(p)
				if err != nil || n < 1 || n > 65535 {
					return invalid("CORS_ALLOWED_ORIGINS")
				}
			}
			if !seen[origin] {
				c.CORSAllowedOrigins = append(c.CORSAllowedOrigins, origin)
				seen[origin] = true
			}
		}
	}
	for _, field := range []struct {
		key      string
		fallback string
		target   *time.Duration
	}{
		{"HTTP_READ_HEADER_TIMEOUT", "5s", &c.HTTPReadHeaderTimeout},
		{"HTTP_READ_TIMEOUT", "15s", &c.HTTPReadTimeout},
		{"HTTP_WRITE_TIMEOUT", "30s", &c.HTTPWriteTimeout},
		{"HTTP_IDLE_TIMEOUT", "60s", &c.HTTPIdleTimeout},
		{"SHUTDOWN_TIMEOUT", "15s", &c.ShutdownTimeout},
		{"DB_PING_TIMEOUT", "1s", &c.DBPingTimeout},
	} {
		d, err := time.ParseDuration(value(field.key, field.fallback))
		if err != nil || d <= 0 {
			return invalid(field.key)
		}
		*field.target = d
	}
	if c.HTTPReadHeaderTimeout > c.HTTPReadTimeout {
		return invalid("HTTP_READ_HEADER_TIMEOUT")
	}
	c.HTTPMaxBodyBytes, err = strconv.ParseInt(value("HTTP_MAX_BODY_BYTES", "1048576"), 10, 64)
	if err != nil || c.HTTPMaxBodyBytes <= 0 {
		return invalid("HTTP_MAX_BODY_BYTES")
	}
	conns, err := strconv.ParseInt(value("DB_MAX_CONNS", "10"), 10, 32)
	if err != nil || conns <= 0 {
		return invalid("DB_MAX_CONNS")
	}
	c.DBMaxConns = int32(conns)
	c.WorkerID = value("WORKER_ID", "ofirone-worker")
	c.WorkerTenantID = strings.TrimSpace(getenv("WORKER_TENANT_ID"))
	poll, err := time.ParseDuration(value("WORKER_POLL", "1s"))
	if err != nil || poll <= 0 {
		return invalid("WORKER_POLL")
	}
	c.WorkerPoll = poll
	concurrency, err := strconv.Atoi(value("WORKER_CONCURRENCY", "4"))
	if err != nil || concurrency < 1 || concurrency > 100 {
		return invalid("WORKER_CONCURRENCY")
	}
	c.WorkerConcurrency = concurrency
	jwtIssuer := strings.TrimSpace(getenv("JWT_ISSUER"))
	jwtAudience := strings.TrimSpace(getenv("JWT_AUDIENCE"))
	jwtAlgorithm := strings.TrimSpace(getenv("JWT_ALGORITHM"))
	jwtKey := getenv("JWT_HMAC_KEY")
	if jwtIssuer != "" || jwtAudience != "" || jwtAlgorithm != "" || jwtKey != "" {
		if jwtIssuer == "" || jwtAudience == "" || jwtKey == "" {
			return invalid("JWT_ISSUER/JWT_AUDIENCE/JWT_HMAC_KEY")
		}
		minimum := map[string]int{"HS256": 32, "HS384": 48, "HS512": 64}[jwtAlgorithm]
		if minimum == 0 || len([]byte(jwtKey)) < minimum {
			return invalid("JWT_ALGORITHM/JWT_HMAC_KEY")
		}
		c.JWTIssuer, c.JWTAudience, c.JWTAlgorithm = jwtIssuer, jwtAudience, jwtAlgorithm
		c.JWTHMACKey = []byte(jwtKey)
	}
	return c, nil
}

// LogValue allows safe slog logging of Config without exposing the connection.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("environment", c.Environment),
		slog.Int("port", c.Port),
		slog.String("log_level", c.LogLevel.String()),
		slog.Int64("db_max_conns", int64(c.DBMaxConns)),
	)
}
