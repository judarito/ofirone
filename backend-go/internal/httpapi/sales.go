package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/sales"
)

func (s *Server) listSales(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.sales == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "SALES_UNAVAILABLE", "Ventas temporalmente no disponibles.", true)
		return
	}
	q := r.URL.Query()
	limit := 25
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		limit = n
	}
	page, err := s.sales.List(r.Context(), string(principal.Tenant.ID), limit, q.Get("after_sold_at"), q.Get("after_id"))
	if err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}

type saleRequest struct {
	ID             string          `json:"id"`
	LocationID     string          `json:"location_id"`
	CustomerID     string          `json:"customer_id"`
	CashSessionID  string          `json:"cash_session_id"`
	SaleNumber     int64           `json:"sale_number"`
	IdempotencyKey string          `json:"idempotency_key"`
	Status         sales.Status    `json:"status"`
	Lines          []sales.Line    `json:"lines"`
	Payments       []sales.Payment `json:"payments"`
}

func (s *Server) createSale(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.sales == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "SALES_UNAVAILABLE", "Ventas temporalmente no disponibles.", true)
		return
	}
	var request saleRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&request); err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	sale := sales.Sale{ID: request.ID, TenantID: string(principal.Tenant.ID), LocationID: request.LocationID, CustomerID: request.CustomerID, CashSessionID: request.CashSessionID, CreatedByIdentityID: string(principal.Identity.ID), SaleNumber: request.SaleNumber, IdempotencyKey: request.IdempotencyKey, Status: request.Status, Lines: request.Lines, Payments: request.Payments}
	if err := s.sales.Create(r.Context(), sale); err != nil {
		WriteError(w, r, http.StatusUnprocessableEntity, "INVALID_SALE", "La venta no es válida.", false)
		return
	}
	writeJSON(w, r, http.StatusCreated, map[string]any{"id": sale.ID, "status": sale.Status, "total": sale.Total})
}
