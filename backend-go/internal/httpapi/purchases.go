package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/purchases"
)

func (s *Server) createPurchase(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.purchases == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "PURCHASES_UNAVAILABLE", "Compras no disponibles.", true)
		return
	}
	var req purchases.Purchase
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	req.TenantID = string(p.Tenant.ID)
	if req.Status == "" {
		req.Status = purchases.Received
	}
	if err := s.purchases.Receive(r.Context(), req); err != nil {
		WriteError(w, r, http.StatusUnprocessableEntity, "INVALID_PURCHASE", "Compra inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusCreated, req)
}

func (s *Server) listPurchases(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.purchases == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "PURCHASES_UNAVAILABLE", "Compras no disponibles.", true)
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "Paginación inválida.", false)
			return
		}
		limit = n
	}
	page, err := s.purchases.List(r.Context(), string(p.Tenant.ID), limit, r.URL.Query().Get("after_purchased_at"), r.URL.Query().Get("after_id"))
	if err != nil {
		WriteError(w, r, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}
