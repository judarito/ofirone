package httpapi

import (
	"encoding/json"
	"net/http"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/receivables"
	"strconv"
)

func (s *Server) listReceivables(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.receivables == nil {
		WriteError(w, r, 503, "RECEIVABLES_UNAVAILABLE", "CXC temporalmente no disponible.", true)
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Paginación inválida.", false)
			return
		}
		limit = n
	}
	page, e := s.receivables.List(r.Context(), string(p.Tenant.ID), limit, r.URL.Query().Get("after_id"))
	if e != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, page)
}
func (s *Server) payReceivable(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var payment receivables.Payment
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payment) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "JSON inválido.", false)
		return
	}
	if s.receivables == nil || s.receivables.Pay(r.Context(), string(p.Tenant.ID), payment) != nil {
		WriteError(w, r, 422, "INVALID_PAYMENT", "Abono inválido.", false)
		return
	}
	writeJSON(w, r, 201, map[string]string{"status": "paid"})
}

func (s *Server) receivableAccount(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.receivables == nil {
		WriteError(w, r, 503, "RECEIVABLES_UNAVAILABLE", "CXC temporalmente no disponible.", true)
		return
	}
	a, err := s.receivables.Get(r.Context(), string(p.Tenant.ID), id)
	if err != nil {
		WriteError(w, r, 404, "ACCOUNT_NOT_FOUND", "Cuenta no encontrada.", false)
		return
	}
	writeJSON(w, r, 200, a)
}
func (s *Server) upsertReceivable(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var in receivables.AccountInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "JSON inválido.", false)
		return
	}
	a, err := s.receivables.Upsert(r.Context(), string(p.Tenant.ID), in)
	if err != nil {
		WriteError(w, r, 422, "INVALID_ACCOUNT", "Cuenta inválida.", false)
		return
	}
	writeJSON(w, r, 200, a)
}
func (s *Server) chargeReceivable(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var c receivables.Charge
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&c) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "JSON inválido.", false)
		return
	}
	if s.receivables == nil || s.receivables.Charge(r.Context(), string(p.Tenant.ID), c) != nil {
		WriteError(w, r, 422, "INVALID_CHARGE", "Cargo inválido.", false)
		return
	}
	writeJSON(w, r, 201, map[string]string{"status": "charged"})
}
func (s *Server) listReceivableMovements(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Paginación inválida.", false)
			return
		}
		limit = n
	}
	page, err := s.receivables.Movements(r.Context(), string(p.Tenant.ID), id, limit, r.URL.Query().Get("after_occurred_at"), r.URL.Query().Get("after_id"))
	if err != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, page)
}
func (s *Server) receivableSummary(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	sum, err := s.receivables.Summary(r.Context(), string(p.Tenant.ID))
	if err != nil {
		WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, 200, sum)
}
