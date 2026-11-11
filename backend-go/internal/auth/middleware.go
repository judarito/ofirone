package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// NewMiddleware constructs mandatory Bearer authentication. Wrap public routes
// separately. A nil verifier is a startup error, never anonymous access.
func NewMiddleware(verifier TokenVerifier) (func(http.Handler) http.Handler, error) {
	if verifier == nil {
		return nil, errors.New("auth: token verifier is required")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				writeAuthError(w, r, http.StatusUnauthorized)
				return
			}
			principal, err := verifier.Verify(r.Context(), token)
			if err != nil {
				status := http.StatusServiceUnavailable
				if errors.Is(err, ErrInvalidToken) || errors.Is(err, ErrExpiredToken) {
					status = http.StatusUnauthorized
				}
				writeAuthError(w, r, status)
				return
			}
			ctx, err := WithPrincipal(r.Context(), principal)
			if err != nil {
				writeAuthError(w, r, http.StatusServiceUnavailable)
				return
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}, nil
}

func bearerToken(r *http.Request) (string, bool) {
	values := r.Header.Values("Authorization")
	if len(values) != 1 || len(values[0]) > 8192 {
		return "", false
	}
	// Require one space and the RFC 6750 b64token alphabet. Opaque tokens are
	// supported; parsing a JWT belongs to the verifier implementation.
	scheme, token, found := strings.Cut(values[0], " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	padding := false
	for _, c := range token {
		if c == '=' {
			padding = true
			continue
		}
		if padding || !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-._~+/", c)) {
			return "", false
		}
	}
	return token, token[0] != '='
}

func writeAuthError(w http.ResponseWriter, r *http.Request, status int) {
	code, message := "UNAUTHENTICATED", "Autenticación requerida."
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", `Bearer realm="api"`)
	} else {
		code, message = "AUTH_UNAVAILABLE", "Autenticación temporalmente no disponible."
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			Details   any    `json:"details"`
			RequestID string `json:"request_id"`
			Retryable bool   `json:"retryable"`
		}{code, message, nil, w.Header().Get("X-Request-ID"), status == http.StatusServiceUnavailable})
	}
}
