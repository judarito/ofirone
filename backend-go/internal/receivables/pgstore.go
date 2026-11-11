package receivables

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(p *pgxpool.Pool) *PGStore { return &PGStore{pool: p} }
func (s *PGStore) List(ctx context.Context, t string, l int, a string) (Page, error) {
	rows, e := s.pool.Query(ctx, `SELECT a.credit_account_id,a.customer_id,coalesce(tp.legal_name,''),a.credit_limit::bigint,a.current_balance::bigint,a.status,a.credit_account_id::text FROM customer_credit_accounts a JOIN customers c ON c.tenant_id=a.tenant_id AND c.customer_id=a.customer_id JOIN third_parties tp ON tp.tenant_id=c.tenant_id AND tp.third_party_id=c.third_party_id WHERE a.tenant_id=$1 AND ($2='' OR a.credit_account_id::text<$2) ORDER BY a.credit_account_id DESC LIMIT $3`, t, a, l+1)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	p := Page{Items: make([]Account, 0, l)}
	for rows.Next() {
		var x Account
		var id string
		if e = rows.Scan(&x.ID, &x.CustomerID, &x.CustomerName, &x.CreditLimit, &x.CurrentBalance, &x.Status, &id); e != nil {
			return p, e
		}
		p.Items = append(p.Items, x)
	}
	if len(p.Items) > l {
		p.HasMore = true
		p.Items = p.Items[:l]
		p.NextID = p.Items[l-1].ID
	}
	return p, rows.Err()
}
func (s *PGStore) Get(ctx context.Context, t, id string) (Account, error) {
	var a Account
	err := s.pool.QueryRow(ctx, `SELECT a.credit_account_id,a.customer_id,coalesce(tp.legal_name,''),a.credit_limit::bigint,a.current_balance::bigint,a.status FROM customer_credit_accounts a JOIN customers c ON c.tenant_id=a.tenant_id AND c.customer_id=a.customer_id JOIN third_parties tp ON tp.tenant_id=c.tenant_id AND tp.third_party_id=c.third_party_id WHERE a.tenant_id=$1 AND a.credit_account_id=$2`, t, id).Scan(&a.ID, &a.CustomerID, &a.CustomerName, &a.CreditLimit, &a.CurrentBalance, &a.Status)
	return a, err
}
func (s *PGStore) Upsert(ctx context.Context, t string, in AccountInput) (Account, error) {
	status := in.Status
	if status == "" {
		status = "active"
	}
	var a Account
	err := s.pool.QueryRow(ctx, `INSERT INTO customer_credit_accounts(tenant_id,customer_id,credit_limit,status) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,customer_id) DO UPDATE SET credit_limit=EXCLUDED.credit_limit,status=EXCLUDED.status RETURNING credit_account_id`, t, in.CustomerID, in.CreditLimit, status).Scan(&a.ID)
	if err != nil {
		return a, err
	}
	return s.Get(ctx, t, a.ID)
}
func (s *PGStore) Pay(ctx context.Context, t string, p Payment) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var balance int64
	if e = tx.QueryRow(ctx, `SELECT current_balance::bigint FROM customer_credit_accounts WHERE tenant_id=$1 AND credit_account_id=$2 FOR UPDATE`, t, p.AccountID).Scan(&balance); e != nil {
		return e
	}
	if p.Amount > balance {
		return fmt.Errorf("receivables: payment exceeds balance")
	}
	if _, e = tx.Exec(ctx, `INSERT INTO customer_credit_movements(tenant_id,credit_account_id,movement_type,amount,source_type) VALUES($1,$2,'payment',$3,'manual_payment')`, t, p.AccountID, p.Amount); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE customer_credit_accounts SET current_balance=current_balance-$1 WHERE tenant_id=$2 AND credit_account_id=$3`, p.Amount, t, p.AccountID); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *PGStore) Charge(ctx context.Context, t string, c Charge) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT credit_account_id FROM customer_credit_accounts WHERE tenant_id=$1 AND credit_account_id=$2 AND status='active' FOR UPDATE`, t, c.AccountID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO customer_credit_movements(tenant_id,credit_account_id,movement_type,amount,source_type,source_id) VALUES($1,$2,'charge',$3,NULLIF($4,''),NULLIF($5,'')::uuid)`, t, c.AccountID, c.Amount, c.Source, c.SourceID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE customer_credit_accounts SET current_balance=current_balance+$1 WHERE tenant_id=$2 AND credit_account_id=$3`, c.Amount, t, c.AccountID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *PGStore) Movements(ctx context.Context, t, account string, l int, afterAt, afterID string) (MovementPage, error) {
	rows, err := s.pool.Query(ctx, `SELECT credit_movement_id,credit_account_id,movement_type,amount::bigint,coalesce(source_type,''),coalesce(source_id::text,''),occurred_at FROM customer_credit_movements WHERE tenant_id=$1 AND credit_account_id=$2 AND ($3='' OR (occurred_at,credit_movement_id)<($3::timestamptz,$4::uuid)) ORDER BY occurred_at DESC,credit_movement_id DESC LIMIT $5`, t, account, afterAt, afterID, l+1)
	if err != nil {
		return MovementPage{}, err
	}
	defer rows.Close()
	p := MovementPage{Items: make([]Movement, 0, l)}
	for rows.Next() {
		var m Movement
		var at time.Time
		if err = rows.Scan(&m.ID, &m.AccountID, &m.Type, &m.Amount, &m.Source, &m.SourceID, &at); err != nil {
			return p, err
		}
		m.Occurred = at.UTC().Format(time.RFC3339Nano)
		p.Items = append(p.Items, m)
	}
	if err = rows.Err(); err != nil {
		return p, err
	}
	if len(p.Items) > l {
		p.HasMore = true
		p.Items = p.Items[:l]
		p.NextAt = p.Items[l-1].Occurred
		p.NextID = p.Items[l-1].ID
	}
	return p, nil
}
func (s *PGStore) Summary(ctx context.Context, t string) (Summary, error) {
	var x Summary
	err := s.pool.QueryRow(ctx, `SELECT count(*)::bigint,coalesce(sum(current_balance),0)::bigint,coalesce(sum(credit_limit),0)::bigint,count(*) FILTER (WHERE current_balance>0)::bigint,count(*) FILTER (WHERE current_balance>credit_limit)::bigint FROM customer_credit_accounts WHERE tenant_id=$1 AND status='active'`, t).Scan(&x.TotalAccounts, &x.TotalDebt, &x.TotalLimit, &x.AccountsWithDebt, &x.AccountsOverdue)
	return x, err
}
