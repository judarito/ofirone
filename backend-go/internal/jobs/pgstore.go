package jobs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const claimJobSQL = `
WITH candidate AS (
    SELECT job_id
    FROM public.async_jobs
    WHERE tenant_id = $1
      AND status = 'queued'
      AND available_at <= $3
    ORDER BY priority ASC, available_at ASC, created_at ASC, job_id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE public.async_jobs AS j
SET status = 'running', attempts = j.attempts + 1,
    locked_at = $3, locked_by = $2, updated_at = $3
FROM candidate
WHERE j.job_id = candidate.job_id
RETURNING j.job_id, j.tenant_id, j.job_type, j.idempotency_key,
          j.status, j.attempts, j.max_attempts, j.available_at,
          j.locked_by, j.last_error, j.completed_at`

const succeedJobSQL = `UPDATE public.async_jobs
SET status = 'succeeded', locked_at = NULL, locked_by = NULL,
    completed_at = $4, updated_at = $4
WHERE tenant_id = $1 AND job_id = $2 AND status = 'running' AND locked_by = $3`

const failJobSQL = `UPDATE public.async_jobs
SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
    available_at = $4, locked_at = NULL, locked_by = NULL,
    last_error = $5, updated_at = $4
WHERE tenant_id = $1 AND job_id = $2 AND status = 'running' AND locked_by = $3`

const cancelJobSQL = `UPDATE public.async_jobs
SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
    updated_at = clock_timestamp()
WHERE tenant_id = $1 AND job_id = $2 AND status IN ('queued', 'running')`

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) Claim(ctx context.Context, tenantID, worker string, now time.Time) (Job, error) {
	if s == nil || s.pool == nil {
		return Job{}, fmt.Errorf("jobs: nil postgres pool")
	}
	var j Job
	row := s.pool.QueryRow(ctx, claimJobSQL, tenantID, worker, now)
	if err := row.Scan(&j.ID, &j.TenantID, &j.Type, &j.IdempotencyKey, &j.Status, &j.Attempts, &j.MaxAttempts, &j.AvailableAt, &j.LockedBy, &j.LastError, &j.CompletedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Job{}, ErrNoJob
		}
		return Job{}, err
	}
	return j, nil
}

func (s *PGStore) MarkSucceeded(ctx context.Context, tenantID, jobID, worker string, now time.Time) error {
	return s.execOne(ctx, succeedJobSQL, tenantID, jobID, worker, now)
}

func (s *PGStore) MarkFailed(ctx context.Context, tenantID, jobID, worker, message string, retryAt time.Time) error {
	return s.execOne(ctx, failJobSQL, tenantID, jobID, worker, retryAt, message)
}

func (s *PGStore) Cancel(ctx context.Context, tenantID, jobID string) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("jobs: nil postgres pool")
	}
	result, err := s.pool.Exec(ctx, cancelJobSQL, tenantID, jobID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("jobs: job not cancellable")
	}
	return nil
}

func (s *PGStore) execOne(ctx context.Context, sql, tenantID, jobID, worker string, args ...any) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("jobs: nil postgres pool")
	}
	values := append([]any{tenantID, jobID, worker}, args...)
	result, err := s.pool.Exec(ctx, sql, values...)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("jobs: job ownership or state mismatch")
	}
	return nil
}
