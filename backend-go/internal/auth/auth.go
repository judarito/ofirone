// Package auth defines provider-independent authentication ports and request context.
package auth

import (
	"context"
	"errors"
	"strings"
)

type IdentityID string
type TenantID string
type Permission string

type Identity struct {
	ID IdentityID `json:"id"`
}

type Tenant struct {
	ID TenantID `json:"id"`
}

// Principal is verified, tenant-scoped authority. Permissions must be resolved
// by the verifier for this tenant, never taken from request headers or query data.
type Principal struct {
	Identity    Identity     `json:"identity"`
	Tenant      Tenant       `json:"tenant"`
	Permissions []Permission `json:"permissions"`
}

func (p Principal) Valid() bool {
	return validID(string(p.Identity.ID)) && validID(string(p.Tenant.ID))
}

func validID(id string) bool { return id != "" && strings.TrimSpace(id) == id }

// HasPermission matches exactly; no implicit wildcard or administrator bypass.
func (p Principal) HasPermission(permission Permission) bool {
	if permission == "" {
		return false
	}
	for _, granted := range p.Permissions {
		if granted == permission {
			return true
		}
	}
	return false
}

var (
	ErrInvalidToken     = errors.New("invalid authentication token")
	ErrExpiredToken     = errors.New("expired authentication token")
	ErrInvalidPrincipal = errors.New("identity and tenant are required")
)

// TokenVerifier validates the complete token and returns its authorized tenant
// and permissions. Implementations own signature, issuer, audience, expiry and
// revocation checks as applicable. Wrap rejection errors with ErrInvalidToken
// or ErrExpiredToken; other errors indicate verifier unavailability.
type TokenVerifier interface {
	Verify(ctx context.Context, token string) (Principal, error)
}

type principalKey struct{}

// WithPrincipal must only be called after verification by trusted server code.
// It copies mutable state so later changes cannot alter request authority.
func WithPrincipal(ctx context.Context, principal Principal) (context.Context, error) {
	if !principal.Valid() {
		return ctx, ErrInvalidPrincipal
	}
	return context.WithValue(ctx, principalKey{}, clone(principal)), nil
}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	if !ok || !principal.Valid() {
		return Principal{}, false
	}
	return clone(principal), true
}

func IdentityFromContext(ctx context.Context) (Identity, bool) {
	p, ok := PrincipalFromContext(ctx)
	return p.Identity, ok
}

func TenantFromContext(ctx context.Context) (Tenant, bool) {
	p, ok := PrincipalFromContext(ctx)
	return p.Tenant, ok
}

func HasPermission(ctx context.Context, permission Permission) bool {
	p, ok := PrincipalFromContext(ctx)
	return ok && p.HasPermission(permission)
}

func clone(p Principal) Principal {
	p.Permissions = append([]Permission(nil), p.Permissions...)
	return p
}
