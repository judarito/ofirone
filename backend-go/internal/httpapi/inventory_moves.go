package httpapi

import (
	"net/http"
	"ofirone/backend-go/internal/auth"
	"strconv"
)

func (s *Server) listInventoryMoves(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	n := 25
	if v := r.URL.Query().Get("limit"); v != "" {
		x, e := strconv.Atoi(v)
		if e != nil || x < 1 || x > 100 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Paginación inválida.", false)
			return
		}
		n = x
	}
	p, e := s.inventory.ListMoves(r.Context(), string(t.ID), r.URL.Query().Get("location_id"), r.URL.Query().Get("variant_id"), n, r.URL.Query().Get("after_occurred_at"), r.URL.Query().Get("after_id"))
	if e != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, p)
}
