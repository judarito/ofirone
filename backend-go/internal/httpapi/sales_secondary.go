package httpapi

import (
	"net/http"
	"ofirone/backend-go/internal/auth"
)

func (s *Server) getSale(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	d, e := s.sales.Get(r.Context(), string(p.Tenant.ID), id)
	if e != nil {
		WriteError(w, r, 404, "SALE_NOT_FOUND", "Venta no encontrada.", false)
		return
	}
	writeJSON(w, r, 200, d)
}
func (s *Server) voidSale(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if e := s.sales.Void(r.Context(), string(p.Tenant.ID), id); e != nil {
		WriteError(w, r, 422, "SALE_NOT_VOIDABLE", "Venta no anulable.", false)
		return
	}
	writeJSON(w, r, 200, map[string]any{"id": id, "status": "voided"})
}
