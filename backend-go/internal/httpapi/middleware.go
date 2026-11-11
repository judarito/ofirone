package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

type requestIDKey struct{}

func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// RequestID generates an independent identifier for each request rather than
// trusting a client-supplied header. It must wrap Recover and other middleware.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err != nil {
			WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.", false)
			return
		}
		id := hex.EncodeToString(raw[:])
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

// Recover hides panic details. If a response is already committed it aborts the
// connection instead of appending an invalid second response. Unwrap preserves
// access to optional writer features via http.ResponseController (Go 1.20+).
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tracked := &responseWriter{ResponseWriter: w}
		defer func() {
			if value := recover(); value != nil {
				if value == http.ErrAbortHandler || tracked.committed {
					panic(http.ErrAbortHandler)
				}
				WriteError(tracked, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.", false)
			}
		}()
		next.ServeHTTP(tracked, r)
	})
}

type responseWriter struct {
	http.ResponseWriter
	committed bool
}

func (w *responseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *responseWriter) WriteHeader(status int) {
	if w.committed {
		return
	}
	// Informational responses do not commit the final response.
	if status >= 200 {
		w.committed = true
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseWriter) Write(body []byte) (int, error) {
	if !w.committed {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

// FlushError lets ResponseController flush while also recording commitment.
func (w *responseWriter) FlushError() error {
	if !w.committed {
		w.WriteHeader(http.StatusOK)
	}
	return http.NewResponseController(w.ResponseWriter).Flush()
}
