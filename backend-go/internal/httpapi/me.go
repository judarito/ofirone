package httpapi

import (
	"net/http"
	"ofirone/backend-go/internal/auth"
)

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, struct {
		IdentityID  string            `json:"identity_id"`
		TenantID    string            `json:"tenant_id"`
		Permissions []auth.Permission `json:"permissions"`
	}{string(p.Identity.ID), string(p.Tenant.ID), p.Permissions})
}
