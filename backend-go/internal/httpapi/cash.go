package httpapi

import (
	"encoding/json"
	"net/http"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/cash"
	"strconv"
	"time"
)

func (s *Server) expiredCash(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	lister, ok := s.cash.(cash.ExpiredLister)
	if !ok {
		WriteError(w, r, 503, "CASH_UNAVAILABLE", "Consulta de caja no disponible.", true)
		return
	}
	hours, _ := strconv.Atoi(r.URL.Query().Get("hours"))
	if hours <= 0 {
		hours = 24
	}
	items, err := lister.ListExpired(r.Context(), string(p.Tenant.ID), time.Duration(hours)*time.Hour, 100)
	if err != nil {
		WriteError(w, r, 500, "CASH_QUERY_FAILED", "No se pudieron cargar las sesiones.", true)
		return
	}
	writeJSON(w, r, 200, map[string]any{"items": items, "has_more": false})
}
func (s *Server) listCashSessions(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	lister, ok := s.cash.(cash.SessionLister)
	if !ok {
		WriteError(w, r, 503, "CASH_UNAVAILABLE", "Consulta de caja no disponible.", true)
		return
	}
	items, err := lister.List(r.Context(), string(p.Tenant.ID), r.URL.Query().Get("session_id"), r.URL.Query().Get("location_id"), 100)
	if err != nil {
		WriteError(w, r, 500, "CASH_QUERY_FAILED", "No se pudieron cargar las sesiones.", true)
		return
	}
	writeJSON(w, r, 200, map[string]any{"items": items, "has_more": false})
}

func (s *Server) openCash(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.cash == nil {
		WriteError(w, r, 503, "CASH_UNAVAILABLE", "Caja no disponible.", true)
		return
	}
	var q struct {
		ID, LocationID, OpenKey string
		OpeningFloat            int64
	}
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	x := cash.Session{ID: q.ID, TenantID: string(p.Tenant.ID), LocationID: q.LocationID, OpenedBy: string(p.Identity.ID), OpenKey: q.OpenKey, OpeningFloat: q.OpeningFloat}
	if e := s.cash.Open(r.Context(), x); e != nil {
		WriteError(w, r, 422, "INVALID_CASH_SESSION", "Sesión inválida.", false)
		return
	}
	writeJSON(w, r, 201, x)
}
func (s *Server) cashMove(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.cash == nil {
		WriteError(w, r, 503, "CASH_UNAVAILABLE", "Caja no disponible.", true)
		return
	}
	var q struct {
		ID, SessionID, Type, Direction, Reason, Key string
		Amount                                      int64
	}
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	m := cash.Movement{ID: q.ID, SessionID: q.SessionID, TenantID: string(p.Tenant.ID), CreatedBy: string(p.Identity.ID), Type: q.Type, Direction: q.Direction, Reason: q.Reason, Key: q.Key, Amount: q.Amount}
	if e := s.cash.Move(r.Context(), m); e != nil {
		WriteError(w, r, 422, "INVALID_CASH_MOVEMENT", "Movimiento inválido.", false)
		return
	}
	writeJSON(w, r, 201, m)
}

func (s *Server) closeCash(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, 401, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.cash == nil {
		WriteError(w, r, 503, "CASH_UNAVAILABLE", "Caja no disponible.", true)
		return
	}
	var q struct {
		SessionID string `json:"session_id"`
		Key       string `json:"close_idempotency_key"`
		Counted   int64  `json:"counted_cash"`
	}
	if json.NewDecoder(r.Body).Decode(&q) != nil {
		WriteError(w, r, 400, "INVALID_JSON", "Cuerpo JSON inválido.", false)
		return
	}
	if err := s.cash.Close(r.Context(), q.SessionID, string(p.Tenant.ID), string(p.Identity.ID), q.Counted, q.Key); err != nil {
		WriteError(w, r, 422, "INVALID_CASH_CLOSE", "Cierre inválido.", false)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
