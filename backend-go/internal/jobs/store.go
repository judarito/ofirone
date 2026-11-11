package jobs

import (
	"context"
	"time"
)

// Store is the persistence port used by workers. Implementations must claim
// work atomically and scope every operation to the authenticated tenant.
type Store interface {
	Claim(ctx context.Context, tenantID, worker string, now time.Time) (Job, error)
	MarkSucceeded(ctx context.Context, tenantID, jobID, worker string, now time.Time) error
	MarkFailed(ctx context.Context, tenantID, jobID, worker, message string, retryAt time.Time) error
	Cancel(ctx context.Context, tenantID, jobID string) error
}
