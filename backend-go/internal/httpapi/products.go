package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/catalog"
)

type productRequest struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	ProductType string `json:"product_type"`
	Active      bool   `json:"active"`
}

func (s *Server) updateProduct(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var q productRequest
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "JSON inválido.", false)
		return
	}
	p := catalog.Product{ID: strings.TrimPrefix(r.URL.Path, "/api/v1/products/"), TenantID: string(t.ID), Code: q.Code, Name: q.Name, ProductType: q.ProductType, Active: q.Active}
	if e := s.catalog.UpdateProduct(r.Context(), p); e != nil {
		WriteError(w, r, 422, "INVALID_PRODUCT", "Producto inválido.", false)
		return
	}
	writeJSON(w, r, 200, p)
}
func (s *Server) deleteProduct(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if e := s.catalog.DeleteProduct(r.Context(), string(t.ID), strings.TrimPrefix(r.URL.Path, "/api/v1/products/")); e != nil {
		WriteError(w, r, 422, "PRODUCT_DELETE_FAILED", "No se pudo desactivar.", false)
		return
	}
	writeJSON(w, r, 200, map[string]string{"status": "inactive"})
}
func (s *Server) updateVariant(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	var q variantRequest
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "JSON inválido.", false)
		return
	}
	v := catalog.Variant{ID: strings.TrimPrefix(r.URL.Path, "/api/v1/variants/"), TenantID: string(t.ID), ProductID: q.ProductID, SKU: q.SKU, Name: q.Name, Cost: q.Cost, SalePrice: q.SalePrice, Active: q.Active}
	if e := s.catalog.UpdateVariant(r.Context(), v); e != nil {
		WriteError(w, r, 422, "INVALID_VARIANT", "Variante inválida.", false)
		return
	}
	writeJSON(w, r, 200, v)
}
func (s *Server) deleteVariant(w http.ResponseWriter, r *http.Request) {
	t, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if e := s.catalog.DeleteVariant(r.Context(), string(t.ID), strings.TrimPrefix(r.URL.Path, "/api/v1/variants/")); e != nil {
		WriteError(w, r, 422, "VARIANT_DELETE_FAILED", "No se pudo desactivar.", false)
		return
	}
	writeJSON(w, r, 200, map[string]string{"status": "inactive"})
}

type variantRequest struct {
	ID, ProductID, SKU, Name string
	Cost, SalePrice          int64
	Active                   bool
}

func (s *Server) createVariant(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.catalog == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "Catálogo temporalmente no disponible.", true)
		return
	}
	var req struct {
		ID        string `json:"id"`
		ProductID string `json:"product_id"`
		SKU       string `json:"sku"`
		Name      string `json:"name"`
		Cost      int64  `json:"cost"`
		SalePrice int64  `json:"sale_price"`
		Active    bool   `json:"active"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	v := catalog.Variant{ID: req.ID, TenantID: string(principal.Tenant.ID), ProductID: req.ProductID, SKU: req.SKU, Name: req.Name, Cost: req.Cost, SalePrice: req.SalePrice, Active: req.Active}
	if err := s.catalog.CreateVariant(r.Context(), v); err != nil {
		WriteError(w, r, http.StatusUnprocessableEntity, "INVALID_VARIANT", "La variante no es válida.", false)
		return
	}
	writeJSON(w, r, http.StatusCreated, v)
}

func (s *Server) listVariants(w http.ResponseWriter, r *http.Request) {
	tenant, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.catalog == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "Catálogo temporalmente no disponible.", true)
		return
	}
	q := r.URL.Query()
	if term := q.Get("search"); term != "" {
		page, err := s.catalog.SearchVariantsAtLocation(r.Context(), string(tenant.ID), term, q.Get("location_id"), 25)
		if err != nil {
			WriteError(w, r, 400, "INVALID_REQUEST", "Solicitud inválida.", false)
			return
		}
		writeJSON(w, r, 200, page)
		return
	}
	limit := 25
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			WriteError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		limit = n
	}
	page, err := s.catalog.ListVariants(r.Context(), string(tenant.ID), limit, q.Get("after_name"), q.Get("after_id"))
	if err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}

func (s *Server) createProduct(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.catalog == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "Catálogo temporalmente no disponible.", true)
		return
	}
	var req productRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	p := catalog.Product{ID: req.ID, TenantID: string(principal.Tenant.ID), Code: req.Code, Name: req.Name, ProductType: req.ProductType, Active: req.Active}
	if err := s.catalog.CreateProduct(r.Context(), p); err != nil {
		WriteError(w, r, http.StatusUnprocessableEntity, "INVALID_PRODUCT", "El producto no es válido.", false)
		return
	}
	writeJSON(w, r, http.StatusCreated, p)
}

func (s *Server) products(w http.ResponseWriter, r *http.Request) {
	tenant, ok := auth.TenantFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.catalog == nil {
		WriteError(w, r, http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "Catálogo temporalmente no disponible.", true)
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			WriteError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", "Parámetros de paginación inválidos.", false)
			return
		}
		limit = parsed
	}
	afterName, afterID := r.URL.Query().Get("after_name"), r.URL.Query().Get("after_id")
	page, err := s.catalog.ListProducts(r.Context(), string(tenant.ID), limit, afterName, afterID)
	if err != nil {
		WriteError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Solicitud inválida.", false)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}
