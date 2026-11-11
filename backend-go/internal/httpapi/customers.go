package httpapi

import (
	"encoding/json"
	"net/http"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/customers"
	"strconv"
	"strings"
)

func (s *Server) customersHandler(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.customers == nil {
		WriteError(w, r, 503, "CUSTOMERS_UNAVAILABLE", "Clientes temporalmente no disponibles.", true)
		return
	}
	q := r.URL.Query()
	limit := 25
	if raw := q.Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		limit = n
	}
	p, e := s.customers.List(r.Context(), string(t.ID), limit, q.Get("after_created_at"), q.Get("after_id"))
	if e != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, p)
}
func (s *Server) createCustomer(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.customers == nil {
		WriteError(w, r, 503, "CUSTOMERS_UNAVAILABLE", "Clientes temporalmente no disponibles.", true)
		return
	}
	var c customers.Customer
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&c) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	c.TenantID = string(t.ID)
	if e := s.customers.Create(r.Context(), c); e != nil {
		WriteError(w, r, 422, "INVALID_CUSTOMER", "El cliente no es válido.", false)
		return
	}
	writeJSON(w, r, 201, c)
}

func (s *Server) updateCustomer(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var c customers.Customer
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&c) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	c.ID = strings.TrimPrefix(r.URL.Path, "/api/v1/customers/")
	c.TenantID = string(t.ID)
	if err := s.customers.Update(r.Context(), string(t.ID), c); err != nil {
		WriteError(w, r, 422, "INVALID_CUSTOMER", "El cliente no es válido.", false)
		return
	}
	writeJSON(w, r, 200, c)
}
func (s *Server) deleteCustomer(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if err := s.customers.Delete(r.Context(), string(t.ID), strings.TrimPrefix(r.URL.Path, "/api/v1/customers/")); err != nil {
		WriteError(w, r, 422, "CUSTOMER_DELETE_FAILED", "No se pudo desactivar el cliente.", false)
		return
	}
	writeJSON(w, r, 200, map[string]string{"status": "inactive"})
}
