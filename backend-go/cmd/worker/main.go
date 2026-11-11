// Command worker processes portable PostgreSQL-backed asynchronous jobs.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	"ofirone/backend-go/internal/config"
	"ofirone/backend-go/internal/logging"
)

func run(ctx context.Context, c config.Config, logger *slog.Logger) error {
	if c.WorkerTenantID == "" {
		return errors.New("WORKER_TENANT_ID is required")
	}
	poolConfig, err := pgxpool.ParseConfig(c.DatabaseURL)
	if err != nil {
		return errors.New("invalid DATABASE_URL configuration")
	}
	poolConfig.MaxConns = c.DBMaxConns
	poolConfig.ConnConfig.ConnectTimeout = c.DBPingTimeout
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return errors.New("could not initialize PostgreSQL pool")
	}
	defer pool.Close()
	// Fail closed until concrete job handlers are registered. Starting a worker
	// with a placeholder would claim production work and mark it failed.
	return errors.New("worker job handlers are not configured")
}

func main() {
	c, err := config.Load()
	if err != nil {
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("configuration invalid", "error", err.Error())
		os.Exit(1)
	}
	logger := logging.New(os.Stdout, logging.Options{Service: "ofirone-worker", Environment: c.Environment, Version: "dev", Level: c.LogLevel})
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, c, logger); err != nil {
		logger.Error("worker stopped", "error", err.Error())
		os.Exit(1)
	}
	logger.Info("worker stopped")
}
