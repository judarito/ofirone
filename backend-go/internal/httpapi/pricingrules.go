package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/pricingrules"
)

func (s *Server) pricingRuleRoute(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.pricingRules == nil {
		WriteError(w, r, 503, "PRICING_RULES_UNAVAILABLE", "Reglas de precio temporalmente no disponibles.", true)
		return
	}
	base := "/api/v1/pricing-rules"
	id := strings.TrimPrefix(r.URL.Path, base)
	if id != "" && !strings.HasPrefix(id, "/") {
		http.NotFound(w, r)
		return
	}
	id = strings.TrimPrefix(id, "/")
	if strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		if id != "" {
			WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		page, size := 1, 50
		var e error
		if v := r.URL.Query().Get("page"); v != "" {
			page, e = strconv.Atoi(v)
			if e != nil {
				page = 0
			}
		}
		if v := r.URL.Query().Get("page_size"); v != "" {
			size, e = strconv.Atoi(v)
			if e != nil {
				size = 0
			}
		}
		var active *bool
		if v := r.URL.Query().Get("is_active"); v != "" {
			b, er := strconv.ParseBool(v)
			if er != nil {
				WriteError(w, r, 400, "INVALID_REQUEST", "Filtro inválido.", false)
				return
			}
			active = &b
		}
		out, er := s.pricingRules.List(r.Context(), string(t.ID), page, size, r.URL.Query().Get("scope"), active)
		if er != nil {
			pricingRuleError(w, r, er)
			return
		}
		writeJSON(w, r, 200, out)
	case http.MethodPost, http.MethodPatch:
		create := r.Method == http.MethodPost
		if create && id != "" || !create && id == "" {
			WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		var rule pricingrules.Rule
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
		d.DisallowUnknownFields()
		if d.Decode(&rule) != nil {
			WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
			return
		}
		if rule.ID != "" || rule.TenantID != "" {
			WriteError(w, r, 400, "INVALID_REQUEST", "La identidad y el tenant provienen de la sesión.", false)
			return
		}
		var out pricingrules.Rule
		var e error
		if create {
			out, e = s.pricingRules.Create(r.Context(), string(t.ID), rule)
		} else {
			out, e = s.pricingRules.Update(r.Context(), string(t.ID), id, rule)
		}
		if e != nil {
			pricingRuleError(w, r, e)
			return
		}
		status := 200
		if create {
			status = 201
		}
		writeJSON(w, r, status, out)
	case http.MethodDelete:
		if id == "" {
			WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		if e := s.pricingRules.Delete(r.Context(), string(t.ID), id); e != nil {
			pricingRuleError(w, r, e)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, HEAD, POST, PATCH, DELETE")
		WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
	}
}
func pricingRuleError(w http.ResponseWriter, r *http.Request, e error) {
	if errors.Is(e, pricingrules.ErrInvalid) {
		WriteError(w, r, 422, "INVALID_PRICING_RULE", "Regla de precio inválida.", false)
		return
	}
	if errors.Is(e, pricingrules.ErrNotFound) {
		WriteError(w, r, 404, "PRICING_RULE_NOT_FOUND", "Regla de precio no encontrada.", false)
		return
	}
	WriteError(w, r, 503, "PRICING_RULES_UNAVAILABLE", "Reglas de precio temporalmente no disponibles.", true)
}
