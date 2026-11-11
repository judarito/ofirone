package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"ofirone/backend-go/internal/auth"
	reference "ofirone/backend-go/internal/reference_tax"
)

// NewReferenceTaxHandler is mounted by the composition root behind its auth/CORS
// middleware. It also rejects requests without a verified tenant itself.
// Routes: /api/v1/{taxes,currencies,regional-settings}[/{id}].
// PUT replaces the full resource; DELETE deactivates it and preserves history.
func NewReferenceTaxHandler(store reference.Store, fallback ...http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) == 5 && parts[0] == "api" && parts[1] == "v1" && parts[2] == "tax-info" && parts[3] == "variants" {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
				return
			}
			variantID := parts[4]
			if !reference.ValidID(variantID) {
				referenceError(w, r, reference.ErrInvalid)
				return
			}
			tenant, ok := auth.TenantFromContext(r.Context())
			if !ok {
				WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
				return
			}
			store, ok := anyStoreTaxInfo(store)
			if !ok {
				WriteError(w, r, 503, "REFERENCE_UNAVAILABLE", "Configuración temporalmente no disponible.", true)
				return
			}
			info, err := store.TaxInfoForVariant(r.Context(), string(tenant.ID), variantID)
			if err != nil {
				referenceError(w, r, err)
				return
			}
			writeJSON(w, r, 200, info)
			return
		}
		if len(parts) < 3 || len(parts) > 4 || parts[0] != "api" || parts[1] != "v1" || !reference.ValidResource(reference.Resource(parts[2])) {
			if len(fallback) > 0 && fallback[0] != nil {
				fallback[0].ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		resource := reference.Resource(parts[2])
		id := ""
		if len(parts) == 4 {
			id = parts[3]
			if !reference.ValidID(id) {
				referenceError(w, r, reference.ErrInvalid)
				return
			}
		}
		tenant, ok := auth.TenantFromContext(r.Context())
		if !ok {
			WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
			return
		}
		if !reference.ValidID(string(tenant.ID)) {
			referenceError(w, r, reference.ErrInvalid)
			return
		}
		if store == nil {
			WriteError(w, r, 503, "REFERENCE_UNAVAILABLE", "Configuración temporalmente no disponible.", true)
			return
		}
		var result any
		var err error
		status := 200
		switch {
		case (r.Method == http.MethodGet || r.Method == http.MethodHead) && id == "":
			limit := 25
			if raw := r.URL.Query().Get("limit"); raw != "" {
				limit, err = strconv.Atoi(raw)
				if err != nil {
					referenceError(w, r, reference.ErrInvalid)
					return
				}
			}
			var q reference.Query
			q, err = reference.ParseQuery(resource, string(tenant.ID), limit, r.URL.Query().Get("cursor"))
			if err == nil {
				result, err = store.List(r.Context(), resource, string(tenant.ID), q)
			}
		case (r.Method == http.MethodGet || r.Method == http.MethodHead) && id != "":
			result, err = store.Get(r.Context(), resource, string(tenant.ID), id)
		case (r.Method == http.MethodPost && id == "") || (r.Method == http.MethodPut && id != ""):
			v := reference.Record{Active: true}
			dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
			dec.DisallowUnknownFields()
			if dec.Decode(&v) != nil || dec.Decode(new(any)) != io.EOF {
				WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
				return
			}
			if id != "" {
				if v.ID != "" && v.ID != id {
					referenceError(w, r, reference.ErrInvalid)
					return
				}
				v.ID = id
			}
			// Omitted is_active defaults to true; explicit false deactivates the record.
			if err = v.Validate(resource); err == nil {
				if r.Method == http.MethodPost {
					result, err = store.Create(r.Context(), resource, string(tenant.ID), v)
					status = 201
				} else {
					result, err = store.Update(r.Context(), resource, string(tenant.ID), v)
				}
			}
		case r.Method == http.MethodDelete && id != "":
			err = store.Deactivate(r.Context(), resource, string(tenant.ID), id)
			status = 204
		default:
			if id == "" {
				w.Header().Set("Allow", "GET, HEAD, POST")
			} else {
				w.Header().Set("Allow", "GET, HEAD, PUT, DELETE")
			}
			WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		if err != nil {
			referenceError(w, r, err)
			return
		}
		if status == 204 {
			w.WriteHeader(status)
			return
		}
		writeJSON(w, r, status, result)
	})
}

func anyStoreTaxInfo(store reference.Store) (reference.VariantTaxInfoStore, bool) {
	v, ok := store.(reference.VariantTaxInfoStore)
	return v, ok
}

func referenceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, reference.ErrInvalid):
		WriteError(w, r, 422, "INVALID_REFERENCE", "Datos o paginación inválidos.", false)
	case errors.Is(err, reference.ErrNotFound):
		WriteError(w, r, 404, "REFERENCE_NOT_FOUND", "Registro no encontrado.", false)
	case errors.Is(err, reference.ErrConflict):
		WriteError(w, r, 409, "REFERENCE_CONFLICT", "Código duplicado o moneda utilizada por una configuración activa.", false)
	default:
		WriteError(w, r, 500, "REFERENCE_ERROR", "No se pudo completar la operación.", true)
	}
}
