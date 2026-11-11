package httpapi

import (
	"net/http"
	"ofirone/backend-go/internal/auth"
)

func (s *Server) getPurchase(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	d, e := s.purchases.Get(r.Context(), string(p.Tenant.ID), id)
	if e != nil {
		WriteError(w, r, 404, "PURCHASE_NOT_FOUND", "Compra no encontrada.", false)
		return
	}
	writeJSON(w, r, 200, d)
}
func (s *Server) cancelPurchase(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if e := s.purchases.Cancel(r.Context(), string(p.Tenant.ID), id); e != nil {
		WriteError(w, r, 422, "PURCHASE_NOT_CANCELLABLE", "Compra no cancelable.", false)
		return
	}
	writeJSON(w, r, 200, map[string]any{"id": id, "status": "cancelled"})
}
