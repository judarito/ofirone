package cash

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(p *pgxpool.Pool) *PGStore { return &PGStore{pool: p} }
func (s *PGStore) ListExpired(ctx context.Context, tenant string, age time.Duration, limit int) ([]ExpiredSession, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `SELECT cash_session_id,location_id,status,opened_at,opened_by_identity_id FROM public.cash_sessions WHERE tenant_id=$1 AND status='open' AND opened_at < clock_timestamp()-$2::interval ORDER BY opened_at ASC LIMIT $3`, tenant, age.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExpiredSession{}
	for rows.Next() {
		var x ExpiredSession
		if err := rows.Scan(&x.ID, &x.LocationID, &x.Status, &x.OpenedAt, &x.OpenedBy); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *PGStore) List(ctx context.Context, tenant, sessionID, locationID string, limit int) ([]ExpiredSession, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `SELECT cash_session_id,location_id,status,opened_at,opened_by_identity_id FROM public.cash_sessions WHERE tenant_id=$1 AND status='open' AND ($2='' OR cash_session_id::text=$2) AND ($3='' OR location_id::text=$3) ORDER BY opened_at DESC LIMIT $4`, tenant, sessionID, locationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExpiredSession{}
	for rows.Next() {
		var x ExpiredSession
		if err := rows.Scan(&x.ID, &x.LocationID, &x.Status, &x.OpenedAt, &x.OpenedBy); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *PGStore) Open(ctx context.Context, x Session) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("cash: nil pool")
	}
	if e := x.Validate(); e != nil {
		return e
	}
	_, e := s.pool.Exec(ctx, `INSERT INTO public.cash_sessions(cash_session_id,tenant_id,location_id,opened_by_identity_id,opening_float,open_idempotency_key) VALUES($1,$2,$3,$4,$5,$6)`, x.ID, x.TenantID, x.LocationID, x.OpenedBy, x.OpeningFloat, x.OpenKey)
	return e
}
func (s *PGStore) Move(ctx context.Context, m Movement) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("cash: nil pool")
	}
	if e := m.Validate(); e != nil {
		return e
	}
	_, e := s.pool.Exec(ctx, `INSERT INTO public.cash_movements(cash_movement_id,tenant_id,cash_session_id,movement_type,direction,amount,reason,created_by_identity_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9)`, m.ID, m.TenantID, m.SessionID, m.Type, m.Direction, m.Amount, m.Reason, m.CreatedBy, m.Key)
	return e
}

func (s *PGStore) Close(ctx context.Context, session, tenant, actor string, counted int64, key string) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("cash: nil pool")
	}
	if session == "" || tenant == "" || actor == "" || key == "" || counted < 0 {
		return fmt.Errorf("cash: invalid close")
	}
	_, err := s.pool.Exec(ctx, `UPDATE public.cash_sessions SET status='closed', closed_by_identity_id=$1, closed_at=clock_timestamp(), counted_cash=$2, close_idempotency_key=$3, updated_at=clock_timestamp() WHERE tenant_id=$4 AND cash_session_id=$5 AND status='open'`, actor, counted, key, tenant, session)
	return err
}
