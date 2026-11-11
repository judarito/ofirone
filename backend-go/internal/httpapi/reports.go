package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/reports"
)

func (s *Server) report(w http.ResponseWriter, r *http.Request, kind string) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.reports == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "REPORTS_UNAVAILABLE", "Reportes temporalmente no disponibles.", true)
		return
	}
	q := r.URL.Query()
	f := reports.Filter{TenantID: string(principal.Tenant.ID), LocationID: q.Get("location_id"), Status: q.Get("status"), AfterID: q.Get("after_id"), Limit: 25}
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, 400, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		f.Limit = n
	}
	for name, target := range map[string]**time.Time{"from": &f.From, "to": &f.To, "after_at": &f.AfterAt} {
		if raw := q.Get(name); raw != "" {
			t, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				WriteError(w, r, 400, "INVALID_DATE", "Fechas inválidas.", false)
				return
			}
			*target = &t
		}
	}
	var value any
	var err error
	switch kind {
	case "sales":
		value, err = s.reports.Sales(r.Context(), f)
	case "purchases":
		value, err = s.reports.Purchases(r.Context(), f)
	case "inventory":
		value, err = s.reports.Inventory(r.Context(), f)
	case "receivables":
		value, err = s.reports.Receivables(r.Context(), f)
	}
	if err != nil {
		WriteError(w, r, 400, "INVALID_REPORT", "Filtros de reporte inválidos.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, value)
}

func (s *Server) dashboardReport(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.reports == nil {
		WriteError(w, r, 503, "REPORTS_UNAVAILABLE", "Reportes temporalmente no disponibles.", true)
		return
	}
	f := reports.Filter{TenantID: string(principal.Tenant.ID), LocationID: r.URL.Query().Get("location_id"), Limit: 25}
	value, err := s.reports.Dashboard(r.Context(), f)
	if err != nil {
		WriteError(w, r, 400, "INVALID_REPORT", "No se pudo cargar el dashboard.", false)
		return
	}
	writeJSON(w, r, 200, value)
}
