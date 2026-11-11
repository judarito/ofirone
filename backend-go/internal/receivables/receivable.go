package receivables

import (
	"context"
	"fmt"
)

type Account struct {
	ID             string `json:"credit_account_id"`
	CustomerID     string `json:"customer_id"`
	CustomerName   string `json:"customer_name"`
	CreditLimit    int64  `json:"credit_limit"`
	CurrentBalance int64  `json:"current_balance"`
	Status         string `json:"status"`
}
type Movement struct {
	ID        string `json:"credit_movement_id"`
	AccountID string `json:"credit_account_id"`
	Type      string `json:"movement_type"`
	Amount    int64  `json:"amount"`
	Source    string `json:"source_type,omitempty"`
	SourceID  string `json:"source_id,omitempty"`
	Occurred  string `json:"occurred_at"`
}
type MovementPage struct {
	Items   []Movement `json:"items"`
	HasMore bool       `json:"has_more"`
	NextAt  string     `json:"next_occurred_at,omitempty"`
	NextID  string     `json:"next_id,omitempty"`
}
type Summary struct {
	TotalAccounts    int64 `json:"total_accounts"`
	TotalDebt        int64 `json:"total_debt"`
	TotalLimit       int64 `json:"total_limit"`
	AccountsWithDebt int64 `json:"accounts_with_debt"`
	AccountsOverdue  int64 `json:"accounts_overdue"`
}
type Page struct {
	Items   []Account `json:"items"`
	HasMore bool      `json:"has_more"`
	NextID  string    `json:"next_id,omitempty"`
}
type Payment struct {
	AccountID       string `json:"credit_account_id"`
	Amount          int64  `json:"amount"`
	Note            string `json:"note"`
	PaymentMethodID string `json:"payment_method_id"`
}
type Charge struct {
	AccountID string `json:"credit_account_id"`
	Amount    int64  `json:"amount"`
	Source    string `json:"source_type,omitempty"`
	SourceID  string `json:"source_id,omitempty"`
}
type AccountInput struct {
	CustomerID  string `json:"customer_id"`
	CreditLimit int64  `json:"credit_limit"`
	Status      string `json:"status,omitempty"`
}
type Store interface {
	List(context.Context, string, int, string) (Page, error)
	Get(context.Context, string, string) (Account, error)
	Upsert(context.Context, string, AccountInput) (Account, error)
	Pay(context.Context, string, Payment) error
	Charge(context.Context, string, Charge) error
	Movements(context.Context, string, string, int, string, string) (MovementPage, error)
	Summary(context.Context, string) (Summary, error)
}
type Service struct{ store Store }

func NewService(s Store) (*Service, error) {
	if s == nil {
		return nil, fmt.Errorf("receivables: store required")
	}
	return &Service{store: s}, nil
}
func (s *Service) List(ctx context.Context, tenant string, limit int, after string) (Page, error) {
	if tenant == "" || limit < 1 || limit > 100 {
		return Page{}, fmt.Errorf("receivables: invalid list")
	}
	return s.store.List(ctx, tenant, limit, after)
}
func (s *Service) Pay(ctx context.Context, tenant string, p Payment) error {
	if tenant == "" || p.AccountID == "" || p.Amount <= 0 {
		return fmt.Errorf("receivables: invalid payment")
	}
	return s.store.Pay(ctx, tenant, p)
}
func (s *Service) Get(ctx context.Context, tenant, id string) (Account, error) {
	if tenant == "" || id == "" {
		return Account{}, fmt.Errorf("receivables: invalid account")
	}
	return s.store.Get(ctx, tenant, id)
}
func (s *Service) Upsert(ctx context.Context, tenant string, in AccountInput) (Account, error) {
	if tenant == "" || in.CustomerID == "" || in.CreditLimit < 0 {
		return Account{}, fmt.Errorf("receivables: invalid account")
	}
	return s.store.Upsert(ctx, tenant, in)
}
func (s *Service) Charge(ctx context.Context, tenant string, c Charge) error {
	if tenant == "" || c.AccountID == "" || c.Amount <= 0 {
		return fmt.Errorf("receivables: invalid charge")
	}
	return s.store.Charge(ctx, tenant, c)
}
func (s *Service) Movements(ctx context.Context, tenant, account string, limit int, afterAt, afterID string) (MovementPage, error) {
	if tenant == "" || account == "" || limit < 1 || limit > 100 {
		return MovementPage{}, fmt.Errorf("receivables: invalid movements")
	}
	return s.store.Movements(ctx, tenant, account, limit, afterAt, afterID)
}
func (s *Service) Summary(ctx context.Context, tenant string) (Summary, error) {
	if tenant == "" {
		return Summary{}, fmt.Errorf("receivables: invalid summary")
	}
	return s.store.Summary(ctx, tenant)
}
