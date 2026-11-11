package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type refreshStore struct {
	record    LoginRecord
	calls     int
	failAfter int
	saved     int
}

func (s *refreshStore) FindLogin(context.Context, string, TenantID) (LoginRecord, error) {
	return s.record, nil
}
func (s *refreshStore) ConsumeRefresh(context.Context, [32]byte) (LoginRecord, error) {
	s.calls++
	if s.failAfter > 0 && s.calls > s.failAfter {
		return LoginRecord{}, ErrAuthenticationFailed
	}
	return s.record, nil
}
func (s *refreshStore) SaveRefresh(context.Context, string, TenantID, [32]byte, time.Time) error {
	s.saved++
	return nil
}
func (s *refreshStore) RevokeSession(context.Context, string, TenantID) error { return nil }

func testIssuer(t *testing.T) *TokenIssuer {
	t.Helper()
	i, err := NewTokenIssuer(JWTVerifierConfig{Issuer: "o", Audience: "a", Algorithm: "HS256", HMACKey: []byte("01234567890123456789012345678901")}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestRefreshUsedOnceAndRevokedSession(t *testing.T) {
	store := &refreshStore{record: LoginRecord{Principal: Principal{Identity: Identity{ID: "i"}, Tenant: Tenant{ID: "t"}}, SessionID: "s"}, failAfter: 1}
	svc, err := NewService(store, testIssuer(t), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Refresh(context.Background(), "raw"); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	if _, err := svc.Refresh(context.Background(), "raw"); !errors.Is(err, ErrAuthenticationFailed) {
		t.Fatalf("second refresh err=%v", err)
	}
	revoked := &refreshStore{failAfter: 1}
	svc2, _ := NewService(revoked, testIssuer(t), time.Hour)
	if _, err := svc2.Refresh(context.Background(), "raw"); !errors.Is(err, ErrAuthenticationFailed) {
		t.Fatalf("revoked refresh err=%v", err)
	}
}

func TestExpiredJWTRejected(t *testing.T) {
	issuer := testIssuer(t)
	principal := Principal{Identity: Identity{ID: "i"}, Tenant: Tenant{ID: "t"}}
	token, err := issuer.Issue(principal, time.Now().Add(-2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := NewJWTVerifier(JWTVerifierConfig{Issuer: "o", Audience: "a", Algorithm: "HS256", HMACKey: []byte("01234567890123456789012345678901")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Verify(context.Background(), token); err == nil {
		t.Fatal("expired token accepted")
	}
}
