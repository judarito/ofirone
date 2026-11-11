package receivables

import (
	"context"
	"testing"
)

type fakeStore struct{}

func (fakeStore) List(context.Context, string, int, string) (Page, error) { return Page{}, nil }
func (fakeStore) Get(context.Context, string, string) (Account, error)    { return Account{}, nil }
func (fakeStore) Upsert(context.Context, string, AccountInput) (Account, error) {
	return Account{}, nil
}
func (fakeStore) Pay(context.Context, string, Payment) error   { return nil }
func (fakeStore) Charge(context.Context, string, Charge) error { return nil }
func (fakeStore) Movements(context.Context, string, string, int, string, string) (MovementPage, error) {
	return MovementPage{}, nil
}
func (fakeStore) Summary(context.Context, string) (Summary, error) { return Summary{}, nil }

func TestServiceValidatesCXCOperations(t *testing.T) {
	s, err := NewService(fakeStore{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Get(context.Background(), "", "id"); err == nil {
		t.Fatal("expected invalid account")
	}
	if _, err = s.Upsert(context.Background(), "tenant", AccountInput{CustomerID: "customer", CreditLimit: -1}); err == nil {
		t.Fatal("expected invalid limit")
	}
	if err = s.Charge(context.Background(), "tenant", Charge{AccountID: "account"}); err == nil {
		t.Fatal("expected invalid charge")
	}
	if _, err = s.Movements(context.Background(), "tenant", "account", 0, "", ""); err == nil {
		t.Fatal("expected invalid pagination")
	}
	if _, err = s.Summary(context.Background(), ""); err == nil {
		t.Fatal("expected invalid tenant")
	}
}

func TestServiceAcceptsCXCOperations(t *testing.T) {
	s, _ := NewService(fakeStore{})
	if _, err := s.Upsert(context.Background(), "tenant", AccountInput{CustomerID: "customer", CreditLimit: 100}); err != nil {
		t.Fatal(err)
	}
	if err := s.Charge(context.Background(), "tenant", Charge{AccountID: "account", Amount: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Movements(context.Background(), "tenant", "account", 25, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Summary(context.Background(), "tenant"); err != nil {
		t.Fatal(err)
	}
}
