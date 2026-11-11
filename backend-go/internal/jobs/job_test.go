package jobs

import (
	"errors"
	"testing"
	"time"
)

func validJob() Job {
	return Job{ID: "job-1", TenantID: "tenant-1", Type: "import", IdempotencyKey: "import-1", Status: Queued, MaxAttempts: 3}
}

func TestJobLifecycleRetriesThenFails(t *testing.T) {
	now := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	j, err := validJob().Start("worker-1", now)
	if err != nil || j.Status != Running || j.Attempts != 1 {
		t.Fatalf("start = %#v, %v", j, err)
	}
	j, err = j.Fail("temporary", now.Add(time.Minute))
	if err != nil || j.Status != Queued || j.Attempts != 1 {
		t.Fatalf("retry = %#v, %v", j, err)
	}
	j, _ = j.Start("worker-1", now.Add(time.Minute))
	j, _ = j.Fail("temporary", now.Add(2*time.Minute))
	j, _ = j.Start("worker-1", now.Add(2*time.Minute))
	j, err = j.Fail("permanent", now.Add(3*time.Minute))
	if err != nil || j.Status != Failed || j.LastError != "permanent" {
		t.Fatalf("final failure = %#v, %v", j, err)
	}
}

func TestJobSuccessAndCancellation(t *testing.T) {
	now := time.Now().UTC()
	j, _ := validJob().Start("worker-1", now)
	j, err := j.Succeed(now)
	if err != nil || j.Status != Succeeded || j.CompletedAt == nil || j.LockedBy != "" {
		t.Fatalf("success = %#v, %v", j, err)
	}
	if _, err := j.Cancel(); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("cancelled completed job error = %v", err)
	}
	j, _ = validJob().Cancel()
	if j.Status != Cancelled {
		t.Fatalf("cancel = %#v", j)
	}
}

func TestJobRejectsInvalidTransitionsAndData(t *testing.T) {
	if _, err := validJob().Start("", time.Now()); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("empty worker error = %v", err)
	}
	if err := (Job{Status: Queued, MaxAttempts: 0}).Validate(); !errors.Is(err, ErrInvalidJob) {
		t.Fatalf("invalid job error = %v", err)
	}
	if _, err := validJob().Succeed(time.Now()); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("success before start error = %v", err)
	}
}
