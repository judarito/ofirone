package inventory

import (
	"context"
	"testing"
)

type fakeStore struct{}

func (fakeStore) ListBatches(context.Context, string, string, string, int, string, string) (Page, error) {
	return Page{}, nil
}

func TestServiceRejectsPartialCursor(t *testing.T) {
	s, _ := NewService(fakeStore{})
	if _, err := s.ListBatches(context.Background(), "t", "l", "v", 25, "2026-01-01T00:00:00Z", ""); err == nil {
		t.Fatal("partial cursor accepted")
	}
}
