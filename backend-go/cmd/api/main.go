// Command api composes the portable Ofirone operational API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"ofirone/backend-go/internal/alerts"
	"ofirone/backend-go/internal/app"
	"ofirone/backend-go/internal/auth"
	"ofirone/backend-go/internal/cash"
	"ofirone/backend-go/internal/catalog"
	"ofirone/backend-go/internal/config"
	"ofirone/backend-go/internal/customers"
	"ofirone/backend-go/internal/httpapi"
	"ofirone/backend-go/internal/inventory"
	"ofirone/backend-go/internal/logging"
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

// Set by the build; development builds have useful defaults.
var version = "dev"
var commit = "unknown"

func newServer(c config.Config, db httpapi.Pinger, catalogService *catalog.Service, inventoryService *inventory.Service, salesService *sales.Service, customersService *customers.Service, authService *auth.Service, cashStore cash.Store, authMiddleware func(http.Handler) http.Handler) (*httpapi.Server, error) {
	var menuStore httpapi.MenuStore
	var purchaseService *purchases.Service
	var receivablesService *receivables.Service
	var locationRefs reflocations.Store
	var catalogRefs refcatalog.Store
	var taxRefs reftax.Store
	var suppliersService *suppliers.Service
	var reportsService *reports.Service
	var tenantConfigStore tenantconfig.Store
	var alertsService *alerts.Service
	var posContextStore poscontext.Store
	var pricingRulesStore pricingrules.Store
	if pool, ok := db.(*pgxpool.Pool); ok {
		menuStore = httpapi.NewPGMenuStore(pool)
		purchaseService, _ = purchases.NewService(purchases.NewPGStore(pool))
		receivablesService, _ = receivables.NewService(receivables.NewPGStore(pool))
		locationRefs = reflocations.NewPGStore(pool)
		catalogRefs = refcatalog.NewPGStore(pool)
		taxRefs = reftax.NewPGStore(pool)
		suppliersService, _ = suppliers.New(suppliers.NewPGStore(pool))
		reportsService, _ = reports.NewService(reports.NewPGStore(pool))
		tenantConfigStore = tenantconfig.NewPGStore(pool)
		alertsService, _ = alerts.NewService(alerts.NewPGStore(pool))
		posContextStore = poscontext.NewPGStore(pool)
		pricingRulesStore = pricingrules.NewPGStore(pool)
	}
	return httpapi.New(httpapi.Config{
		Service:            "ofirone-api",
		Version:            version,
		Commit:             commit,
		PingTimeout:        c.DBPingTimeout,
		ReadHeaderTimeout:  c.HTTPReadHeaderTimeout,
		ReadTimeout:        c.HTTPReadTimeout,
		WriteTimeout:       c.HTTPWriteTimeout,
		IdleTimeout:        c.HTTPIdleTimeout,
		Catalog:            catalogService,
		Inventory:          inventoryService,
		Sales:              salesService,
		Customers:          customersService,
		Auth:               authService,
		Cash:               cashStore,
		Menus:              menuStore,
		Purchases:          purchaseService,
		Receivables:        receivablesService,
		ReferenceLocations: locationRefs,
		ReferenceCatalog:   catalogRefs,
		ReferenceTax:       taxRefs,
		Suppliers:          suppliersService,
		Reports:            reportsService,
		TenantConfig:       tenantConfigStore,
		Alerts:             alertsService,
		POSContext:         posContextStore,
		PricingRules:       pricingRulesStore,
		AuthMiddleware:     authMiddleware,
		CORSAllowedOrigins: c.CORSAllowedOrigins,
	}, db)
}

func run(ctx context.Context, c config.Config, logger *slog.Logger) error {
	poolConfig, err := pgxpool.ParseConfig(c.DatabaseURL)
	if err != nil {
		return errors.New("invalid DATABASE_URL configuration")
	}
	poolConfig.MaxConns = c.DBMaxConns
	poolConfig.MinConns = 0
	poolConfig.ConnConfig.ConnectTimeout = c.DBPingTimeout
	// Construction is lazy: liveness remains available during DB outages.
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return errors.New("could not initialize PostgreSQL pool")
	}
	defer pool.Close()
	authPool := pool
	if c.AuthDatabaseURL != c.DatabaseURL {
		authConfig, parseErr := pgxpool.ParseConfig(c.AuthDatabaseURL)
		if parseErr != nil {
			return errors.New("invalid AUTH_DATABASE_URL configuration")
		}
		authConfig.MaxConns = 4
		authConfig.MinConns = 0
		authConfig.ConnConfig.ConnectTimeout = c.DBPingTimeout
		authPool, err = pgxpool.NewWithConfig(ctx, authConfig)
		if err != nil {
			return errors.New("could not initialize auth PostgreSQL pool")
		}
		defer authPool.Close()
	}
	catalogStore := catalog.NewPGStore(pool)
	catalogService, err := catalog.NewService(catalogStore)
	if err != nil {
		return errors.New("invalid catalog configuration")
	}
	inventoryService, err := inventory.NewService(inventory.NewPGStore(pool))
	if err != nil {
		return errors.New("invalid inventory configuration")
	}
	salesService, err := sales.NewService(sales.NewPGStore(pool))
	if err != nil {
		return errors.New("invalid sales configuration")
	}
	customersService, err := customers.NewService(customers.NewPGStore(pool))
	if err != nil {
		return errors.New("invalid customers configuration")
	}
	cashStore := cash.NewPGStore(pool)
	var authService *auth.Service
	if c.JWTIssuer != "" {
		issuer, err := auth.NewTokenIssuer(auth.JWTVerifierConfig{Issuer: c.JWTIssuer, Audience: c.JWTAudience, Algorithm: c.JWTAlgorithm, HMACKey: c.JWTHMACKey}, 15*time.Minute)
		if err != nil {
			return errors.New("invalid token issuer")
		}
		loginStore, err := auth.NewPGLoginStore(authPool, 30*24*time.Hour)
		if err != nil {
			return errors.New("invalid login store")
		}
		authService, err = auth.NewService(loginStore, issuer, 30*24*time.Hour)
		if err != nil {
			return errors.New("invalid auth service")
		}
	}
	var authMiddleware func(http.Handler) http.Handler
	if c.JWTIssuer != "" {
		verifier, err := auth.NewJWTVerifier(auth.JWTVerifierConfig{Issuer: c.JWTIssuer, Audience: c.JWTAudience, Algorithm: c.JWTAlgorithm, HMACKey: c.JWTHMACKey})
		if err != nil {
			return errors.New("invalid authentication configuration")
		}
		authMiddleware, err = auth.NewMiddleware(verifier)
		if err != nil {
			return errors.New("invalid authentication middleware")
		}
	}
	server, err := newServer(c, pool, catalogService, inventoryService, salesService, customersService, authService, cashStore, authMiddleware)
	if err != nil {
		return errors.New("invalid HTTP server configuration")
	}
	lifecycle, err := app.New(server, c.ShutdownTimeout)
	if err != nil {
		return errors.New("invalid application lifecycle configuration")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("", strconv.Itoa(c.Port)))
	if err != nil {
		return errors.New("could not bind HTTP listener")
	}
	logger.Info("api listening", "port", c.Port)
	// Run owns the listener and drains HTTP before the deferred pool close.
	if err := lifecycle.Run(ctx, listener); err != nil {
		return errors.New("HTTP serving or graceful shutdown failed")
	}
	return nil
}

func main() {
	c, err := config.Load()
	if err != nil {
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("configuration invalid", "error", err.Error())
		os.Exit(1)
	}
	logger := logging.New(os.Stdout, logging.Options{
		Service:     "ofirone-api",
		Environment: c.Environment,
		Version:     version,
		Level:       c.LogLevel,
	}).With("commit", commit)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, c, logger); err != nil {
		logger.Error("api stopped", "error", err.Error())
		os.Exit(1)
	}
	logger.Info("api stopped")
}
