package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/inventory"
)

func (s *Server) createInventoryMovement(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.inventory == nil {
		WriteError(w, r, 503, "INVENTORY_UNAVAILABLE", "Inventario temporalmente no disponible.", true)
		return
	}
	var req struct {
		ID         string `json:"id"`
		LocationID string `json:"location_id"`
		VariantID  string `json:"variant_id"`
		BatchID    string `json:"batch_id"`
		Type       string `json:"type"`
		Delta      int64  `json:"delta"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	m := inventory.Movement{ID: req.ID, TenantID: string(principal.Tenant.ID), LocationID: req.LocationID, VariantID: req.VariantID, Delta: req.Delta, Type: req.Type}
	if err := s.inventory.ApplyMovement(r.Context(), m, req.BatchID); err != nil {
		WriteError(w, r, 422, "INVALID_MOVEMENT", "El movimiento no es válido.", false)
		return
	}
	writeJSON(w, r, 201, m)
}

func (s *Server) inventoryHandler(w http.ResponseWriter, r *http.Request) {
	tenant, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.inventory == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "INVENTORY_UNAVAILABLE", "Inventario temporalmente no disponible.", true)
		return
	}
	q := r.URL.Query()
	locationID, variantID := q.Get("location_id"), q.Get("variant_id")
	limit := 25
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		limit = n
	}
	var page any
	var err error
	if locationID == "" || variantID == "" {
		page, err = s.inventory.ListStock(r.Context(), string(tenant.ID), locationID, variantID, limit, q.Get("after_updated_at"), q.Get("after_id"))
	} else {
		page, err = s.inventory.ListBatches(r.Context(), string(tenant.ID), locationID, variantID, limit, q.Get("after_updated_at"), q.Get("after_id"))
	}
	if err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}

func (s *Server) stockBalances(w http.ResponseWriter, r *http.Request) {
	tenant, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.inventory == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "INVENTORY_UNAVAILABLE", "Inventario temporalmente no disponible.", true)
		return
	}
	q := r.URL.Query()
	rawLimit := q.Get("limit")
	if rawLimit == "" {
		rawLimit = q.Get("page_size")
	}
	limit := 25
	if rawLimit != "" {
		n, err := strconv.Atoi(rawLimit)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		limit = n
	}
	page, err := s.inventory.ListStock(r.Context(), string(tenant.ID), q.Get("location_id"), q.Get("variant_id"), limit, q.Get("after_updated_at"), q.Get("after_id"))
	if err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, struct {
		Items         []inventory.StockBalance `json:"items"`
		HasMore       bool                     `json:"has_more"`
		NextUpdatedAt string                   `json:"next_updated_at,omitempty"`
		NextID        string                   `json:"next_id,omitempty"`
	}{Items: page.Items, HasMore: page.HasMore, NextUpdatedAt: page.NextUpdatedAt, NextID: page.NextID})
}
