package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoverReturnsJSONWithoutPanicDetails(t *testing.T) {
	h := RequestID(Recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("secret-token")
	})))
	w := request(h, "GET", "/")
	var result ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if w.Code != 500 || result.Code != "INTERNAL_ERROR" || result.RequestID == "" || result.RequestID != w.Header().Get("X-Request-ID") || strings.Contains(w.Body.String(), "secret-token") {
		t.Fatalf("unexpected panic response: %s", w.Body.String())
	}
}

func TestRecoverAbortsCommittedResponse(t *testing.T) {
	for _, flush := range []bool{false, true} {
		func() {
			defer func() {
				if value := recover(); value != http.ErrAbortHandler {
					t.Errorf("panic = %v, want ErrAbortHandler", value)
				}
			}()
			h := Recover(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if flush {
					if err := http.NewResponseController(w).Flush(); err != nil {
						t.Fatal(err)
					}
				} else {
					_, _ = w.Write([]byte("partial"))
				}
				panic("private details")
			}))
			w := request(h, "GET", "/")
			t.Errorf("expected connection abort, got %s", w.Body.String())
		}()
	}
}

func TestRecoverPreservesAbortHandler(t *testing.T) {
	defer func() {
		if value := recover(); value != http.ErrAbortHandler {
			t.Errorf("panic = %v, want ErrAbortHandler", value)
		}
	}()
	request(Recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	})), "GET", "/")
	t.Error("expected ErrAbortHandler")
}

func TestJSONEncodingFailureIsNormalized(t *testing.T) {
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, http.StatusOK, make(chan int))
	}))
	w := request(h, "GET", "/")
	if w.Code != 500 || !json.Valid(w.Body.Bytes()) || !strings.Contains(w.Body.String(), "INTERNAL_ERROR") {
		t.Fatalf("invalid fallback: %s", w.Body.String())
	}
}

func TestRecoveryWriterUnwrap(t *testing.T) {
	original := httptest.NewRecorder()
	w := &responseWriter{ResponseWriter: original}
	if w.Unwrap() != original {
		t.Fatal("Unwrap must preserve underlying writer")
	}
	w.WriteHeader(201)
	w.WriteHeader(500)
	if original.Code != 201 {
		t.Fatal("second final header must be ignored")
	}
}
