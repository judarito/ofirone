// Package reference_catalog manages tenant units and category hierarchies.
package reference_catalog

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

type Kind string

const (
	Units      Kind = "units-of-measure"
	Categories Kind = "categories"
)

var (
	ErrInvalid  = errors.New("invalid reference catalog request")
	ErrNotFound = errors.New("reference not found")
	ErrConflict = errors.New("reference conflict")
	ErrParent   = errors.New("invalid category parent")
	uuid        = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

func ValidID(id string) bool { return uuid.MatchString(id) }

type Item struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenant_id"`
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	DecimalPlaces int     `json:"decimal_places"`
	ParentID      *string `json:"parent_category_id"`
	Active        bool    `json:"is_active"`
}
type Query struct {
	Limit              int
	AfterName, AfterID string
}
type Page struct {
	Items    []Item `json:"items"`
	HasMore  bool   `json:"has_more"`
	NextName string `json:"next_name,omitempty"`
	NextID   string `json:"next_id,omitempty"`
}

func Validate(kind Kind, v Item) error {
	codeMax, nameMax := 30, 100
	if kind == Categories {
		codeMax, nameMax = 100, 200
	} else if kind != Units {
		return ErrInvalid
	}
	if !ValidID(v.TenantID) || (v.ID != "" && !ValidID(v.ID)) || v.Code != strings.TrimSpace(v.Code) || utf8.RuneCountInString(v.Code) < 1 || utf8.RuneCountInString(v.Code) > codeMax || strings.TrimSpace(v.Name) == "" || utf8.RuneCountInString(v.Name) > nameMax {
		return ErrInvalid
	}
	if kind == Units && (v.DecimalPlaces < 0 || v.DecimalPlaces > 6 || v.ParentID != nil) {
		return ErrInvalid
	}
	if kind == Categories && (v.DecimalPlaces != 0 || (v.ParentID != nil && (!ValidID(*v.ParentID) || *v.ParentID == v.ID))) {
		return ErrParent
	}
	return nil
}
func ValidateQuery(q Query) error {
	if q.Limit < 1 || q.Limit > 100 || (q.AfterName == "") != (q.AfterID == "") || (q.AfterID != "" && !ValidID(q.AfterID)) {
		return ErrInvalid
	}
	return nil
}

type Store interface {
	List(context.Context, Kind, string, Query) (Page, error)
	Get(context.Context, Kind, string, string) (Item, error)
	Save(context.Context, Kind, Item, bool) (Item, error)
	Deactivate(context.Context, Kind, string, string) error
}
