package poscontext

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Context struct {
	OpenCashSessionID *string `json:"open_cash_session_id"`
	AssignedRegisters int     `json:"assigned_registers_count"`
	SingleRegisterID  *string `json:"single_cash_register_id"`
}

type Store interface {
	Get(context.Context, string, string) (Context, error)
}

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) Get(ctx context.Context, tenantID, userID string) (Context, error) {
	if s == nil || s.pool == nil {
		return Context{}, fmt.Errorf("poscontext: nil pool")
	}
	var out Context
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT cs.cash_session_id::text
			 FROM public.cash_sessions cs
			 WHERE cs.tenant_id=$1 AND cs.opened_by_identity_id=$2 AND cs.status='open'
			 ORDER BY cs.opened_at DESC, cs.cash_session_id DESC LIMIT 1),
			-- The portable schema does not contain the legacy
			-- cash_register_assignments table. Cash is scoped by location and
			-- the open session is the authoritative POS context for now.
			0::int,
			NULL::text
	`, tenantID, userID).Scan(&out.OpenCashSessionID, &out.AssignedRegisters, &out.SingleRegisterID)
	return out, err
}
