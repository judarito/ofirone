package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func jwtTestConfig() JWTVerifierConfig {
	return JWTVerifierConfig{
		Issuer: "https://identity.example.test", Audience: "ofirone-api",
		Algorithm: "HS256", HMACKey: []byte(strings.Repeat("k", 64)),
	}
}

func jwtTestClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"iss": "https://identity.example.test", "aud": "ofirone-api",
		"exp": now.Add(time.Hour).Unix(), "nbf": now.Add(-time.Minute).Unix(),
		"identity_id": "user-1", "tenant_id": "tenant-1",
		"permissions": []string{"sales:read"},
	}
}

func signTestJWT(t *testing.T, claims jwt.Claims, method jwt.SigningMethod, key any) string {
	t.Helper()
	token, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func newTestJWTVerifier(t *testing.T, config JWTVerifierConfig) *JWTVerifier {
	t.Helper()
	verifier, err := NewJWTVerifier(config)
	if err != nil {
		t.Fatal(err)
	}
	return verifier
}

func TestJWTVerifierValidTokens(t *testing.T) {
	for _, algorithm := range []string{"HS256", "HS384", "HS512"} {
		t.Run(algorithm, func(t *testing.T) {
			t.Parallel()
			config := jwtTestConfig()
			config.Algorithm = algorithm
			verifier := newTestJWTVerifier(t, config)
			token := signTestJWT(t, jwtTestClaims(), jwt.GetSigningMethod(algorithm), config.HMACKey)
			principal, err := verifier.Verify(context.Background(), token)
			if err != nil || !reflect.DeepEqual(principal, testPrincipal()) {
				t.Fatalf("principal=%+v err=%v", principal, err)
			}
			if principal.HasPermission("*") || principal.HasPermission("sales:write") {
				t.Fatal("unexpected authority")
			}
		})
	}
}

func TestJWTVerifierValidClaimVariants(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(jwt.MapClaims)
	}{
		{"audience array", func(c jwt.MapClaims) { c["aud"] = []string{"other-api", "ofirone-api"} }},
		{"no not-before", func(c jwt.MapClaims) { delete(c, "nbf") }},
		{"no permissions granted", func(c jwt.MapClaims) { c["permissions"] = []string{} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := jwtTestConfig()
			claims := jwtTestClaims()
			tc.change(claims)
			token := signTestJWT(t, claims, jwt.SigningMethodHS256, config.HMACKey)
			principal, err := newTestJWTVerifier(t, config).Verify(context.Background(), token)
			if err != nil || !principal.Valid() {
				t.Fatalf("valid claims rejected: %v", err)
			}
			if tc.name == "no permissions granted" && len(principal.Permissions) != 0 {
				t.Fatal("empty permissions granted authority")
			}
		})
	}
}

func TestJWTVerifierRejectsInvalidClaims(t *testing.T) {
	for _, tc := range []struct {
		name    string
		claim   string
		value   any
		missing bool
		expired bool
	}{
		{name: "expired", claim: "exp", value: time.Now().Add(-time.Hour).Unix(), expired: true},
		{name: "expiry required", claim: "exp", missing: true},
		{name: "null expiry", claim: "exp", value: nil},
		{name: "invalid expiry type", claim: "exp", value: true},
		{name: "future not-before", claim: "nbf", value: time.Now().Add(time.Hour).Unix()},
		{name: "invalid not-before type", claim: "nbf", value: true},
		{name: "wrong issuer", claim: "iss", value: "https://untrusted.example.test"},
		{name: "missing issuer", claim: "iss", missing: true},
		{name: "invalid issuer type", claim: "iss", value: 123},
		{name: "wrong audience", claim: "aud", value: "other-api"},
		{name: "missing audience", claim: "aud", missing: true},
		{name: "wrong audience array", claim: "aud", value: []string{"other-api"}},
		{name: "invalid audience type", claim: "aud", value: 123},
		{name: "missing identity", claim: "identity_id", missing: true},
		{name: "null identity", claim: "identity_id", value: nil},
		{name: "empty identity", claim: "identity_id", value: ""},
		{name: "identity whitespace", claim: "identity_id", value: " user-1"},
		{name: "identity control", claim: "identity_id", value: "user\x00-1"},
		{name: "invalid identity type", claim: "identity_id", value: 123},
		{name: "missing tenant", claim: "tenant_id", missing: true},
		{name: "null tenant", claim: "tenant_id", value: nil},
		{name: "empty tenant", claim: "tenant_id", value: ""},
		{name: "tenant whitespace", claim: "tenant_id", value: "tenant 1"},
		{name: "invalid tenant type", claim: "tenant_id", value: []string{"tenant-1"}},
		{name: "missing permissions", claim: "permissions", missing: true},
		{name: "null permissions", claim: "permissions", value: nil},
		{name: "string permissions", claim: "permissions", value: "sales:read"},
		{name: "object permissions", claim: "permissions", value: map[string]bool{"sales:read": true}},
		{name: "numeric permission", claim: "permissions", value: []any{123}},
		{name: "null permission", claim: "permissions", value: []any{nil}},
		{name: "empty permission", claim: "permissions", value: []string{""}},
		{name: "permission whitespace", claim: "permissions", value: []string{"sales:read "}},
		{name: "permission control", claim: "permissions", value: []string{"sales:\nread"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := jwtTestConfig()
			claims := jwtTestClaims()
			if tc.missing {
				delete(claims, tc.claim)
			} else {
				claims[tc.claim] = tc.value
			}
			token := signTestJWT(t, claims, jwt.SigningMethodHS256, config.HMACKey)
			principal, err := newTestJWTVerifier(t, config).Verify(context.Background(), token)
			if !errors.Is(err, ErrInvalidToken) || !reflect.DeepEqual(principal, Principal{}) {
				t.Fatalf("rejected token returned authority or wrong error: principal=%+v err=%v", principal, err)
			}
			if errors.Is(err, ErrExpiredToken) != tc.expired {
				t.Fatalf("wrong expiry classification: %v", err)
			}
			if strings.Contains(err.Error(), token) || strings.Contains(err.Error(), string(config.HMACKey)) {
				t.Fatal("verification error exposed secrets")
			}
		})
	}
}

func TestJWTVerifierRejectsSignatureAndAlgorithm(t *testing.T) {
	config := jwtTestConfig()
	verifier := newTestJWTVerifier(t, config)
	for _, tc := range []struct {
		name   string
		method jwt.SigningMethod
		key    any
	}{
		{"wrong signature", jwt.SigningMethodHS256, []byte(strings.Repeat("x", 64))},
		{"different HMAC algorithm", jwt.SigningMethodHS512, config.HMACKey},
		{"unsigned token", jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := signTestJWT(t, jwtTestClaims(), tc.method, tc.key)
			principal, err := verifier.Verify(context.Background(), token)
			if !errors.Is(err, ErrInvalidToken) || !reflect.DeepEqual(principal, Principal{}) {
				t.Fatalf("signature or algorithm accepted: %v", err)
			}
		})
	}
	for _, token := range []string{"", "malformed", "a.b.c", strings.Repeat("x", 8193)} {
		if _, err := verifier.Verify(context.Background(), token); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("malformed token accepted: %v", err)
		}
	}
}

func TestNewJWTVerifierRejectsInvalidConfig(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*JWTVerifierConfig)
	}{
		{"missing issuer", func(c *JWTVerifierConfig) { c.Issuer = "" }},
		{"issuer whitespace", func(c *JWTVerifierConfig) { c.Issuer = " issuer" }},
		{"missing audience", func(c *JWTVerifierConfig) { c.Audience = "" }},
		{"audience control", func(c *JWTVerifierConfig) { c.Audience = "api\n" }},
		{"missing algorithm", func(c *JWTVerifierConfig) { c.Algorithm = "" }},
		{"none algorithm", func(c *JWTVerifierConfig) { c.Algorithm = "none" }},
		{"asymmetric algorithm", func(c *JWTVerifierConfig) { c.Algorithm = "RS256" }},
		{"missing key", func(c *JWTVerifierConfig) { c.HMACKey = nil }},
		{"short HS256 key", func(c *JWTVerifierConfig) { c.HMACKey = make([]byte, 31) }},
		{"short HS384 key", func(c *JWTVerifierConfig) { c.Algorithm = "HS384"; c.HMACKey = make([]byte, 47) }},
		{"short HS512 key", func(c *JWTVerifierConfig) { c.Algorithm = "HS512"; c.HMACKey = make([]byte, 63) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := jwtTestConfig()
			tc.change(&config)
			verifier, err := NewJWTVerifier(config)
			if err == nil || verifier != nil {
				t.Fatal("invalid configuration accepted")
			}
			if len(config.HMACKey) > 0 && strings.Contains(err.Error(), string(config.HMACKey)) {
				t.Fatal("configuration error exposed the key")
			}
		})
	}
}

func TestJWTVerifierCopiesKeyAndPermissions(t *testing.T) {
	config := jwtTestConfig()
	verifier := newTestJWTVerifier(t, config)
	token := signTestJWT(t, jwtTestClaims(), jwt.SigningMethodHS256, config.HMACKey)
	config.HMACKey[0] = 'x'
	principal, err := verifier.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("caller mutated verifier key: %v", err)
	}
	principal.Permissions[0] = "sales:write"
	for i := 0; i < 8; i++ {
		t.Run("concurrent verification", func(t *testing.T) {
			t.Parallel()
			principal, err := verifier.Verify(context.Background(), token)
			if err != nil || !reflect.DeepEqual(principal, testPrincipal()) {
				t.Fatalf("verification state leaked: principal=%+v err=%v", principal, err)
			}
		})
	}
}

func TestJWTVerifierCancelledAndUninitialized(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if principal, err := newTestJWTVerifier(t, jwtTestConfig()).Verify(ctx, "ignored"); !errors.Is(err, context.Canceled) || principal.Valid() {
		t.Fatalf("cancellation ignored: %v", err)
	}
	for _, verifier := range []*JWTVerifier{nil, {}} {
		if _, err := verifier.Verify(context.Background(), "ignored"); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("uninitialized verifier accepted token: %v", err)
		}
	}
}

func TestJWTVerifierWithBearerMiddleware(t *testing.T) {
	config := jwtTestConfig()
	middleware, err := NewMiddleware(newTestJWTVerifier(t, config))
	if err != nil {
		t.Fatal(err)
	}
	for _, valid := range []bool{true, false} {
		claims := jwtTestClaims()
		if !valid {
			claims["tenant_id"] = ""
		}
		token := signTestJWT(t, claims, jwt.SigningMethodHS256, config.HMACKey)
		called := false
		handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			principal, ok := PrincipalFromContext(r.Context())
			if !ok || !reflect.DeepEqual(principal, testPrincipal()) {
				t.Fatal("verified claims did not reach request context")
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		r := httptest.NewRequest(http.MethodGet, "/protected", nil)
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-Tenant-ID", "untrusted-tenant")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		wantStatus := http.StatusUnauthorized
		if valid {
			wantStatus = http.StatusNoContent
		}
		if w.Code != wantStatus || called != valid {
			t.Fatalf("status=%d called=%t for valid=%t", w.Code, called, valid)
		}
	}
}
