package httpapi

import (
	"net/http"
	"ofirone/backend-go/internal/auth"
	"strconv"
)

func (s *Server) listInventoryAlerts(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	n := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		x, e := strconv.Atoi(v)
		if e != nil || x < 1 || x > 500 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Paginación inválida.", false)
			return
		}
		n = x
	}
	a, e := s.inventory.ListAlerts(r.Context(), string(t.ID), n)
	if e != nil {
		WriteError(w, r, 503, "ALERTS_UNAVAILABLE", "Alertas temporalmente no disponibles.", true)
		return
	}
	writeJSON(w, r, 200, map[string]any{"items": a, "has_more": false})
}
