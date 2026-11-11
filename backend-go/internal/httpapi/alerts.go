package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"ofirone/backend-go/internal/alerts"
	"ofirone/backend-go/internal/auth"
)

func (s *Server) listAlerts(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "ALERTS_UNAVAILABLE", "Alertas temporalmente no disponibles.", true)
		return
	}
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Paginación inválida.", false)
			return
		}
		limit = n
	}
	var after *time.Time
	if raw := r.URL.Query().Get("after_created_at"); raw != "" {
		parsed, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			WriteError(w, r, 400, "INVALID_CURSOR", "Cursor inválido.", false)
			return
		}
		after = &parsed
	}
	page, err := s.alerts.List(r.Context(), alerts.Filter{TenantID: string(t.ID), AlertType: r.URL.Query().Get("alert_type"), AlertLevel: r.URL.Query().Get("alert_level"), Limit: limit, AfterCreatedAt: after, AfterID: r.URL.Query().Get("after_id")})
	if err != nil {
		WriteError(w, r, 503, "ALERTS_UNAVAILABLE", "Alertas temporalmente no disponibles.", true)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}
