package auth

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrAuthenticationFailed = errors.New("auth: authentication failed")

type LoginRecord struct {
	Principal    Principal
	PasswordHash string
	SessionID    string
}
type LoginStore interface {
	FindLogin(context.Context, string, TenantID) (LoginRecord, error)
	ConsumeRefresh(context.Context, [32]byte) (LoginRecord, error)
	SaveRefresh(context.Context, string, TenantID, [32]byte, time.Time) error
	RevokeSession(context.Context, string, TenantID) error
}
type LoginResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	SessionID    string
	TenantID     TenantID
}

type Service struct {
	store      LoginStore
	issuer     *TokenIssuer
	refreshTTL time.Duration
	now        func() time.Time
}

func NewService(store LoginStore, issuer *TokenIssuer, refreshTTL time.Duration) (*Service, error) {
	if store == nil || issuer == nil || refreshTTL <= 0 {
		return nil, fmt.Errorf("auth: invalid service configuration")
	}
	return &Service{store: store, issuer: issuer, refreshTTL: refreshTTL, now: time.Now}, nil
}

func (s *Service) Login(ctx context.Context, email string, tenant TenantID, password string) (LoginResult, error) {
	if s == nil || s.store == nil || s.issuer == nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	record, err := s.store.FindLogin(ctx, email, tenant)
	if err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	// When tenant is omitted, FindLogin resolves the user's single/default membership.
	tenant = record.Principal.Tenant.ID
	ok, err := VerifyPassword(password, record.PasswordHash)
	if err != nil || !ok {
		return LoginResult{}, ErrAuthenticationFailed
	}
	now := s.now()
	access, err := s.issuer.Issue(record.Principal, now)
	if err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	raw, hash, err := NewRefreshToken()
	if err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	if err := s.store.SaveRefresh(ctx, record.SessionID, tenant, hash, now.Add(s.refreshTTL)); err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	return LoginResult{AccessToken: access, RefreshToken: raw, ExpiresAt: now.Add(s.issuer.accessTTL), SessionID: record.SessionID, TenantID: record.Principal.Tenant.ID}, nil
}
func (s *Service) Logout(ctx context.Context, session string, tenant TenantID) error {
	return s.store.RevokeSession(ctx, session, tenant)
}

func (s *Service) Refresh(ctx context.Context, raw string) (LoginResult, error) {
	if s == nil || s.store == nil || s.issuer == nil || raw == "" {
		return LoginResult{}, ErrAuthenticationFailed
	}
	record, err := s.store.ConsumeRefresh(ctx, HashRefreshToken(raw))
	if err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	now := s.now()
	access, err := s.issuer.Issue(record.Principal, now)
	if err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	next, hash, err := NewRefreshToken()
	if err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	if err := s.store.SaveRefresh(ctx, record.SessionID, record.Principal.Tenant.ID, hash, now.Add(s.refreshTTL)); err != nil {
		return LoginResult{}, ErrAuthenticationFailed
	}
	return LoginResult{AccessToken: access, RefreshToken: next, ExpiresAt: now.Add(s.issuer.accessTTL), SessionID: record.SessionID, TenantID: record.Principal.Tenant.ID}, nil
}
