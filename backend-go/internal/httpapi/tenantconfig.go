package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/tenantconfig"
)

func (s *Server) handleTenantConfig(w http.ResponseWriter, r *http.Request, kind string) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.tenantConfig == nil {
		WriteError(w, r, 503, "TENANT_CONFIG_UNAVAILABLE", "Configuración temporalmente no disponible.", true)
		return
	}
	id := string(t.ID)
	if kind == "billing" {
		v, e := s.tenantConfig.GetBillingSummary(r.Context(), id)
		if e != nil {
			tenantConfigError(w, r, e)
			return
		}
		writeJSON(w, r, 200, v)
		return
	}
	if r.Method == http.MethodGet {
		v, e := s.tenantConfig.GetSettings(r.Context(), id)
		if errors.Is(e, tenantconfig.ErrNotFound) {
			writeJSON(w, r, 200, map[string]any{})
			return
		}
		if e != nil {
			tenantConfigError(w, r, e)
			return
		}
		writeJSON(w, r, 200, v)
		return
	}
	if r.Method == http.MethodPut || r.Method == http.MethodPatch {
		var v tenantconfig.Settings
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&v) != nil {
			WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
			return
		}
		v.TenantID = id
		out, e := s.tenantConfig.SaveSettings(r.Context(), id, v)
		if e != nil {
			tenantConfigError(w, r, e)
			return
		}
		writeJSON(w, r, 200, out)
		return
	}
	w.Header().Set("Allow", "GET, PUT, PATCH")
	WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
}
func tenantConfigError(w http.ResponseWriter, r *http.Request, e error) {
	if errors.Is(e, tenantconfig.ErrInvalid) {
		WriteError(w, r, 422, "INVALID_TENANT_CONFIG", "Configuración inválida.", false)
		return
	}
	if errors.Is(e, tenantconfig.ErrNotFound) {
		WriteError(w, r, 404, "TENANT_CONFIG_NOT_FOUND", "Configuración no encontrada.", false)
		return
	}
	WriteError(w, r, 503, "TENANT_CONFIG_UNAVAILABLE", "Configuración temporalmente no disponible.", true)
}
