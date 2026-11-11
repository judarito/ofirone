// Package reference_tax owns tax, currency and regional configuration masters.
package reference_tax

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/currency"
	"golang.org/x/text/language"
)

var (
	ErrInvalid  = errors.New("invalid reference data")
	ErrNotFound = errors.New("reference not found")
	ErrConflict = errors.New("reference code already exists or is in use")
)

type Resource string

const (
	Taxes            Resource = "taxes"
	Currencies       Resource = "currencies"
	RegionalSettings Resource = "regional-settings"
)

// Record is the shared wire contract. Fields belonging to other resources are rejected.
type Record struct {
	ID            string   `json:"id,omitempty"`
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Active        bool     `json:"is_active"`
	Rate          *float64 `json:"rate,omitempty"`
	Inclusive     *bool    `json:"is_inclusive,omitempty"`
	DecimalPlaces *int     `json:"decimal_places,omitempty"`
	CurrencyCode  string   `json:"currency_code,omitempty"`
	Locale        string   `json:"locale,omitempty"`
	Timezone      string   `json:"timezone,omitempty"`
}

func ValidID(id string) bool {
	var u pgtype.UUID
	return u.Scan(id) == nil && u.Valid && u.Bytes != [16]byte{}
}
func ValidResource(r Resource) bool { return r == Taxes || r == Currencies || r == RegionalSettings }

func (v Record) Validate(r Resource) error {
	if !ValidResource(r) || (v.ID != "" && !ValidID(v.ID)) || v.Code == "" || strings.TrimSpace(v.Code) != v.Code || utf8.RuneCountInString(v.Code) > 50 || strings.TrimSpace(v.Name) == "" || strings.TrimSpace(v.Name) != v.Name || utf8.RuneCountInString(v.Name) > 200 {
		return ErrInvalid
	}
	switch r {
	case Taxes:
		if v.Rate == nil || math.IsNaN(*v.Rate) || math.IsInf(*v.Rate, 0) || *v.Rate < 0 || *v.Rate > 100 || math.Abs(*v.Rate*1e6-math.Round(*v.Rate*1e6)) > 1e-7 || v.DecimalPlaces != nil || v.CurrencyCode != "" || v.Locale != "" || v.Timezone != "" {
			return ErrInvalid
		}
	case Currencies:
		if !validCurrency(v.Code) || v.DecimalPlaces == nil || *v.DecimalPlaces < 0 || *v.DecimalPlaces > 6 || v.Rate != nil || v.Inclusive != nil || v.CurrencyCode != "" || v.Locale != "" || v.Timezone != "" {
			return ErrInvalid
		}
	case RegionalSettings:
		if !validCurrency(v.CurrencyCode) || v.Locale == "" || v.Timezone == "" || v.Rate != nil || v.Inclusive != nil || v.DecimalPlaces != nil {
			return ErrInvalid
		}
		if _, err := language.Parse(v.Locale); err != nil {
			return ErrInvalid
		}
		if _, err := time.LoadLocation(v.Timezone); err != nil || v.Timezone == "Local" {
			return ErrInvalid
		}
	}
	return nil
}

func validCurrency(code string) bool {
	if len(code) != 3 || code != strings.ToUpper(code) || code == "XXX" {
		return false
	}
	_, err := currency.ParseISO(code)
	return err == nil
}

type Cursor struct {
	Code     string   `json:"code"`
	ID       string   `json:"id"`
	Resource Resource `json:"resource"`
	Tenant   string   `json:"tenant"`
}
type Query struct {
	Limit  int
	Cursor Cursor
}
type Page struct {
	Items      []Record `json:"items"`
	HasMore    bool     `json:"has_more"`
	NextCursor string   `json:"next_cursor,omitempty"`
}

func ParseQuery(r Resource, tenant string, limit int, token string) (Query, error) {
	q := Query{Limit: limit}
	if !ValidResource(r) || !ValidID(tenant) || limit < 1 || limit > 100 || len(token) > 2048 {
		return q, ErrInvalid
	}
	if token != "" {
		b, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil {
			return q, ErrInvalid
		}
		if json.Unmarshal(b, &q.Cursor) != nil || q.Cursor.Code == "" || !ValidID(q.Cursor.ID) || q.Cursor.Resource != r || q.Cursor.Tenant != tenant {
			return q, ErrInvalid
		}
	}
	return q, nil
}

func NewPage(items []Record, q Query, r Resource, tenant string) Page {
	if items == nil {
		items = []Record{}
	}
	p := Page{Items: items, HasMore: len(items) > q.Limit}
	if p.HasMore {
		p.Items = items[:q.Limit]
		last := p.Items[len(p.Items)-1]
		b, _ := json.Marshal(Cursor{Code: last.Code, ID: last.ID, Resource: r, Tenant: tenant})
		p.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	return p
}

// Store must scope every operation to tenant, including reads and conflicts.
type Store interface {
	List(context.Context, Resource, string, Query) (Page, error)
	Get(context.Context, Resource, string, string) (Record, error)
	Create(context.Context, Resource, string, Record) (Record, error)
	Update(context.Context, Resource, string, Record) (Record, error)
	Deactivate(context.Context, Resource, string, string) error
}

// TaxInfo is the effective tax chosen for a variant by scope precedence.
type TaxInfo struct {
	Rate float64 `json:"rate"`
	Code *string `json:"code"`
	Name *string `json:"name"`
}

type VariantTaxInfoStore interface {
	TaxInfoForVariant(context.Context, string, string) (TaxInfo, error)
}
