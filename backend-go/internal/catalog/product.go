// Package catalog contains the P0 product and variant domain.
package catalog

import (
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidProduct = errors.New("catalog: invalid product")

type Product struct {
	ID          string
	TenantID    string
	Code        string
	Name        string
	ProductType string
	Active      bool
}

type Variant struct {
	ID          string
	TenantID    string
	ProductID   string
	ProductName string
	SKU         string
	Name        string
	Cost        int64
	SalePrice   int64
	StockOnHand int64 `json:"stock_on_hand"`
	Active      bool
}

func (p Product) Validate() error {
	if blank(p.ID) || blank(p.TenantID) || !bounded(p.Code, 100) || !bounded(p.Name, 250) {
		return fmt.Errorf("%w: identity, code and name are required", ErrInvalidProduct)
	}
	switch p.ProductType {
	case "stocked", "service", "manufactured", "on_demand":
		return nil
	default:
		return fmt.Errorf("%w: unsupported product type", ErrInvalidProduct)
	}
}

func (v Variant) Validate() error {
	if blank(v.ID) || blank(v.TenantID) || blank(v.ProductID) || !bounded(v.SKU, 150) || !bounded(v.Name, 250) {
		return fmt.Errorf("%w: variant identity and names are required", ErrInvalidProduct)
	}
	if v.Cost < 0 || v.SalePrice < 0 {
		return fmt.Errorf("%w: prices cannot be negative", ErrInvalidProduct)
	}
	return nil
}

func blank(value string) bool { return strings.TrimSpace(value) == "" }

func bounded(value string, max int) bool {
	value = strings.TrimSpace(value)
	return value != "" && len([]rune(value)) <= max
}
