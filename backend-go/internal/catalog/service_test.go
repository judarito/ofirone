package catalog

import (
	"context"
	"testing"
)

type fakeStore struct {
	created []Product
	page    ProductPage
}

func (f *fakeStore) CreateProduct(_ context.Context, p Product) error {
	f.created = append(f.created, p)
	return nil
}
func (f *fakeStore) ListProducts(_ context.Context, _ string, _ int, _, _ string) (ProductPage, error) {
	return f.page, nil
}

func TestServiceValidatesBeforeStore(t *testing.T) {
	fake := &fakeStore{}
	s, err := NewService(fake)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateProduct(context.Background(), Product{}); err == nil {
		t.Fatal("invalid product accepted")
	}
	if len(fake.created) != 0 {
		t.Fatal("invalid product reached store")
	}
}

func TestServiceRequiresCompleteCursor(t *testing.T) {
	s, _ := NewService(&fakeStore{})
	if _, err := s.ListProducts(context.Background(), "tenant-1", 25, "Product", ""); err == nil {
		t.Fatal("partial cursor accepted")
	}
}

func TestServiceDelegatesValidList(t *testing.T) {
	expected := ProductPage{Items: []Product{{ID: "p1"}}, HasMore: true, NextName: "Product", NextID: "p1"}
	s, _ := NewService(&fakeStore{page: expected})
	got, err := s.ListProducts(context.Background(), "tenant-1", 25, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || !got.HasMore {
		t.Fatalf("unexpected page: %#v", got)
	}
}
