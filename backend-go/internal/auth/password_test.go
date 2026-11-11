package auth

import "testing"

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := VerifyPassword("correct horse battery staple", hash); err != nil || !ok {
		t.Fatalf("valid password: %v %v", ok, err)
	}
	if ok, err := VerifyPassword("wrong password", hash); err != nil || ok {
		t.Fatalf("wrong password: %v %v", ok, err)
	}
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short password accepted")
	}
}
