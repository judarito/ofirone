package httpapi

import (
	"encoding/json"
	"net/http"
)

// ErrorResponse is the public HTTP error contract. Internal errors and
// connection strings must never be passed as Message or Details.
type ErrorResponse struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   any    `json:"details"`
	RequestID string `json:"request_id"`
	Retryable bool   `json:"retryable"`
}

func WriteError(w http.ResponseWriter, r *http.Request, status int, code, message string, retryable bool) {
	writeJSON(w, r, status, ErrorResponse{
		Code: code, Message: message, RequestID: RequestIDFromContext(r.Context()), Retryable: retryable,
	})
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, value any) {
	// Marshal before committing headers so an encoding failure still yields JSON.
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body, _ = json.Marshal(ErrorResponse{
			Code: "INTERNAL_ERROR", Message: "Error interno del servidor.",
			RequestID: RequestIDFromContext(r.Context()),
		})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(append(body, '\n'))
	}
}
