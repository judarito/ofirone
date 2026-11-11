package sales

import (
	"context"
	"testing"
)

type secondaryStore struct{}

func (secondaryStore) Create(context.Context, Sale) error { return nil }
func (secondaryStore) List(context.Context, string, int, string, string) (Page, error) {
	return Page{}, nil
}
func (secondaryStore) Get(context.Context, string, string) (Detail, error) {
	return Detail{Sale: Summary{ID: "s1"}}, nil
}
func (secondaryStore) SetStatus(context.Context, string, string, Status) error { return nil }
func TestSecondaryOperations(t *testing.T) {
	s, _ := NewService(secondaryStore{})
	if _, e := s.Get(context.Background(), "t1", "s1"); e != nil {
		t.Fatal(e)
	}
	if e := s.Void(context.Background(), "t1", "s1"); e != nil {
		t.Fatal(e)
	}
}
