package purchases

import (
	"context"
	"testing"
)

type secondaryStore struct{}

func (secondaryStore) CreateReceived(context.Context, Purchase) error { return nil }
func (secondaryStore) List(context.Context, string, int, string, string) (Page, error) {
	return Page{}, nil
}
func (secondaryStore) Get(context.Context, string, string) (Detail, error) {
	return Detail{Purchase: Purchase{ID: "p1"}}, nil
}
func (secondaryStore) Cancel(context.Context, string, string) error { return nil }
func TestSecondaryOperations(t *testing.T) {
	s, _ := NewService(secondaryStore{})
	if _, e := s.Get(context.Background(), "t1", "p1"); e != nil {
		t.Fatal(e)
	}
	if e := s.Cancel(context.Background(), "t1", "p1"); e != nil {
		t.Fatal(e)
	}
}
