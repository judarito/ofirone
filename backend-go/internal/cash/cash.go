package cash

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrInvalid = errors.New("cash: invalid operation")

type Session struct {
	ID, TenantID, LocationID, OpenedBy, OpenKey string
	OpeningFloat                                int64
}
type Movement struct {
	ID, SessionID, TenantID, CreatedBy, Type, Direction, Reason, Key string
	Amount                                                           int64
}
type ExpiredSession struct {
	ID         string    `json:"cash_session_id"`
	LocationID string    `json:"location_id"`
	Status     string    `json:"status"`
	OpenedAt   time.Time `json:"opened_at"`
	OpenedBy   string    `json:"opened_by_identity_id"`
}
type Store interface {
	Open(context.Context, Session) error
	Move(context.Context, Movement) error
	Close(context.Context, string, string, string, int64, string) error
}
type ExpiredLister interface {
	ListExpired(context.Context, string, time.Duration, int) ([]ExpiredSession, error)
}
type SessionLister interface {
	List(context.Context, string, string, string, int) ([]ExpiredSession, error)
}

func (s Session) Validate() error {
	if s.ID == "" || s.TenantID == "" || s.LocationID == "" || s.OpenedBy == "" || s.OpenKey == "" || s.OpeningFloat < 0 {
		return fmt.Errorf("%w: invalid session", ErrInvalid)
	}
	return nil
}
func (m Movement) Validate() error {
	if m.ID == "" || m.SessionID == "" || m.TenantID == "" || m.CreatedBy == "" || m.Key == "" || m.Amount <= 0 {
		return fmt.Errorf("%w: invalid movement", ErrInvalid)
	}
	if (m.Type != "cash_in" && m.Type != "cash_out" && m.Type != "adjustment") || (m.Type == "cash_in" && m.Direction != "in") || (m.Type == "cash_out" && m.Direction != "out") {
		return fmt.Errorf("%w: invalid type/direction", ErrInvalid)
	}
	if m.Type != "cash_in" && m.Reason == "" {
		return fmt.Errorf("%w: reason required", ErrInvalid)
	}
	return nil
}
