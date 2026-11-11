package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"ofirone/backend-go/internal/auth"
	ref "ofirone/backend-go/internal/reference_catalog"
	"strconv"
	"strings"
)

// NewReferenceCatalogHandler serves /api/v1/units-of-measure and
// /api/v1/categories (including /{id}). Mount behind JWT middleware; this
// handler also rejects any request without a verified tenant in context.
// PATCH merges supplied fields; DELETE deactivates rather than removes.
func NewReferenceCatalogHandler(store ref.Store, fallback ...http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/units-of-measure") && !strings.HasPrefix(r.URL.Path, "/api/v1/categories") {
			if len(fallback) > 0 {
				fallback[0].ServeHTTP(w, r)
			} else {
				http.NotFound(w, r)
			}
			return
		}
		tenant, ok := auth.TenantFromContext(r.Context())
		if !ok {
			WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/"), "/")
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") || len(parts) > 2 || (parts[0] != string(ref.Units) && parts[0] != string(ref.Categories)) {
			http.NotFound(w, r)
			return
		}
		kind := ref.Kind(parts[0])
		id := ""
		if len(parts) == 2 {
			id = parts[1]
			if !ref.ValidID(id) {
				referenceCatalogError(w, r, ref.ErrInvalid)
				return
			}
		}
		if store == nil {
			WriteError(w, r, 503, "REFERENCE_CATALOG_UNAVAILABLE", "Maestros temporalmente no disponibles.", true)
			return
		}
		t := string(tenant.ID)
		switch r.Method {
		case http.MethodGet, http.MethodHead:
			if id != "" {
				v, e := store.Get(r.Context(), kind, t, id)
				if e != nil {
					referenceCatalogError(w, r, e)
					return
				}
				writeJSON(w, r, 200, v)
				return
			}
			q := ref.Query{Limit: 25, AfterName: r.URL.Query().Get("after_name"), AfterID: r.URL.Query().Get("after_id")}
			if raw := r.URL.Query().Get("limit"); raw != "" {
				n, e := strconv.Atoi(raw)
				if e != nil {
					referenceCatalogError(w, r, ref.ErrInvalid)
					return
				}
				q.Limit = n
			}
			if e := ref.ValidateQuery(q); e != nil {
				referenceCatalogError(w, r, e)
				return
			}
			p, e := store.List(r.Context(), kind, t, q)
			if e != nil {
				referenceCatalogError(w, r, e)
				return
			}
			writeJSON(w, r, 200, p)
		case http.MethodPost, http.MethodPatch:
			create := r.Method == http.MethodPost
			if create && id != "" || !create && id == "" {
				w.Header().Set("Allow", "GET, HEAD, POST")
				w.WriteHeader(405)
				return
			}
			v := ref.Item{Active: true}
			if !create {
				var e error
				v, e = store.Get(r.Context(), kind, t, id)
				if e != nil {
					referenceCatalogError(w, r, e)
					return
				}
			}
			// Decode into an explicit wire object to prevent caller-supplied tenant/ID.
			var body struct {
				Code          *string         `json:"code"`
				Name          *string         `json:"name"`
				DecimalPlaces *int            `json:"decimal_places"`
				Active        *bool           `json:"is_active"`
				Parent        json.RawMessage `json:"parent_category_id"`
			}
			d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
			d.DisallowUnknownFields()
			if e := d.Decode(&body); e != nil {
				referenceCatalogError(w, r, ref.ErrInvalid)
				return
			}
			if e := d.Decode(new(any)); e != io.EOF {
				referenceCatalogError(w, r, ref.ErrInvalid)
				return
			}
			if body.Code != nil {
				v.Code = *body.Code
			}
			if body.Name != nil {
				v.Name = *body.Name
			}
			if body.Active != nil {
				v.Active = *body.Active
			}
			if body.DecimalPlaces != nil {
				if kind != ref.Units {
					referenceCatalogError(w, r, ref.ErrInvalid)
					return
				}
				v.DecimalPlaces = *body.DecimalPlaces
			}
			if body.Parent != nil {
				if kind != ref.Categories || json.Unmarshal(body.Parent, &v.ParentID) != nil {
					referenceCatalogError(w, r, ref.ErrInvalid)
					return
				}
			}
			v.TenantID = t
			v.ID = id
			if e := ref.Validate(kind, v); e != nil {
				referenceCatalogError(w, r, e)
				return
			}
			result, e := store.Save(r.Context(), kind, v, create)
			if e != nil {
				referenceCatalogError(w, r, e)
				return
			}
			status := 200
			if create {
				status = 201
			}
			writeJSON(w, r, status, result)
		case http.MethodDelete:
			if id == "" {
				w.Header().Set("Allow", "GET, HEAD, POST")
				w.WriteHeader(405)
				return
			}
			if e := store.Deactivate(r.Context(), kind, t, id); e != nil {
				referenceCatalogError(w, r, e)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			allow := "GET, HEAD, POST"
			if id != "" {
				allow = "GET, HEAD, PATCH, DELETE"
			}
			w.Header().Set("Allow", allow)
			w.WriteHeader(405)
		}
	})
}
func referenceCatalogError(w http.ResponseWriter, r *http.Request, e error) {
	status, code, message := 500, "REFERENCE_CATALOG_ERROR", "No se pudo completar la operación."
	switch {
	case errors.Is(e, ref.ErrInvalid):
		status, code, message = 400, "INVALID_REFERENCE", "Datos o paginación inválidos."
	case errors.Is(e, ref.ErrParent):
		status, code, message = 422, "INVALID_CATEGORY_PARENT", "La categoría padre debe estar activa, pertenecer al tenant y no generar ciclos."
	case errors.Is(e, ref.ErrNotFound):
		status, code, message = 404, "REFERENCE_NOT_FOUND", "Registro no encontrado."
	case errors.Is(e, ref.ErrConflict):
		status, code, message = 409, "REFERENCE_CONFLICT", "Código duplicado o categoría con hijos activos."
	}
	WriteError(w, r, status, code, message, status == 500)
}
