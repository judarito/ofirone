package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"ofirone/backend-go/internal/auth"
	refs "ofirone/backend-go/internal/reference_locations"
)

// NewReferenceLocationsHandler handles /api/v1/locations and
// /api/v1/payment-methods. Mount behind the application's JWT middleware.
// fallback receives routes belonging to other modules.
func NewReferenceLocationsHandler(store refs.Store, fallback http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/"), "/")
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") || len(parts) == 0 || (parts[0] != "locations" && parts[0] != "payment-methods") {
			if fallback != nil {
				fallback.ServeHTTP(w, r)
			} else {
				http.NotFound(w, r)
			}
			return
		}
		fail := func(status int, code string) { WriteError(w, r, status, code, http.StatusText(status), false) }
		tenant, ok := auth.TenantFromContext(r.Context())
		if !ok || tenant.ID == "" {
			fail(401, "UNAUTHENTICATED")
			return
		}
		kind := parts[0]
		key := ""
		if len(parts) > 2 {
			fail(404, "NOT_FOUND")
			return
		}
		if len(parts) == 2 {
			key = parts[1]
			if !referenceUUID(key) {
				fail(400, "INVALID_ID")
				return
			}
		}
		allowed := "GET, HEAD, POST"
		if key != "" {
			allowed = "GET, HEAD, PATCH, DELETE"
		}
		if !(r.Method == "GET" || r.Method == "HEAD" || key == "" && r.Method == "POST" || key != "" && (r.Method == "PATCH" || r.Method == "DELETE")) {
			w.Header().Set("Allow", allowed)
			fail(405, "METHOD_NOT_ALLOWED")
			return
		}
		if store == nil {
			fail(503, "REFERENCE_UNAVAILABLE")
			return
		}
		respondError := func(e error) {
			switch {
			case errors.Is(e, refs.ErrInvalid):
				fail(422, "INVALID_REFERENCE")
			case errors.Is(e, refs.ErrNotFound):
				fail(404, "REFERENCE_NOT_FOUND")
			case errors.Is(e, refs.ErrConflict):
				fail(409, "REFERENCE_CONFLICT")
			default:
				fail(503, "REFERENCE_UNAVAILABLE")
			}
		}
		ctx := r.Context()
		tid := string(tenant.ID)
		switch r.Method {
		case "GET", "HEAD":
			if key != "" {
				out, e := store.Get(ctx, tid, kind, key)
				if e != nil {
					respondError(e)
					return
				}
				writeJSON(w, r, 200, out)
				return
			}
			limit := 25
			if raw := r.URL.Query().Get("limit"); raw != "" {
				n, e := strconv.Atoi(raw)
				if e != nil || n < 1 || n > 100 {
					fail(400, "INVALID_PAGINATION")
					return
				}
				limit = n
			}
			after := r.URL.Query().Get("after_id")
			if after != "" && !referenceUUID(after) {
				fail(400, "INVALID_PAGINATION")
				return
			}
			out, e := store.List(ctx, tid, kind, limit, after)
			if e != nil {
				respondError(e)
				return
			}
			writeJSON(w, r, 200, out)
		case "DELETE":
			if e := store.Delete(ctx, tid, kind, key); e != nil {
				respondError(e)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "POST", "PATCH":
			record := refs.Record{IsActive: true, MethodType: "other"}
			if key != "" {
				var e error
				record, e = store.Get(ctx, tid, kind, key)
				if e != nil {
					respondError(e)
					return
				}
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
			decoder.DisallowUnknownFields()
			if e := decoder.Decode(&record); e != nil {
				fail(400, "INVALID_JSON")
				return
			}
			var trailing any
			if decoder.Decode(&trailing) != io.EOF {
				fail(400, "INVALID_JSON")
				return
			}
			record.TenantID = tid
			record.ID = key
			if e := refs.Validate(kind, record); e != nil {
				respondError(e)
				return
			}
			var out refs.Record
			var e error
			status := 200
			if key == "" {
				out, e = store.Create(ctx, tid, kind, record)
				status = 201
			} else {
				out, e = store.Update(ctx, tid, kind, key, record)
			}
			if e != nil {
				respondError(e)
				return
			}
			writeJSON(w, r, status, out)
		}
	})
}
func referenceUUID(s string) bool {
	if len(s) != 36 || s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	_, e := hex.DecodeString(strings.ReplaceAll(s, "-", ""))
	return e == nil
}
