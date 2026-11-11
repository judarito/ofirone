package sales

import "context"

type Store interface {
	Create(context.Context, Sale) error
	List(context.Context, string, int, string, string) (Page, error)
}
type DetailStore interface {
	Get(context.Context, string, string) (Detail, error)
	SetStatus(context.Context, string, string, Status) error
}
type Detail struct {
	Sale     Summary   `json:"sale"`
	Lines    []Line    `json:"lines"`
	Payments []Payment `json:"payments"`
}

type Summary struct {
	ID         string `json:"id"`
	TenantID   string `json:"tenant_id"`
	LocationID string `json:"location_id"`
	SaleNumber int64  `json:"sale_number"`
	Status     Status `json:"status"`
	Total      int64  `json:"total"`
	SoldAt     string `json:"sold_at"`
}
type Page struct {
	Items      []Summary `json:"items"`
	HasMore    bool      `json:"has_more"`
	NextSoldAt string    `json:"next_sold_at,omitempty"`
	NextID     string    `json:"next_id,omitempty"`
}
