// Package app coordinates HTTP startup and bounded graceful shutdown.
package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// Server is implemented by httpapi.Server. Keeping this interface here avoids
// coupling lifecycle coordination to the HTTP router or the module import path.
type Server interface {
	Serve(net.Listener) error
	BeginShutdown()
	Shutdown(context.Context) error
	Close() error
}

type App struct {
	server          Server
	shutdownTimeout time.Duration
}

func New(server Server, shutdownTimeout time.Duration) (*App, error) {
	if server == nil {
		return nil, errors.New("app: server is required")
	}
	if shutdownTimeout <= 0 {
		return nil, errors.New("app: shutdown timeout must be positive")
	}
	return &App{server: server, shutdownTimeout: shutdownTimeout}, nil
}

// Run takes ownership of listener and blocks until the server fails or ctx is
// canceled. Cancellation requests an orderly shutdown and is not an error.
// cmd/api should pass a signal.NotifyContext for SIGINT/SIGTERM, then close its
// pool only after Run returns. Each App is single-use.
func (a *App) Run(ctx context.Context, listener net.Listener) error {
	if listener == nil {
		return errors.New("app: listener is required")
	}
	if ctx.Err() != nil {
		a.server.BeginShutdown()
		return listener.Close()
	}
	served := make(chan error, 1)
	go func() { served <- a.server.Serve(listener) }()

	var serveErr error
	serveReturned := false
	select {
	case serveErr = <-served:
		serveReturned = true
	case <-ctx.Done():
	}
	a.server.BeginShutdown()
	// The parent is already canceled on SIGTERM: use a fresh bounded context so
	// existing requests have time to finish rather than being cut off immediately.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), a.shutdownTimeout)
	defer cancel()
	shutdownErr := a.server.Shutdown(shutdownCtx)
	var closeErr error
	if shutdownErr != nil {
		closeErr = a.server.Close()
	}
	if !serveReturned {
		// Wait for Serve as well as handlers, without exceeding the same deadline.
		select {
		case serveErr = <-served:
		case <-shutdownCtx.Done():
			if shutdownErr == nil {
				shutdownErr = shutdownCtx.Err()
				closeErr = a.server.Close()
			}
		}
	}
	if errors.Is(serveErr, http.ErrServerClosed) {
		serveErr = nil
	}
	if serveErr != nil {
		serveErr = fmt.Errorf("serve HTTP: %w", serveErr)
	}
	if shutdownErr != nil {
		shutdownErr = fmt.Errorf("shutdown HTTP: %w", shutdownErr)
	}
	return errors.Join(serveErr, shutdownErr, closeErr)
}
