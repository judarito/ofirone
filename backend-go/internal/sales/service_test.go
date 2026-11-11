package sales

import (
	"context"
	"testing"
)

type fakeStore struct{ calls int }

func (f *fakeStore) Create(context.Context, Sale) error { f.calls++; return nil }
func (f *fakeStore) List(context.Context, string, int, string, string) (Page, error) {
	return Page{}, nil
}

func TestServiceValidatesBeforePersistence(t *testing.T) {
	f := &fakeStore{}
	s, _ := NewService(f)
	if err := s.Create(context.Background(), Sale{}); err == nil {
		t.Fatal("invalid sale accepted")
	}
	if f.calls != 0 {
		t.Fatal("invalid sale reached store")
	}
}

func TestServicePersistsValidSale(t *testing.T) {
	f := &fakeStore{}
	s, _ := NewService(f)
	sale := Sale{ID: "s1", TenantID: "t1", LocationID: "l1", SaleNumber: 1, Status: Draft, Lines: []Line{{VariantID: "v1", Quantity: 1, UnitPrice: 100}}}
	if err := s.Create(context.Background(), sale); err != nil {
		t.Fatal(err)
	}
	if f.calls != 1 {
		t.Fatalf("store calls = %d", f.calls)
	}
}
