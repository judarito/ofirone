package pagination

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func testCodec(t *testing.T, scope string) *Codec {
	t.Helper()
	c, err := NewCodec([]SortField{
		{Name: "created_at", Direction: Descending},
		{Name: "id", Direction: Descending, Unique: true},
	}, scope)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestParseOffset(t *testing.T) {
	for _, tt := range []struct {
		name  string
		query string
		want  OffsetRequest
		err   error
	}{
		{"defaults", "", OffsetRequest{25, 0}, nil},
		{"boundary", "limit=100&offset=1000000", OffsetRequest{100, 1000000}, nil},
		{"zero limit", "limit=0", OffsetRequest{}, ErrLimit},
		{"large limit", "limit=101", OffsetRequest{}, ErrLimit},
		{"negative", "offset=-1", OffsetRequest{}, ErrOffset},
		{"large offset", "offset=1000001", OffsetRequest{}, ErrOffset},
		{"empty", "limit=", OffsetRequest{}, ErrLimit},
		{"duplicate", "limit=1&limit=2", OffsetRequest{}, ErrLimit},
		{"duplicate offset", "offset=1&offset=1", OffsetRequest{}, ErrOffset},
		{"decimal", "limit=1.5", OffsetRequest{}, ErrLimit},
		{"space", "limit=+2", OffsetRequest{}, ErrLimit},
		{"overflow", "offset=9999999999999999999999999", OffsetRequest{}, ErrOffset},
		{"mixed mode", "cursor=abc", OffsetRequest{}, ErrCursor},
	} {
		t.Run(tt.name, func(t *testing.T) {
			values, err := url.ParseQuery(tt.query)
			if err != nil {
				t.Fatal(err)
			}
			got, err := ParseOffset(values, DefaultLimits())
			if !errors.Is(err, tt.err) || got != tt.want {
				t.Fatalf("got %+v, %v; want %+v, %v", got, err, tt.want, tt.err)
			}
		})
	}
}

func TestLimits(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	for _, limits := range []Limits{{}, {0, 10, 0}, {10, 9, 0}, {1, 1, -1}, {1, maxInt, 0}} {
		if _, err := ParseOffset(nil, limits); !errors.Is(err, ErrLimits) {
			t.Fatalf("accepted %+v", limits)
		}
	}
	if _, err := ParseOffset(url.Values{"offset": {"9223372036854775807"}}, Limits{1, 1, maxInt}); !errors.Is(err, ErrOffset) {
		t.Fatalf("offset overflow: %v", err)
	}
}

func TestStableOrderValidation(t *testing.T) {
	for _, order := range [][]SortField{
		nil,
		{{Name: "created_at", Direction: Descending}},
		{{Name: "id", Direction: "random", Unique: true}},
		{{Name: "", Direction: Ascending, Unique: true}},
		{{Name: "id", Direction: Ascending}, {Name: "id", Direction: Ascending, Unique: true}},
	} {
		if _, err := NewCodec(order, "sales:tenant-1"); !errors.Is(err, ErrOrder) {
			t.Fatalf("accepted %+v", order)
		}
	}
	if _, err := NewCodec([]SortField{{Name: "id", Direction: Ascending, Unique: true}}, ""); !errors.Is(err, ErrOrder) {
		t.Fatal("accepted empty scope")
	}
}

func TestCursorRoundTripAndBinding(t *testing.T) {
	c := testCodec(t, "sales:tenant-1:status=paid")
	values := []string{"2026-11-08T12:00:00.123456Z", "900719925474099312345"}
	raw, err := c.Encode(values)
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.Decode(raw)
	if err != nil || !reflect.DeepEqual(got, values) {
		t.Fatalf("roundtrip: %v %v", got, err)
	}
	for _, scope := range []string{"sales:tenant-2:status=paid", "sales:tenant-1:status=pending", "purchases:tenant-1:status=paid"} {
		if _, err := testCodec(t, scope).Decode(raw); !errors.Is(err, ErrCursor) {
			t.Fatalf("scope accepted: %s", scope)
		}
	}
	other, err := NewCodec([]SortField{{Name: "created_at", Direction: Ascending}, {Name: "id", Direction: Ascending, Unique: true}}, "sales:tenant-1:status=paid")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.Decode(raw); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted changed order")
	}
	// Tied timestamps must retain the unique ID, so successive positions differ.
	next, err := c.Encode([]string{values[0], "900719925474099312346"})
	if err != nil || next == raw {
		t.Fatal("lost stable tiebreaker")
	}
}

func TestInvalidCursors(t *testing.T) {
	c := testCodec(t, "sales:tenant-1")
	valid, err := c.Encode([]string{"date", "id"})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := base64.RawURLEncoding.DecodeString(valid)
	if err != nil {
		t.Fatal(err)
	}
	invalid := []string{"", "!invalid", valid + "=", strings.Repeat("a", MaxCursorBytes+1)}
	for _, data := range []string{
		string(payload) + "{}",
		strings.Replace(string(payload), `"v":1`, `"v":2`, 1),
		strings.Replace(string(payload), `"v":1`, `"v":1,"extra":true`, 1),
		strings.Replace(string(payload), `"v":1`, `"v":2,"v":1`, 1),
		strings.Replace(string(payload), `["date","id"]`, `[null,"id"]`, 1),
		strings.Replace(string(payload), `["date","id"]`, `["date"]`, 1),
		`{"v":1`,
	} {
		invalid = append(invalid, base64.RawURLEncoding.EncodeToString([]byte(data)))
	}
	for i, raw := range invalid {
		if _, err := c.Decode(raw); !errors.Is(err, ErrCursor) {
			t.Fatalf("accepted invalid token %d", i)
		}
	}
	if _, err := c.Encode([]string{"only one"}); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted missing position")
	}
	if _, err := c.Encode([]string{strings.Repeat("a", MaxCursorBytes), "id"}); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted oversized position")
	}
	var zero Codec
	if _, err := zero.Encode(nil); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted zero codec")
	}
}

func TestParseCursor(t *testing.T) {
	c := testCodec(t, "sales:tenant-1")
	raw, err := c.Encode([]string{"date", "id"})
	if err != nil {
		t.Fatal(err)
	}
	req, err := ParseCursor(url.Values{"limit": {"2"}, "cursor": {raw}}, DefaultLimits(), c)
	if err != nil || req.Limit != 2 || !reflect.DeepEqual(req.After, []string{"date", "id"}) {
		t.Fatalf("parse: %+v %v", req, err)
	}
	first, err := ParseCursor(nil, DefaultLimits(), c)
	if err != nil || first.Limit != 25 || first.After != nil {
		t.Fatalf("first: %+v %v", first, err)
	}
	for _, values := range []url.Values{{"cursor": {""}}, {"cursor": {raw, raw}}, {"offset": {"0"}}, {"limit": {"101"}}} {
		if _, err := ParseCursor(values, DefaultLimits(), c); err == nil {
			t.Fatalf("accepted %v", values)
		}
	}
	if _, err := ParseCursor(nil, DefaultLimits(), nil); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted nil codec")
	}
	if _, err := ParseCursor(nil, DefaultLimits(), &Codec{}); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted uninitialized codec")
	}
}

func TestWindows(t *testing.T) {
	c := testCodec(t, "sales:tenant-1")
	rows := []string{"id-1", "id-2", "id-3"}
	offset, err := OffsetWindow(rows, OffsetRequest{Limit: 2, Offset: 10})
	if err != nil || !offset.Pagination.HasMore || !reflect.DeepEqual(offset.Data, rows[:2]) {
		t.Fatalf("offset: %+v %v", offset, err)
	}
	cursor, err := CursorWindow(rows, CursorRequest{Limit: 2}, c, func(id string) []string { return []string{"same-time", id} })
	if err != nil || !cursor.Pagination.HasMore {
		t.Fatalf("cursor: %+v %v", cursor, err)
	}
	position, err := c.Decode(cursor.Pagination.NextCursor)
	if err != nil || !reflect.DeepEqual(position, []string{"same-time", "id-2"}) {
		t.Fatalf("wrong continuation: %v %v", position, err)
	}
	last, err := CursorWindow(rows[:2], CursorRequest{Limit: 2}, c, nil)
	if err != nil || last.Pagination.HasMore || last.Pagination.NextCursor != "" {
		t.Fatalf("last: %+v %v", last, err)
	}
	if _, err := OffsetWindow(rows, OffsetRequest{Limit: 1}); !errors.Is(err, ErrWindow) {
		t.Fatal("accepted excessive rows")
	}
	if _, err := OffsetWindow(rows, OffsetRequest{Limit: 0}); !errors.Is(err, ErrWindow) {
		t.Fatal("accepted zero limit")
	}
	if _, err := OffsetWindow(rows, OffsetRequest{Limit: 2, Offset: -1}); !errors.Is(err, ErrWindow) {
		t.Fatal("accepted negative offset")
	}
	if _, err := CursorWindow(rows, CursorRequest{Limit: 0}, c, nil); !errors.Is(err, ErrWindow) {
		t.Fatal("accepted zero cursor limit")
	}
	if _, err := CursorWindow(rows, CursorRequest{Limit: 1}, c, nil); !errors.Is(err, ErrWindow) {
		t.Fatal("accepted excessive cursor rows")
	}
	if _, err := CursorWindow(rows, CursorRequest{Limit: 2}, c, nil); !errors.Is(err, ErrWindow) {
		t.Fatal("accepted missing extractor")
	}
	if _, err := CursorWindow(rows, CursorRequest{Limit: 2}, c, func(string) []string { return nil }); !errors.Is(err, ErrCursor) {
		t.Fatal("accepted invalid extraction")
	}
}

func TestNeutralJSON(t *testing.T) {
	offset, err := OffsetWindow[int](nil, OffsetRequest{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(offset)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"data":[],"pagination":{"limit":25,"offset":0,"has_more":false}}` {
		t.Fatalf("unexpected offset JSON: %s", data)
	}
	cursor, err := CursorWindow[int](nil, CursorRequest{Limit: 25}, testCodec(t, "sales:tenant-1"), nil)
	if err != nil {
		t.Fatal(err)
	}
	data, err = json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"data":[],"pagination":{"limit":25,"has_more":false}}` {
		t.Fatalf("unexpected cursor JSON: %s", data)
	}
}

func FuzzDecodeCursor(f *testing.F) {
	c, err := NewCodec([]SortField{{Name: "id", Direction: Ascending, Unique: true}}, "sales:tenant-1")
	if err != nil {
		f.Fatal(err)
	}
	valid, err := c.Encode([]string{"id-1"})
	if err != nil {
		f.Fatal(err)
	}
	f.Add(valid)
	f.Add("invalid")
	f.Fuzz(func(t *testing.T, raw string) {
		values, err := c.Decode(raw)
		if err != nil {
			return
		}
		encoded, err := c.Encode(values)
		if err != nil || encoded != raw {
			t.Fatal("noncanonical cursor accepted")
		}
	})
}
