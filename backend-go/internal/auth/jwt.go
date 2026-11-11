package auth

import (
	"context"
	"errors"
	"strings"
	"unicode"

	"github.com/golang-jwt/jwt/v5"
)

// JWTVerifierConfig pins the trust boundary for tenant-scoped access tokens.
// HMACKey must contain at least 32, 48 or 64 random bytes for HS256, HS384 or
// HS512 respectively. Provision it externally; never derive it from a token.
type JWTVerifierConfig struct {
	Issuer    string
	Audience  string
	Algorithm string
	HMACKey   []byte
}

// JWTVerifier validates JWTs using one configured HMAC algorithm and a private
// copy of the injected key. It is safe for concurrent use. It does not perform
// session revocation or membership lookups; authority comes from the issuer.
type JWTVerifier struct {
	parser    *jwt.Parser
	algorithm string
	key       []byte
}

var _ TokenVerifier = (*JWTVerifier)(nil)

// NewJWTVerifier rejects incomplete or unsupported configuration at startup.
func NewJWTVerifier(config JWTVerifierConfig) (*JWTVerifier, error) {
	if !validJWTValue(config.Issuer) {
		return nil, errors.New("auth: JWT issuer is required and must not contain whitespace or control characters")
	}
	if !validJWTValue(config.Audience) {
		return nil, errors.New("auth: JWT audience is required and must not contain whitespace or control characters")
	}
	var minimumKeyBytes int
	switch config.Algorithm {
	case jwt.SigningMethodHS256.Alg():
		minimumKeyBytes = 32
	case jwt.SigningMethodHS384.Alg():
		minimumKeyBytes = 48
	case jwt.SigningMethodHS512.Alg():
		minimumKeyBytes = 64
	default:
		return nil, errors.New("auth: JWT algorithm must be HS256, HS384 or HS512")
	}
	if len(config.HMACKey) < minimumKeyBytes {
		return nil, errors.New("auth: JWT HMAC key is shorter than the configured algorithm requires")
	}
	return &JWTVerifier{
		parser: jwt.NewParser(
			jwt.WithValidMethods([]string{config.Algorithm}),
			jwt.WithIssuer(config.Issuer),
			jwt.WithAudience(config.Audience),
			jwt.WithExpirationRequired(),
			jwt.WithStrictDecoding(),
		),
		algorithm: config.Algorithm,
		key:       append([]byte(nil), config.HMACKey...),
	}, nil
}

type tenantJWTClaims struct {
	jwt.RegisteredClaims
	IdentityID  string       `json:"identity_id"`
	TenantID    string       `json:"tenant_id"`
	Permissions []Permission `json:"permissions"`
}

// Validate adds application claims checks to the library's registered-claims
// validation. An explicit empty permissions array grants no permissions; an
// omitted or null array is rejected as an invalid token contract.
func (c tenantJWTClaims) Validate() error {
	if !validJWTValue(c.IdentityID) || !validJWTValue(c.TenantID) || c.Permissions == nil {
		return ErrInvalidToken
	}
	for _, permission := range c.Permissions {
		if !validJWTValue(string(permission)) {
			return ErrInvalidToken
		}
	}
	return nil
}

// Verify validates the signature, algorithm, issuer, audience, required expiry,
// optional not-before and application claims before exposing any authority.
// Rejections return package sentinels, never token contents or parser details.
func (v *JWTVerifier) Verify(ctx context.Context, rawToken string) (Principal, error) {
	if err := ctx.Err(); err != nil {
		return Principal{}, err
	}
	if v == nil || v.parser == nil || rawToken == "" || len(rawToken) > 8192 {
		return Principal{}, ErrInvalidToken
	}
	claims := new(tenantJWTClaims)
	token, err := v.parser.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (any, error) {
		method, ok := token.Method.(*jwt.SigningMethodHMAC)
		if !ok || method.Alg() != v.algorithm {
			return nil, ErrInvalidToken
		}
		return v.key, nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return Principal{}, errors.Join(ErrInvalidToken, ErrExpiredToken)
		}
		return Principal{}, ErrInvalidToken
	}
	if token == nil || !token.Valid {
		return Principal{}, ErrInvalidToken
	}
	if err := ctx.Err(); err != nil {
		return Principal{}, err
	}
	return Principal{
		Identity:    Identity{ID: IdentityID(claims.IdentityID)},
		Tenant:      Tenant{ID: TenantID(claims.TenantID)},
		Permissions: append([]Permission(nil), claims.Permissions...),
	}, nil
}

func validJWTValue(value string) bool {
	return value != "" && !strings.ContainsFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	})
}
