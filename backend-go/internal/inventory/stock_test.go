package inventory

import (
	"context"
	"testing"
)

type stockStore struct{ page StockPage }

func (s *stockStore) ListBatches(context.Context, string, string, string, int, string, string) (Page, error) {
	return Page{}, nil
}
func (s *stockStore) ListStock(context.Context, string, string, string, int, string, string) (StockPage, error) {
	return s.page, nil
}

func TestListStockFiltersOptional(t *testing.T) {
	store := &stockStore{page: StockPage{Items: []StockBalance{{TenantID: "t", LocationID: "l", VariantID: "v", OnHand: 5}}}}
	svc, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListStock(context.Background(), "t", "", "", 25, "", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].OnHand != 5 {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	if _, err := svc.ListStock(context.Background(), "", "", "", 25, "", ""); err == nil {
		t.Fatal("empty tenant accepted")
	}
	if _, err := svc.ListStock(context.Background(), "t", "", "", 101, "", ""); err == nil {
		t.Fatal("limit > 100 accepted")
	}
	if _, err := svc.ListStock(context.Background(), "t", "", "", 25, "2026-01-01", ""); err == nil {
		t.Fatal("half cursor accepted")
	}
}
