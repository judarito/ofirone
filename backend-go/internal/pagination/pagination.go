// Package pagination provides bounded offset and keyset pagination without DB dependencies.
package pagination

import (
	"errors"
	"net/url"
	"strconv"
)

var (
	ErrLimits = errors.New("pagination: invalid limits")
	ErrLimit  = errors.New("pagination: invalid limit")
	ErrOffset = errors.New("pagination: invalid offset")
	ErrCursor = errors.New("pagination: invalid cursor")
	ErrOrder  = errors.New("pagination: invalid stable order")
	ErrWindow = errors.New("pagination: invalid result window")
)

// Limits is policy supplied by the server, never by a client. Zero is not a default.
type Limits struct {
	DefaultLimit int
	MaxLimit     int
	MaxOffset    int
}

func DefaultLimits() Limits { return Limits{DefaultLimit: 25, MaxLimit: 100, MaxOffset: 1000000} }

func (l Limits) Validate() error {
	if l.DefaultLimit < 1 || l.MaxLimit < l.DefaultLimit || l.MaxLimit == int(^uint(0)>>1) || l.MaxOffset < 0 {
		return ErrLimits
	}
	return nil
}

func single(v url.Values, key string, fallback string) (string, bool) {
	values, ok := v[key]
	if !ok {
		return fallback, true
	}
	if len(values) != 1 || values[0] == "" {
		return "", false
	}
	return values[0], true
}

func number(raw string) (int, error) {
	for _, c := range raw {
		if c < '0' || c > '9' {
			return 0, ErrLimit
		}
	}
	return strconv.Atoi(raw)
}

func parseLimit(v url.Values, l Limits) (int, error) {
	if err := l.Validate(); err != nil {
		return 0, err
	}
	raw, ok := single(v, "limit", strconv.Itoa(l.DefaultLimit))
	if !ok {
		return 0, ErrLimit
	}
	n, err := number(raw)
	if err != nil || n < 1 || n > l.MaxLimit {
		return 0, ErrLimit
	}
	return n, nil
}

type OffsetRequest struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

// ParseOffset rejects repeated, empty, overflowing and out-of-policy parameters.
func ParseOffset(v url.Values, l Limits) (OffsetRequest, error) {
	limit, err := parseLimit(v, l)
	if err != nil {
		return OffsetRequest{}, err
	}
	if _, ok := v["cursor"]; ok {
		return OffsetRequest{}, ErrCursor
	}
	raw, ok := single(v, "offset", "0")
	if !ok {
		return OffsetRequest{}, ErrOffset
	}
	offset, err := number(raw)
	if err != nil || offset > l.MaxOffset || offset > int(^uint(0)>>1)-limit {
		return OffsetRequest{}, ErrOffset
	}
	return OffsetRequest{Limit: limit, Offset: offset}, nil
}

type CursorRequest struct {
	Limit int `json:"limit"`
	// After contains canonical values in the codec's declared sort order.
	After []string `json:"-"`
}

func ParseCursor(v url.Values, l Limits, codec *Codec) (CursorRequest, error) {
	limit, err := parseLimit(v, l)
	if err != nil {
		return CursorRequest{}, err
	}
	if codec == nil || codec.fields == 0 {
		return CursorRequest{}, ErrCursor
	}
	if _, ok := v["offset"]; ok {
		return CursorRequest{}, ErrOffset
	}
	req := CursorRequest{Limit: limit}
	if _, ok := v["cursor"]; !ok {
		return req, nil
	}
	raw, ok := single(v, "cursor", "")
	if !ok {
		return CursorRequest{}, ErrCursor
	}
	req.After, err = codec.Decode(raw)
	if err != nil {
		return CursorRequest{}, err
	}
	return req, nil
}

type OffsetPage struct {
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"has_more"`
}

type CursorPage struct {
	Limit      int    `json:"limit"`
	HasMore    bool   `json:"has_more"`
	NextCursor string `json:"next_cursor,omitempty"`
}

type OffsetResponse[T any] struct {
	Data       []T        `json:"data"`
	Pagination OffsetPage `json:"pagination"`
}

type CursorResponse[T any] struct {
	Data       []T        `json:"data"`
	Pagination CursorPage `json:"pagination"`
}

// Window builders require at most limit+1 rows, fetched after filtering and ordering.
// The extra row determines has_more; totals must be queried independently.
func OffsetWindow[T any](rows []T, req OffsetRequest) (OffsetResponse[T], error) {
	if req.Limit < 1 || req.Offset < 0 || len(rows) > req.Limit && len(rows)-req.Limit != 1 {
		return OffsetResponse[T]{}, ErrWindow
	}
	more := len(rows) > req.Limit
	if more {
		rows = rows[:req.Limit]
	}
	if rows == nil {
		rows = []T{}
	}
	return OffsetResponse[T]{Data: rows, Pagination: OffsetPage{Limit: req.Limit, Offset: req.Offset, HasMore: more}}, nil
}

// position extracts the last returned row's ordered values, not the lookahead row.
func CursorWindow[T any](rows []T, req CursorRequest, codec *Codec, position func(T) []string) (CursorResponse[T], error) {
	if req.Limit < 1 || codec == nil || codec.fields == 0 || len(rows) > req.Limit && len(rows)-req.Limit != 1 {
		return CursorResponse[T]{}, ErrWindow
	}
	page := CursorPage{Limit: req.Limit, HasMore: len(rows) > req.Limit}
	if page.HasMore {
		if position == nil {
			return CursorResponse[T]{}, ErrWindow
		}
		rows = rows[:req.Limit]
		var err error
		page.NextCursor, err = codec.Encode(position(rows[len(rows)-1]))
		if err != nil {
			return CursorResponse[T]{}, err
		}
	}
	if rows == nil {
		rows = []T{}
	}
	return CursorResponse[T]{Data: rows, Pagination: page}, nil
}
