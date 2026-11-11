package httpapi

import (
	"encoding/json"
	"net/http"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/suppliers"
	"strconv"
)

func (s *Server) listSuppliers(w http.ResponseWriter, r *http.Request) {
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
	p, e := s.suppliers.List(r.Context(), string(t.ID), n, r.URL.Query().Get("after_id"))
	if e != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, p)
}
func (s *Server) createSupplier(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var v suppliers.Supplier
	if json.NewDecoder(r.Body).Decode(&v) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "JSON inválido.", false)
		return
	}
	v.TenantID = string(t.ID)
	if e := s.suppliers.Create(r.Context(), v); e != nil {
		WriteError(w, r, 422, "INVALID_SUPPLIER", "Proveedor inválido.", false)
		return
	}
	writeJSON(w, r, 201, v)
}
