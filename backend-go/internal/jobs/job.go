// Package jobs contains provider-independent rules for asynchronous work.
package jobs

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type Status string

const (
	Queued    Status = "queued"
	Running   Status = "running"
	Succeeded Status = "succeeded"
	Failed    Status = "failed"
	Cancelled Status = "cancelled"
)

var (
	ErrInvalidTransition = errors.New("jobs: invalid status transition")
	ErrNotRetryable      = errors.New("jobs: job is not retryable")
	ErrInvalidJob        = errors.New("jobs: invalid job")
)

type Job struct {
	ID             string
	TenantID       string
	Type           string
	IdempotencyKey string
	Status         Status
	Attempts       int
	MaxAttempts    int
	AvailableAt    time.Time
	LockedBy       string
	LastError      string
	CompletedAt    *time.Time
}

func (j Job) Validate() error {
	if strings.TrimSpace(j.ID) == "" || strings.TrimSpace(j.TenantID) == "" || strings.TrimSpace(j.Type) == "" || strings.TrimSpace(j.IdempotencyKey) == "" {
		return fmt.Errorf("%w: identity fields are required", ErrInvalidJob)
	}
	if j.Attempts < 0 || j.MaxAttempts < 1 || j.Attempts > j.MaxAttempts {
		return fmt.Errorf("%w: attempts out of range", ErrInvalidJob)
	}
	switch j.Status {
	case Queued, Running, Succeeded, Failed, Cancelled:
		return nil
	default:
		return fmt.Errorf("%w: unknown status %q", ErrInvalidJob, j.Status)
	}
}

func (j Job) Start(worker string, now time.Time) (Job, error) {
	if err := j.Validate(); err != nil {
		return Job{}, err
	}
	if j.Status != Queued || strings.TrimSpace(worker) == "" {
		return Job{}, fmt.Errorf("%w: queued job requires a worker", ErrInvalidTransition)
	}
	j.Status = Running
	j.Attempts++
	j.LockedBy = worker
	j.AvailableAt = now
	return j, nil
}

func (j Job) Succeed(now time.Time) (Job, error) {
	if j.Status != Running {
		return Job{}, fmt.Errorf("%w: only running jobs can succeed", ErrInvalidTransition)
	}
	j.Status = Succeeded
	j.LockedBy = ""
	j.CompletedAt = &now
	return j, nil
}

func (j Job) Fail(errMsg string, retryAt time.Time) (Job, error) {
	if j.Status != Running {
		return Job{}, fmt.Errorf("%w: only running jobs can fail", ErrInvalidTransition)
	}
	j.LockedBy = ""
	j.LastError = strings.TrimSpace(errMsg)
	if j.Attempts < j.MaxAttempts {
		j.Status = Queued
		j.AvailableAt = retryAt
		return j, nil
	}
	j.Status = Failed
	return j, nil
}

func (j Job) Cancel() (Job, error) {
	if j.Status != Queued && j.Status != Running {
		return Job{}, fmt.Errorf("%w: only queued or running jobs can cancel", ErrInvalidTransition)
	}
	j.Status = Cancelled
	j.LockedBy = ""
	return j, nil
}
