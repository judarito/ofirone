// Package inventory contains the P0 stock rules.
package inventory

import (
	"context"
	"errors"
	"fmt"
)

type Batch struct {
	ID         string
	TenantID   string
	LocationID string
	VariantID  string
	OnHand     int64
	Reserved   int64
	Active     bool
}

type Page struct {
	Items         []Batch
	HasMore       bool
	NextUpdatedAt string
	NextID        string
}

// StockBalance is the general, location/variant-optional stock projection.
type StockBalance struct {
	TenantID     string `json:"tenant_id"`
	LocationID   string `json:"location_id"`
	VariantID    string `json:"variant_id"`
	OnHand       int64  `json:"on_hand"`
	Reserved     int64  `json:"reserved"`
	UpdatedAt    string `json:"updated_at"`
	LocationName string `json:"location_name,omitempty"`
	VariantName  string `json:"variant_name,omitempty"`
	SKU          string `json:"sku,omitempty"`
	Cost         int64  `json:"cost,omitempty"`
	MinStock     int64  `json:"min_stock,omitempty"`
	ProductName  string `json:"product_name,omitempty"`
	IsComponent  bool   `json:"is_component,omitempty"`
}

type StockPage struct {
	Items         []StockBalance `json:"items"`
	HasMore       bool           `json:"has_more"`
	NextUpdatedAt string         `json:"next_updated_at,omitempty"`
	NextID        string         `json:"next_id,omitempty"`
}

// StockStore exposes general stock listings without requiring both filters.
type StockStore interface {
	ListStock(context.Context, string, string, string, int, string, string) (StockPage, error)
}
type Move struct {
	ID           string `json:"movement_id"`
	LocationID   string `json:"location_id"`
	VariantID    string `json:"variant_id"`
	Delta        int64  `json:"quantity_delta"`
	Type         string `json:"movement_type"`
	OccurredAt   string `json:"occurred_at"`
	LocationName string `json:"location_name"`
	ProductName  string `json:"product_name"`
	VariantName  string `json:"variant_name"`
	SKU          string `json:"sku"`
	UnitCost     int64  `json:"unit_cost"`
}
type MovePage struct {
	Items   []Move `json:"items"`
	HasMore bool   `json:"has_more"`
	NextAt  string `json:"next_occurred_at,omitempty"`
	NextID  string `json:"next_id,omitempty"`
}
type MoveStore interface {
	ListMoves(context.Context, string, string, string, int, string, string) (MovePage, error)
}
type Alert struct {
	LocationID string `json:"location_id"`
	VariantID  string `json:"variant_id"`
	OnHand     int64  `json:"on_hand"`
	Reserved   int64  `json:"reserved"`
	MinStock   int64  `json:"min_stock"`
	Available  int64  `json:"available"`
}
type AlertStore interface {
	ListAlerts(context.Context, string, int) ([]Alert, error)
}

type Store interface {
	ListBatches(context.Context, string, string, string, int, string, string) (Page, error)
}
type MutationStore interface {
	ApplyMovement(context.Context, Movement, string) error
}
type AvailabilityStore interface {
	Available(context.Context, string, string, string) (int64, error)
}

var ErrInvalidMovement = errors.New("inventory: invalid movement")

type Movement struct {
	ID         string
	TenantID   string
	LocationID string
	VariantID  string
	Delta      int64
	Type       string
}

func (m Movement) Validate() error {
	if m.ID == "" || m.TenantID == "" || m.LocationID == "" || m.VariantID == "" {
		return fmt.Errorf("%w: identity fields are required", ErrInvalidMovement)
	}
	if m.Delta == 0 {
		return fmt.Errorf("%w: quantity delta cannot be zero", ErrInvalidMovement)
	}
	switch m.Type {
	case "purchase_in", "sale_out", "return_in", "return_out", "adjustment", "transfer_in", "transfer_out", "production_in", "consumption_out", "reservation":
		return nil
	default:
		return fmt.Errorf("%w: unsupported movement type", ErrInvalidMovement)
	}
}

func Available(onHand, reserved int64) (int64, error) {
	if onHand < 0 || reserved < 0 || reserved > onHand {
		return 0, fmt.Errorf("%w: invalid stock quantities", ErrInvalidMovement)
	}
	return onHand - reserved, nil
}
