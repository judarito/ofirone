package alerts

import (
	"context"
	"testing"
)

type fakeStore struct{}

func (fakeStore) List(context.Context, Filter) (Page, error) {
	return Page{Items: []Alert{{ID: "a1", Type: "STOCK", Level: "LOW_STOCK"}}}, nil
}

func TestFilterValidate(t *testing.T) {
	if err := (Filter{TenantID: "tenant", Limit: 50}).Validate(); err != nil {
		t.Fatalf("valid filter: %v", err)
	}
	if err := (Filter{TenantID: "", Limit: 50}).Validate(); err == nil {
		t.Fatal("expected tenant validation error")
	}
	if err := (Filter{TenantID: "tenant", Limit: 101}).Validate(); err == nil {
		t.Fatal("expected limit validation error")
	}
}

func TestServiceList(t *testing.T) {
	service, err := NewService(fakeStore{})
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.List(context.Background(), Filter{TenantID: "tenant", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Type != "STOCK" {
		t.Fatalf("unexpected page: %+v", page)
	}
}
