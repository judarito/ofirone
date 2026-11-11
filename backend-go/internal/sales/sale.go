// Package sales contains the P0 sale and payment rules.
package sales

import (
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidSale = errors.New("sales: invalid sale")

type Status string

const (
	Draft             Status = "draft"
	Completed         Status = "completed"
	Voided            Status = "voided"
	Returned          Status = "returned"
	PartiallyReturned Status = "partially_returned"
)

type Line struct {
	VariantID string `json:"variant_id"`
	BatchID   string `json:"batch_id"`
	Quantity  int64  `json:"quantity"`
	UnitPrice int64  `json:"unit_price"`
	Discount  int64  `json:"discount"`
	Tax       int64  `json:"tax"`
}
type Payment struct {
	MethodID   string `json:"method_id"`
	MethodCode string `json:"payment_method_code"`
	Amount     int64  `json:"amount"`
	Reference  string `json:"reference"`
}
type Sale struct {
	ID, TenantID, LocationID, CreatedByIdentityID, CustomerID, CashSessionID, IdempotencyKey string
	SaleNumber                                                                               int64
	Status                                                                                   Status
	Lines                                                                                    []Line
	Payments                                                                                 []Payment
	Subtotal, Tax, Discount, Total                                                           int64
}

func (l Line) Total() (int64, error) {
	if l.VariantID == "" || l.Quantity <= 0 || l.UnitPrice < 0 || l.Discount < 0 || l.Tax < 0 {
		return 0, fmt.Errorf("%w: invalid line", ErrInvalidSale)
	}
	total := l.Quantity*l.UnitPrice + l.Tax - l.Discount
	if total < 0 {
		return 0, fmt.Errorf("%w: discount exceeds line value", ErrInvalidSale)
	}
	return total, nil
}

func (s *Sale) Recalculate() error {
	if s == nil || s.ID == "" || s.TenantID == "" || s.LocationID == "" || s.SaleNumber < 0 || len(s.Lines) == 0 {
		return fmt.Errorf("%w: identity and lines are required", ErrInvalidSale)
	}
	if s.IdempotencyKey != "" && (s.IdempotencyKey != strings.TrimSpace(s.IdempotencyKey) || len([]rune(s.IdempotencyKey)) > 200) {
		return fmt.Errorf("%w: invalid idempotency key", ErrInvalidSale)
	}
	if s.Status != Draft && s.Status != Completed {
		return fmt.Errorf("%w: sale cannot be recalculated", ErrInvalidSale)
	}
	s.Subtotal, s.Tax, s.Discount, s.Total = 0, 0, 0, 0
	for _, line := range s.Lines {
		lineTotal, err := line.Total()
		if err != nil {
			return err
		}
		s.Subtotal += line.Quantity * line.UnitPrice
		s.Tax += line.Tax
		s.Discount += line.Discount
		s.Total += lineTotal
	}
	return nil
}

func (s Sale) ValidatePayments() error {
	if s.Total < 0 {
		return fmt.Errorf("%w: negative total", ErrInvalidSale)
	}
	var paid int64
	for _, p := range s.Payments {
		if p.MethodID == "" && p.MethodCode == "" || p.Amount <= 0 {
			return fmt.Errorf("%w: invalid payment", ErrInvalidSale)
		}
		paid += p.Amount
	}
	if s.Status == Completed && paid < s.Total {
		return fmt.Errorf("%w: completed sale is not fully paid", ErrInvalidSale)
	}
	return nil
}
