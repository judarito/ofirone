package auth

import (
	"testing"
	"time"
)

func TestIssueAndRefreshToken(t *testing.T) {
	i, err := NewTokenIssuer(JWTVerifierConfig{Issuer: "ofirone", Audience: "api", Algorithm: "HS256", HMACKey: []byte("01234567890123456789012345678901")}, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	raw, hash, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if hash != HashRefreshToken(raw) {
		t.Fatal("refresh hash mismatch")
	}
	token, err := i.Issue(Principal{Identity: Identity{ID: "identity-1"}, Tenant: Tenant{ID: "tenant-1"}, Permissions: []Permission{"sales.create"}}, time.Now())
	if err != nil || token == "" {
		t.Fatalf("issue = %q, %v", token, err)
	}
}
