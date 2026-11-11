package audit

import (
	"errors"
	"testing"
	"time"
)

func validEvent() Event {
	return Event{
		ID: "audit-1", TenantID: "tenant-1", ActorID: "identity-1",
		Action: "sale.created", Resource: "sale", ResourceID: "sale-1",
		Metadata: map[string]any{"source": "api"}, CreatedAt: time.Now().UTC(),
	}
}

func TestEventValidate(t *testing.T) {
	if err := validEvent().Validate(); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
	cases := []struct {
		name string
		edit func(*Event)
	}{
		{"missing tenant", func(e *Event) { e.TenantID = "" }},
		{"missing action", func(e *Event) { e.Action = "" }},
		{"missing metadata", func(e *Event) { e.Metadata = nil }},
		{"missing timestamp", func(e *Event) { e.CreatedAt = time.Time{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := validEvent()
			tc.edit(&e)
			if err := e.Validate(); !errors.Is(err, ErrInvalidEvent) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}
