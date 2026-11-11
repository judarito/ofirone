// Package logging provides JSON logs and request-scoped identifiers.
// Callers must use fixed messages and selected attributes: never log request
// bodies, raw URLs, query strings, cookies, tokens or connection errors directly.
package logging

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
)

// Options is independent of config to keep logging reusable by API and worker.
type Options struct {
	Service     string
	Environment string
	Version     string
	Level       slog.Level
}

// New writes one JSON object per line. A nil output selects stdout. It does not
// change the process-wide default logger. The caller owns the output lifetime;
// custom writers must support concurrent use when shared by separate loggers.
func New(output io.Writer, opts Options) *slog.Logger {
	if output == nil {
		output = os.Stdout
	}
	h := slog.NewJSONHandler(output, &slog.HandlerOptions{
		Level: opts.Level,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if sensitiveKey(a.Key) {
				return slog.String(a.Key, "[REDACTED]")
			}
			return a
		},
	})
	return slog.New(&contextHandler{next: h}).With(
		"service", opts.Service,
		"environment", opts.Environment,
		"version", opts.Version,
	)
}

func sensitiveKey(key string) bool {
	key = strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	switch key {
	case "authorization", "cookie", "set_cookie", "password", "passwd",
		"token", "access_token", "refresh_token", "secret", "client_secret",
		"api_key", "apikey", "database_url", "database_url_dev", "database_url_prod",
		"connection_string", "dsn", "request_body", "body", "query_string":
		return true
	default:
		return false
	}
}

type requestIDs struct {
	requestID     string
	correlationID string
}

type requestIDsKey struct{}

// WithRequestIDs attaches IDs for InfoContext/ErrorContext and other context
// logging methods. Invalid IDs are omitted. HTTP middleware remains responsible
// for generating a request ID and choosing a correlation fallback.
func WithRequestIDs(ctx context.Context, requestID, correlationID string) context.Context {
	ids := requestIDs{}
	if validID(requestID) {
		ids.requestID = requestID
	}
	if validID(correlationID) {
		ids.correlationID = correlationID
	}
	return context.WithValue(ctx, requestIDsKey{}, ids)
}

func validID(value string) bool {
	if len(value) == 0 || len(value) > 128 {
		return false
	}
	for _, c := range value {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' {
			continue
		}
		return false
	}
	return true
}

type contextHandler struct {
	next slog.Handler
}

func (h *contextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h *contextHandler) Handle(ctx context.Context, record slog.Record) error {
	if ids, ok := ctx.Value(requestIDsKey{}).(requestIDs); ok {
		record = record.Clone()
		if ids.requestID != "" {
			record.AddAttrs(slog.String("request_id", ids.requestID))
		}
		if ids.correlationID != "" {
			record.AddAttrs(slog.String("correlation_id", ids.correlationID))
		}
	}
	return h.next.Handle(ctx, record)
}

func (h *contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &contextHandler{next: h.next.WithAttrs(attrs)}
}

func (h *contextHandler) WithGroup(name string) slog.Handler {
	return &contextHandler{next: h.next.WithGroup(name)}
}
