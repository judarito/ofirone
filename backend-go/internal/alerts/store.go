package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Alert struct {
	ID          string          `json:"alert_id"`
	Type        string          `json:"alert_type"`
	Level       string          `json:"alert_level"`
	ReferenceID string          `json:"reference_id"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	Data        json.RawMessage `json:"data"`
}

type Page struct {
	Items         []Alert `json:"items"`
	HasMore       bool    `json:"has_more"`
	NextCreatedAt string  `json:"next_created_at,omitempty"`
	NextID        string  `json:"next_id,omitempty"`
}

type Filter struct {
	TenantID       string
	AlertType      string
	AlertLevel     string
	Limit          int
	AfterCreatedAt *time.Time
	AfterID        string
}

func (f Filter) Validate() error {
	if f.TenantID == "" || f.Limit < 1 || f.Limit > 100 {
		return fmt.Errorf("alerts: invalid filter")
	}
	return nil
}

type Store interface {
	List(context.Context, Filter) (Page, error)
}
type Service struct{ store Store }

func NewService(store Store) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("alerts: nil store")
	}
	return &Service{store: store}, nil
}

func (s *Service) List(ctx context.Context, filter Filter) (Page, error) {
	if err := filter.Validate(); err != nil {
		return Page{}, err
	}
	return s.store.List(ctx, filter)
}

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) List(ctx context.Context, f Filter) (Page, error) {
	if err := f.Validate(); err != nil {
		return Page{}, err
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT to_regclass('public.system_alerts') IS NOT NULL`).Scan(&exists); err != nil {
		return Page{}, err
	}
	if !exists {
		return Page{Items: []Alert{}, HasMore: false}, nil
	}
	query := `SELECT alert_id, alert_type, alert_level, reference_id, created_at, updated_at, data
		FROM public.system_alerts
		WHERE tenant_id = $1
		AND ($2 = '' OR alert_type = $2)
		AND ($3 = '' OR alert_level = $3)
		AND ($4::timestamptz IS NULL OR (created_at, alert_id) < ($4::timestamptz, NULLIF($5, '')::uuid))
		ORDER BY created_at DESC, alert_id DESC LIMIT $6`
	after := any(nil)
	if f.AfterCreatedAt != nil {
		after = *f.AfterCreatedAt
	}
	rows, err := s.pool.Query(ctx, query, f.TenantID, f.AlertType, f.AlertLevel, after, f.AfterID, f.Limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	items := make([]Alert, 0, f.Limit)
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.Type, &a.Level, &a.ReferenceID, &a.CreatedAt, &a.UpdatedAt, &a.Data); err != nil {
			return Page{}, err
		}
		items = append(items, a)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	page := Page{Items: items}
	if len(items) > f.Limit {
		page.HasMore = true
		page.Items = items[:f.Limit]
		last := page.Items[len(page.Items)-1]
		page.NextCreatedAt = last.CreatedAt.UTC().Format(time.RFC3339Nano)
		page.NextID = last.ID
	}
	return page, nil
}
