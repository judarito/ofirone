package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type TokenIssuer struct {
	issuer, audience, algorithm string
	key                         []byte
	accessTTL                   time.Duration
}

func NewTokenIssuer(cfg JWTVerifierConfig, accessTTL time.Duration) (*TokenIssuer, error) {
	if _, err := NewJWTVerifier(cfg); err != nil {
		return nil, err
	}
	if accessTTL <= 0 || accessTTL > 24*time.Hour {
		return nil, fmt.Errorf("auth: invalid access token ttl")
	}
	return &TokenIssuer{issuer: cfg.Issuer, audience: cfg.Audience, algorithm: cfg.Algorithm, key: append([]byte(nil), cfg.HMACKey...), accessTTL: accessTTL}, nil
}

func (i *TokenIssuer) Issue(principal Principal, now time.Time) (string, error) {
	if i == nil || !principal.Valid() {
		return "", ErrInvalidPrincipal
	}
	claims := jwt.MapClaims{"iss": i.issuer, "aud": i.audience, "sub": string(principal.Identity.ID), "identity_id": string(principal.Identity.ID), "tenant_id": string(principal.Tenant.ID), "permissions": principal.Permissions, "iat": now.Unix(), "exp": now.Add(i.accessTTL).Unix()}
	token := jwt.NewWithClaims(jwt.GetSigningMethod(i.algorithm), claims)
	token.Header["kid"] = "ofirone-current"
	return token.SignedString(i.key)
}

func NewRefreshToken() (raw string, hash [32]byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", hash, err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	hash = sha256.Sum256([]byte(raw))
	return raw, hash, nil
}

func HashRefreshToken(raw string) [32]byte { return sha256.Sum256([]byte(strings.TrimSpace(raw))) }
