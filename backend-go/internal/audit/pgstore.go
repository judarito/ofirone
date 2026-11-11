package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const appendEventSQL = `INSERT INTO public.audit_log
    (audit_id, tenant_id, actor_identity_id, action, resource_type,
     resource_id, request_id, metadata, created_at)
VALUES ($1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, '')::uuid,
        NULLIF($7, ''), $8::jsonb, $9)`

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) Append(ctx context.Context, event Event) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("audit: nil postgres pool")
	}
	if err := event.Validate(); err != nil {
		return err
	}
	metadata, err := json.Marshal(event.Metadata)
	if err != nil {
		return fmt.Errorf("audit: encode metadata: %w", err)
	}
	_, err = s.pool.Exec(ctx, appendEventSQL, event.ID, event.TenantID,
		event.ActorID, event.Action, event.Resource, event.ResourceID,
		event.RequestID, metadata, event.CreatedAt)
	return err
}
