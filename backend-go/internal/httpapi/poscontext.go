package httpapi

import (
	"net/http"

	"ofirone/backend-go/internal/auth"
)

func (s *Server) posContext(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.posContextStore == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "POS_CONTEXT_UNAVAILABLE", "Contexto POS no disponible.", true)
		return
	}
	value, err := s.posContextStore.Get(r.Context(), string(p.Tenant.ID), string(p.Identity.ID))
	if err != nil {
		WriteError(w, r, http.StatusInternalServerError, "POS_CONTEXT_FAILED", "No se pudo cargar el contexto POS.", true)
		return
	}
	writeJSON(w, r, http.StatusOK, value)
}
