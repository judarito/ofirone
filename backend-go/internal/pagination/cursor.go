package pagination

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
)

const MaxCursorBytes = 4096

type Direction string

const (
	Ascending  Direction = "asc"
	Descending Direction = "desc"
)

// SortField describes server-owned ordering. The final field must be globally
// unique within the query scope. Composite unique keys can use their final field
// with Unique=true when uniqueness holds for the entire tuple.
type SortField struct {
	Name      string    `json:"name"`
	Direction Direction `json:"direction"`
	Unique    bool      `json:"unique"`
}

// Codec is immutable and safe for concurrent use. Tokens are opaque, not encrypted
// or signed. Never use a cursor to establish identity or authorization.
type Codec struct {
	fingerprint string
	fields      int
}

// NewCodec binds cursors to an order and query scope. Scope must include resource,
// authorized tenant, normalized filters and any snapshot/version boundary.
// Do not put secrets in scope or cursor values.
func NewCodec(order []SortField, scope string) (*Codec, error) {
	if len(order) == 0 || scope == "" || !order[len(order)-1].Unique {
		return nil, ErrOrder
	}
	seen := make(map[string]bool, len(order))
	for _, field := range order {
		if field.Name == "" || seen[field.Name] || field.Direction != Ascending && field.Direction != Descending {
			return nil, ErrOrder
		}
		seen[field.Name] = true
	}
	data, err := json.Marshal(struct {
		Order []SortField `json:"order"`
		Scope string      `json:"scope"`
	}{order, scope})
	if err != nil {
		return nil, ErrOrder
	}
	hash := sha256.Sum256(data)
	return &Codec{fingerprint: hex.EncodeToString(hash[:]), fields: len(order)}, nil
}

type token struct {
	Version int      `json:"v"`
	Query   string   `json:"q"`
	Values  []string `json:"k"`
}

// Encode preserves exact values (including large IDs and decimal strings).
func (c *Codec) Encode(values []string) (string, error) {
	if c == nil || c.fields == 0 || len(values) != c.fields {
		return "", ErrCursor
	}
	data, err := json.Marshal(token{Version: 1, Query: c.fingerprint, Values: values})
	if err != nil || base64.RawURLEncoding.EncodedLen(len(data)) > MaxCursorBytes {
		return "", ErrCursor
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func (c *Codec) Decode(raw string) ([]string, error) {
	if c == nil || c.fields == 0 || len(raw) == 0 || len(raw) > MaxCursorBytes {
		return nil, ErrCursor
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(raw)
	if err != nil || base64.RawURLEncoding.EncodeToString(data) != raw {
		return nil, ErrCursor
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var t token
	if decoder.Decode(&t) != nil || decoder.Decode(new(any)) != io.EOF || t.Version != 1 || t.Query != c.fingerprint || len(t.Values) != c.fields {
		return nil, ErrCursor
	}
	// Only accept the canonical format we emit; this also rejects duplicate keys
	// and JSON null values that encoding/json would otherwise coerce to strings.
	canonical, err := json.Marshal(t)
	if err != nil || !bytes.Equal(data, canonical) {
		return nil, ErrCursor
	}
	return t.Values, nil
}
