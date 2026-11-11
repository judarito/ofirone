package httpapi

import (
	"encoding/json"
	"net/http"
	"ofirone/backend-go/internal/auth"
)

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		WriteError(w, r, 503, "AUTH_UNAVAILABLE", "Autenticación temporalmente no disponible.", true)
		return
	}
	var req struct {
		Email    string `json:"email"`
		TenantID string `json:"tenant_id"`
		Password string `json:"password"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	result, err := s.auth.Login(r.Context(), req.Email, auth.TenantID(req.TenantID), req.Password)
	if err != nil {
		WriteError(w, r, 401, "AUTHENTICATION_FAILED", "Credenciales inválidas.", false)
		return
	}
	writeJSON(w, r, 200, result)
}
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		WriteError(w, r, 503, "AUTH_UNAVAILABLE", "Autenticación temporalmente no disponible.", true)
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	result, err := s.auth.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		WriteError(w, r, 401, "AUTHENTICATION_FAILED", "Refresh token inválido.", false)
		return
	}
	writeJSON(w, r, 200, result)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.auth == nil {
		WriteError(w, r, 503, "AUTH_UNAVAILABLE", "Autenticación temporalmente no disponible.", true)
		return
	}
	var req struct {
		SessionID string `json:"session_id"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req)
	if req.SessionID == "" {
		WriteError(w, r, 400, "INVALID_SESSION", "Sesión inválida.", false)
		return
	}
	if err := s.auth.Logout(r.Context(), req.SessionID, auth.TenantID(p.Tenant.ID)); err != nil {
		WriteError(w, r, 400, "INVALID_SESSION", "Sesión inválida.", false)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
