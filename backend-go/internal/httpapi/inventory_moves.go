package httpapi

import (
	"context"
	"net/http"
	"ofirone/backend-go/internal/auth"
	"strconv"
)

const inventoryMoveTypeContextKey = "ofirone.inventory.move_type"

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
	afterAt := r.URL.Query().Get("after_occurred_at")
	afterID := r.URL.Query().Get("after_id")
	if (afterAt == "") != (afterID == "") {
		WriteError(w, r, 400, "INVALID_PAGINATION", "El cursor debe incluir fecha e identificador.", false)
		return
	}

	ctx := r.Context()
	if moveType := r.URL.Query().Get("move_type"); moveType != "" {
		ctx = context.WithValue(ctx, inventoryMoveTypeContextKey, moveType)
	}
	p, e := s.inventory.ListMoves(ctx, string(t.ID), r.URL.Query().Get("location_id"), r.URL.Query().Get("variant_id"), n, afterAt, afterID)
	if e != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, p)
}
