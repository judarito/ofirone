// Package audit defines the provider-independent audit event contract.
package audit

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInvalidEvent = errors.New("audit: invalid event")

type Event struct {
	ID         string
	TenantID   string
	ActorID    string
	Action     string
	Resource   string
	ResourceID string
	RequestID  string
	Metadata   map[string]any
	CreatedAt  time.Time
}

type Store interface {
	Append(context.Context, Event) error
}

func (e Event) Validate() error {
	if strings.TrimSpace(e.ID) == "" || strings.TrimSpace(e.TenantID) == "" {
		return fmt.Errorf("%w: id and tenant are required", ErrInvalidEvent)
	}
	if !bounded(e.Action, 100) || !bounded(e.Resource, 100) {
		return fmt.Errorf("%w: action and resource must be 1..100 characters", ErrInvalidEvent)
	}
	if e.Metadata == nil {
		return fmt.Errorf("%w: metadata is required", ErrInvalidEvent)
	}
	if e.CreatedAt.IsZero() {
		return fmt.Errorf("%w: created_at is required", ErrInvalidEvent)
	}
	return nil
}

func bounded(value string, max int) bool {
	value = strings.TrimSpace(value)
	return value != "" && len([]rune(value)) <= max
}
