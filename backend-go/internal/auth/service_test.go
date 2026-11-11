package auth

import (
	"context"
	"testing"
	"time"
)

type loginStore struct {
	record LoginRecord
	saved  bool
}

func (s *loginStore) FindLogin(context.Context, string, TenantID) (LoginRecord, error) {
	return s.record, nil
}
func (s *loginStore) ConsumeRefresh(context.Context, [32]byte) (LoginRecord, error) {
	return s.record, nil
}
func (s *loginStore) SaveRefresh(context.Context, string, TenantID, [32]byte, time.Time) error {
	s.saved = true
	return nil
}
func (s *loginStore) RevokeSession(context.Context, string, TenantID) error { return nil }

func TestLoginCreatesAccessAndRefreshTokens(t *testing.T) {
	h, _ := HashPassword("correct horse battery staple")
	ls := &loginStore{record: LoginRecord{Principal: Principal{Identity: Identity{ID: "i"}, Tenant: Tenant{ID: "t"}}, PasswordHash: h, SessionID: "s"}}
	i, _ := NewTokenIssuer(JWTVerifierConfig{Issuer: "o", Audience: "a", Algorithm: "HS256", HMACKey: []byte("01234567890123456789012345678901")}, time.Minute)
	s, _ := NewService(ls, i, time.Hour)
	result, err := s.Login(context.Background(), "a@b.test", "t", "correct horse battery staple")
	if err != nil || result.AccessToken == "" || result.RefreshToken == "" || !ls.saved {
		t.Fatalf("login = %#v, %v", result, err)
	}
}
