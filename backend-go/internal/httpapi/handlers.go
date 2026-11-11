package httpapi

import (
	"context"
	"net/http"
	"strings"
)

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/v1/pricing-rules") {
		s.pricingRuleRoute(w, r)
		return
	}
	if r.URL.Path == "/api/v1/tenant/billing-summary" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.handleTenantConfig(w, r, "billing")
		return
	}
	if r.URL.Path == "/api/v1/tenant/settings" {
		s.handleTenantConfig(w, r, "settings")
		return
	}
	if r.URL.Path == "/api/v1/system-alerts" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.listAlerts(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/purchases/") {
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/purchases/")
		if r.Method == http.MethodGet {
			s.getPurchase(w, r, id)
			return
		}
		if r.Method == http.MethodPost {
			s.cancelPurchase(w, r, id)
			return
		}
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		switch r.URL.Path {
		case "/api/v1/reports/sales":
			s.report(w, r, "sales")
			return
		case "/api/v1/reports/purchases":
			s.report(w, r, "purchases")
			return
		case "/api/v1/reports/inventory":
			s.report(w, r, "inventory")
			return
		case "/api/v1/reports/receivables":
			s.report(w, r, "receivables")
			return
		case "/api/v1/reports/dashboard":
			s.dashboardReport(w, r)
			return
		}
	}
	if r.URL.Path == "/api/v1/purchases" {
		if r.Method == http.MethodPost {
			s.createPurchase(w, r)
			return
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			s.listPurchases(w, r)
			return
		}
	}
	if r.URL.Path == "/api/v1/me/menu" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.menus(w, r)
		return
	}
	if r.URL.Path == "/api/v1/me" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.me(w, r)
		return
	}
	if r.URL.Path == "/api/v1/pos/context" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.posContext(w, r)
		return
	}
	if r.URL.Path == "/api/v1/auth/login" && r.Method == http.MethodPost {
		s.login(w, r)
		return
	}
	if r.URL.Path == "/api/v1/cash-sessions" && r.Method == http.MethodPost {
		s.openCash(w, r)
		return
	}
	if r.URL.Path == "/api/v1/cash-sessions/expired" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.expiredCash(w, r)
		return
	}
	if r.URL.Path == "/api/v1/cash-sessions" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		s.listCashSessions(w, r)
		return
	}
	if r.URL.Path == "/api/v1/cash-movements" && r.Method == http.MethodPost {
		s.cashMove(w, r)
		return
	}
	if r.URL.Path == "/api/v1/cash-sessions/close" && r.Method == http.MethodPost {
		s.closeCash(w, r)
		return
	}
	if r.URL.Path == "/api/v1/auth/refresh" && r.Method == http.MethodPost {
		s.refresh(w, r)
		return
	}
	if r.URL.Path == "/api/v1/auth/logout" && r.Method == http.MethodPost {
		s.logout(w, r)
		return
	}
	if r.URL.Path == "/api/v1/sales" {
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			s.listSales(w, r)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, HEAD, POST")
			WriteError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		s.createSale(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/sales/") {
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/sales/")
		if r.Method == http.MethodGet {
			s.getSale(w, r, id)
			return
		}
		if r.Method == http.MethodPost && strings.HasSuffix(id, "/void") {
			s.voidSale(w, r, strings.TrimSuffix(id, "/void"))
			return
		}
	}
	if r.URL.Path == "/api/v1/receivables" && r.Method == http.MethodGet {
		s.listReceivables(w, r)
		return
	}
	if r.URL.Path == "/api/v1/receivables/summary" && r.Method == http.MethodGet {
		s.receivableSummary(w, r)
		return
	}
	if r.URL.Path == "/api/v1/receivables" && r.Method == http.MethodPut {
		s.upsertReceivable(w, r)
		return
	}
	if r.URL.Path == "/api/v1/receivables/charges" && r.Method == http.MethodPost {
		s.chargeReceivable(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/receivables/") {
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/receivables/")
		if strings.HasSuffix(id, "/movements") && r.Method == http.MethodGet {
			s.listReceivableMovements(w, r, strings.TrimSuffix(id, "/movements"))
			return
		}
		if r.Method == http.MethodGet {
			s.receivableAccount(w, r, id)
			return
		}
	}
	if r.URL.Path == "/api/v1/receivables/payments" && r.Method == http.MethodPost {
		s.payReceivable(w, r)
		return
	}
	if r.URL.Path == "/api/v1/customers" {
		if r.Method == http.MethodPost {
			s.createCustomer(w, r)
			return
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			s.customersHandler(w, r)
			return
		}
		w.Header().Set("Allow", "GET, HEAD, POST")
		WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
		return
	}
	if r.URL.Path == "/api/v1/suppliers" {
		if r.Method == http.MethodPost {
			s.createSupplier(w, r)
			return
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			s.listSuppliers(w, r)
			return
		}
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/customers/") {
		if r.Method == http.MethodPatch {
			s.updateCustomer(w, r)
			return
		}
		if r.Method == http.MethodDelete {
			s.deleteCustomer(w, r)
			return
		}
	}
	switch r.URL.Path {
	case "/healthz", "/readyz", "/api/v1/version":
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			WriteError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
	default:
		if r.URL.Path == "/api/v1/products" {
			if r.Method == http.MethodPost {
				s.createProduct(w, r)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD, POST")
				WriteError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
				return
			}
			s.products(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/products/") {
			if r.Method == http.MethodPatch {
				s.updateProduct(w, r)
				return
			}
			if r.Method == http.MethodDelete {
				s.deleteProduct(w, r)
				return
			}
		}
		if r.URL.Path == "/api/v1/variants" {
			if r.Method == http.MethodPost {
				s.createVariant(w, r)
				return
			}
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				s.listVariants(w, r)
				return
			}
			w.Header().Set("Allow", "GET, HEAD, POST")
			WriteError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/variants/") {
			if r.Method == http.MethodPatch {
				s.updateVariant(w, r)
				return
			}
			if r.Method == http.MethodDelete {
				s.deleteVariant(w, r)
				return
			}
		}
		if r.URL.Path == "/api/v1/inventory" {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				WriteError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
				return
			}
			s.inventoryHandler(w, r)
			return
		}
		if r.URL.Path == "/api/v1/inventory/alerts" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			s.listInventoryAlerts(w, r)
			return
		}
		if r.URL.Path == "/api/v1/inventory/stock-balances" {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				WriteError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
				return
			}
			s.stockBalances(w, r)
			return
		}
		if r.URL.Path == "/api/v1/inventory/movements" {
			if r.Method == http.MethodPost {
				s.createInventoryMovement(w, r)
				return
			}
			if r.Method == http.MethodGet {
				s.listInventoryMoves(w, r)
				return
			}
			w.Header().Set("Allow", "POST")
			WriteError(w, r, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", false)
			return
		}
		WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "Recurso no encontrado.", false)
		return
	}
	switch r.URL.Path {
	case "/healthz":
		writeJSON(w, r, http.StatusOK, struct {
			Status string `json:"status"`
		}{Status: "ok"})
	case "/readyz":
		s.readiness(w, r)
	case "/api/v1/version":
		writeJSON(w, r, http.StatusOK, struct {
			Service string `json:"service"`
			Version string `json:"version"`
			Commit  string `json:"commit"`
		}{s.config.Service, s.config.Version, s.config.Commit})
	}
}

func (s *Server) readiness(w http.ResponseWriter, r *http.Request) {
	if s.stopping.Load() || s.db == nil {
		s.unavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.config.PingTimeout)
	defer cancel()
	err := s.db.Ping(ctx)
	// Recheck shutdown after Ping so an in-flight probe cannot report ready
	// after a shutdown that started during the database round trip.
	if err != nil || ctx.Err() != nil || s.stopping.Load() {
		s.unavailable(w, r)
		return
	}
	writeJSON(w, r, http.StatusOK, struct {
		Status string `json:"status"`
	}{Status: "ready"})
}

func (s *Server) unavailable(w http.ResponseWriter, r *http.Request) {
	WriteError(w, r, http.StatusServiceUnavailable, "DEPENDENCY_UNAVAILABLE", "Servicio temporalmente no disponible.", true)
}
