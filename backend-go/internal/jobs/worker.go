package jobs

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	mathrand "math/rand"
	"sync"
	"time"

	"ofirone/backend-go/internal/audit"
)

var ErrNoJob = errors.New("jobs: no job available")

type Handler func(context.Context, Job) error

type Worker struct {
	store       Store
	handler     Handler
	audit       audit.Store
	workerID    string
	poll        time.Duration
	baseBackoff time.Duration
	maxBackoff  time.Duration
	concurrency int
	now         func() time.Time
	sleep       func(context.Context, time.Duration) error
}

type WorkerConfig struct {
	Store       Store
	Handler     Handler
	Audit       audit.Store
	WorkerID    string
	Poll        time.Duration
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
	Concurrency int
}

func NewWorker(cfg WorkerConfig) (*Worker, error) {
	if cfg.Store == nil || cfg.Handler == nil || cfg.WorkerID == "" {
		return nil, fmt.Errorf("jobs: store, handler and worker id are required")
	}
	if cfg.Poll <= 0 {
		cfg.Poll = time.Second
	}
	if cfg.BaseBackoff <= 0 {
		cfg.BaseBackoff = time.Second
	}
	if cfg.MaxBackoff <= 0 {
		cfg.MaxBackoff = time.Minute
	}
	if cfg.MaxBackoff < cfg.BaseBackoff {
		return nil, fmt.Errorf("jobs: max backoff must be at least base backoff")
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 1
	}
	return &Worker{store: cfg.Store, handler: cfg.Handler, audit: cfg.Audit, workerID: cfg.WorkerID, poll: cfg.Poll, baseBackoff: cfg.BaseBackoff, maxBackoff: cfg.MaxBackoff, concurrency: cfg.Concurrency, now: time.Now, sleep: sleepContext}, nil
}

func (w *Worker) Run(ctx context.Context, tenantID string) error {
	if ctx == nil {
		return fmt.Errorf("jobs: nil context")
	}
	sem := make(chan struct{}, w.concurrency)
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		job, err := w.store.Claim(ctx, tenantID, w.workerID, w.now())
		if errors.Is(err, ErrNoJob) || errors.Is(err, context.DeadlineExceeded) {
			if err := w.sleep(ctx, w.poll); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		select {
		case sem <- struct{}{}:
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer func() { <-sem }()
				w.process(ctx, tenantID, job)
			}()
		default:
			if err := w.sleep(ctx, w.poll); err != nil {
				return err
			}
		}
	}
}

func (w *Worker) process(ctx context.Context, tenantID string, job Job) {
	err := w.handler(ctx, job)
	if err == nil {
		_ = w.store.MarkSucceeded(ctx, tenantID, job.ID, w.workerID, w.now())
		w.record(ctx, tenantID, job, "job.succeeded", "")
		return
	}
	delay := w.backoff(job.Attempts)
	_ = w.store.MarkFailed(ctx, tenantID, job.ID, w.workerID, err.Error(), w.now().Add(delay))
	w.record(ctx, tenantID, job, "job.failed", err.Error())
}

func (w *Worker) record(ctx context.Context, tenantID string, job Job, action, failure string) {
	if w.audit == nil {
		return
	}
	bytes := make([]byte, 16)
	if _, err := cryptorand.Read(bytes); err != nil {
		return
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	id := hex.EncodeToString(bytes)
	id = id[:8] + "-" + id[8:12] + "-" + id[12:16] + "-" + id[16:20] + "-" + id[20:]
	_ = w.audit.Append(ctx, audit.Event{
		ID: id, TenantID: tenantID, Action: action, Resource: "async_job",
		ResourceID: job.ID, Metadata: map[string]any{"job_type": job.Type, "worker_id": w.workerID, "error": failure}, CreatedAt: w.now(),
	})
}

func (w *Worker) backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := w.baseBackoff
	for i := 1; i < attempt && d < w.maxBackoff; i++ {
		d *= 2
	}
	if d > w.maxBackoff {
		d = w.maxBackoff
	}
	// Small bounded jitter prevents synchronized retries across workers.
	return d + time.Duration(mathrand.Int63n(int64(d/10)+1))
}

func sleepContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
