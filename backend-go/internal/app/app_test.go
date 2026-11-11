package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testServer struct {
	http     *http.Server
	stopping chan struct{}
	once     sync.Once
	forced   atomic.Bool
}

func (s *testServer) Serve(l net.Listener) error { return s.http.Serve(l) }
func (s *testServer) BeginShutdown() {
	s.once.Do(func() { close(s.stopping) })
}
func (s *testServer) Shutdown(ctx context.Context) error { return s.http.Shutdown(ctx) }
func (s *testServer) Close() error {
	s.forced.Store(true)
	return s.http.Close()
}

func listen(t *testing.T) net.Listener {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
	return l
}

func await[T any](t *testing.T, result <-chan T) T {
	t.Helper()
	select {
	case value := <-result:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for lifecycle event")
		var zero T
		return zero
	}
}

func TestRunDrainsInflightRequest(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	s := &testServer{stopping: make(chan struct{})}
	s.http = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "completed")
	})}
	t.Cleanup(func() { _ = s.Close() })
	a, err := New(s, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	l := listen(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Run(ctx, l) }()
	response := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		res, err := client.Get("http://" + l.Addr().String())
		if err != nil {
			response <- err
			return
		}
		defer res.Body.Close()
		body, err := io.ReadAll(res.Body)
		if err == nil && string(body) != "completed" {
			err = errors.New("in-flight response was not completed")
		}
		response <- err
	}()
	await(t, started)
	cancel()
	await(t, s.stopping)
	select {
	case err := <-done:
		t.Fatalf("Run returned before active request completed: %v", err)
	default:
	}
	releaseOnce.Do(func() { close(release) })
	if err := await(t, response); err != nil {
		t.Fatal(err)
	}
	if err := await(t, done); err != nil {
		t.Fatal(err)
	}
	if s.forced.Load() {
		t.Fatal("successful shutdown must not force-close connections")
	}
}

func TestRunForceClosesAfterDeadline(t *testing.T) {
	started := make(chan struct{})
	handlerDone := make(chan struct{})
	s := &testServer{stopping: make(chan struct{})}
	s.http = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(handlerDone)
	})}
	t.Cleanup(func() { _ = s.Close() })
	a, err := New(s, 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	l := listen(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Run(ctx, l) }()
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		client := &http.Client{Timeout: 3 * time.Second}
		res, err := client.Get("http://" + l.Addr().String())
		if err == nil {
			_ = res.Body.Close()
		}
	}()
	await(t, started)
	cancel()
	if err := await(t, done); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Run error = %v, want shutdown deadline", err)
	}
	if !s.forced.Load() {
		t.Fatal("timed out shutdown must force-close connections")
	}
	await(t, handlerDone)
	await(t, clientDone)
}

type failingServer struct {
	err      error
	stopping bool
	shutdown bool
}

func (s *failingServer) Serve(l net.Listener) error {
	_ = l.Close()
	return s.err
}
func (s *failingServer) BeginShutdown() { s.stopping = true }
func (s *failingServer) Shutdown(context.Context) error {
	s.shutdown = true
	return nil
}
func (s *failingServer) Close() error { return nil }

func TestRunPreservesServeFailure(t *testing.T) {
	want := errors.New("listener failed")
	s := &failingServer{err: want}
	a, err := New(s, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Run(context.Background(), listen(t)); !errors.Is(err, want) {
		t.Fatalf("Run error = %v, want listener failure", err)
	}
	if !s.stopping || !s.shutdown {
		t.Fatal("serve failure must trigger shutdown")
	}
}

func TestRunWithCanceledContextClosesListener(t *testing.T) {
	s := &failingServer{}
	a, err := New(s, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	l := listen(t)
	if err := a.Run(ctx, l); err != nil {
		t.Fatal(err)
	}
	if !s.stopping {
		t.Fatal("canceled startup must mark server stopping")
	}
	if _, err := l.Accept(); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("listener must be closed: %v", err)
	}
}

func TestValidation(t *testing.T) {
	if _, err := New(nil, time.Second); err == nil {
		t.Fatal("nil server accepted")
	}
	for _, timeout := range []time.Duration{0, -time.Second} {
		if _, err := New(&failingServer{}, timeout); err == nil {
			t.Fatal("nonpositive shutdown timeout accepted")
		}
	}
	a, err := New(&failingServer{}, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Run(context.Background(), nil); err == nil {
		t.Fatal("nil listener accepted")
	}
}
