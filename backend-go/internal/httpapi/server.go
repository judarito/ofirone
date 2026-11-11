// Package httpapi provides the operational HTTP endpoints for the Ofirone API.
package httpapi

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"ofirone/backend-go/internal/alerts"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/cash"
	"ofirone/backend-go/internal/catalog"
	"ofirone/backend-go/internal/customers"
	"ofirone/backend-go/internal/inventory"
	"ofirone/backend-go/internal/poscontext"
	"ofirone/backend-go/internal/pricingrules"
	"ofirone/backend-go/internal/purchases"
	"ofirone/backend-go/internal/receivables"
	refcatalog "ofirone/backend-go/internal/reference_catalog"
	reflocations "ofirone/backend-go/internal/reference_locations"
	reftax "ofirone/backend-go/internal/reference_tax"
	"ofirone/backend-go/internal/reports"
	"ofirone/backend-go/internal/sales"
	"ofirone/backend-go/internal/suppliers"
	"ofirone/backend-go/internal/tenantconfig"
)

// Pinger is satisfied by pgxpool.Pool without coupling HTTP to a database driver.
// Implementations must respect cancellation and deadlines in ctx.
type Pinger interface {
	Ping(ctx context.Context) error
}

type Config struct {
	Service            string
	Version            string
	Commit             string
	PingTimeout        time.Duration
	ReadHeaderTimeout  time.Duration
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
	Catalog            *catalog.Service
	Inventory          *inventory.Service
	Sales              *sales.Service
	Customers          *customers.Service
	Auth               *auth.Service
	Cash               cash.Store
	Menus              MenuStore
	Purchases          *purchases.Service
	Receivables        *receivables.Service
	ReferenceLocations reflocations.Store
	ReferenceCatalog   refcatalog.Store
	ReferenceTax       reftax.Store
	Suppliers          *suppliers.Service
	Reports            *reports.Service
	TenantConfig       tenantconfig.Store
	Alerts             *alerts.Service
	POSContext         poscontext.Store
	PricingRules       pricingrules.Store
	AuthMiddleware     func(http.Handler) http.Handler
	CORSAllowedOrigins []string
}

// Server owns the HTTP listener lifecycle, but not the injected database pool.
type Server struct {
	config          Config
	db              Pinger
	catalog         *catalog.Service
	inventory       *inventory.Service
	sales           *sales.Service
	customers       *customers.Service
	auth            *auth.Service
	cash            cash.Store
	menuStore       MenuStore
	purchases       *purchases.Service
	receivables     *receivables.Service
	suppliers       *suppliers.Service
	reports         *reports.Service
	tenantConfig    tenantconfig.Store
	alerts          *alerts.Service
	posContextStore poscontext.Store
	pricingRules    pricingrules.Store
	stopping        atomic.Bool
	http            *http.Server
}

// New applies defaults for zero-valued settings and rejects negative timeouts.
// A nil pinger is allowed: liveness works while readiness returns 503.
func New(cfg Config, db Pinger) (*Server, error) {
	settings := []struct {
		value *time.Duration
		def   time.Duration
	}{
		{&cfg.PingTimeout, time.Second},
		{&cfg.ReadHeaderTimeout, 5 * time.Second},
		{&cfg.ReadTimeout, 15 * time.Second},
		{&cfg.WriteTimeout, 30 * time.Second},
		{&cfg.IdleTimeout, 60 * time.Second},
	}
	for _, setting := range settings {
		if *setting.value < 0 {
			return nil, errors.New("httpapi: timeouts must not be negative")
		}
		if *setting.value == 0 {
			*setting.value = setting.def
		}
	}
	if cfg.Service == "" {
		cfg.Service = "ofirone-api"
	}
	if cfg.Version == "" {
		cfg.Version = "development"
	}
	if cfg.Commit == "" {
		cfg.Commit = "unknown"
	}
	s := &Server{config: cfg, db: db, catalog: cfg.Catalog, inventory: cfg.Inventory, sales: cfg.Sales, customers: cfg.Customers, auth: cfg.Auth, cash: cfg.Cash, menuStore: cfg.Menus, purchases: cfg.Purchases, receivables: cfg.Receivables, suppliers: cfg.Suppliers, reports: cfg.Reports, tenantConfig: cfg.TenantConfig, alerts: cfg.Alerts, posContextStore: cfg.POSContext, pricingRules: cfg.PricingRules}
	base := http.Handler(http.HandlerFunc(s.route))
	base = NewReferenceLocationsHandler(cfg.ReferenceLocations, base)
	base = NewReferenceCatalogHandler(cfg.ReferenceCatalog, base)
	base = NewReferenceTaxHandler(cfg.ReferenceTax, base)
	if cfg.AuthMiddleware != nil {
		public := base
		protected := cfg.AuthMiddleware(base)
		base = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			publicAuth := r.URL.Path == "/api/v1/auth/login" || r.URL.Path == "/api/v1/auth/refresh"
			if r.Method != http.MethodOptions && strings.HasPrefix(r.URL.Path, "/api/v1/") && r.URL.Path != "/api/v1/version" && !publicAuth {
				protected.ServeHTTP(w, r)
				return
			}
			public.ServeHTTP(w, r)
		})
	}
	// CORS must wrap auth so 401/403 responses also include CORS headers.
	base = cors(base, cfg.CORSAllowedOrigins)
	s.http = &http.Server{
		Handler:           RequestID(Recover(base)),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}
	return s, nil
}

func cors(next http.Handler, allowed []string) http.Handler {
	set := make(map[string]struct{}, len(allowed))
	for _, origin := range allowed {
		set[origin] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := set[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Request-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Handler() http.Handler { return s.http.Handler }

// Serve takes ownership of listener. A Server may only be served once.
func (s *Server) Serve(listener net.Listener) error { return s.http.Serve(listener) }

// BeginShutdown makes readiness fail before waiting for in-flight requests.
func (s *Server) BeginShutdown() { s.stopping.Store(true) }

func (s *Server) Shutdown(ctx context.Context) error {
	s.BeginShutdown()
	return s.http.Shutdown(ctx)
}

// Close forcefully closes active connections after a graceful shutdown timeout.
func (s *Server) Close() error {
	s.BeginShutdown()
	return s.http.Close()
}
