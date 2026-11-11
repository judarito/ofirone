SHELL := /bin/sh
.DEFAULT_GOAL := help

GO ?= go
DOCKER ?= docker
GO_VERSION ?= 1.26
VERSION ?= dev
COMMIT ?= unknown
IMAGE ?= ofirone-api:local
LDFLAGS := -X main.version=$(VERSION) -X main.commit=$(COMMIT)
# Stream only module metadata and source to Docker; exclude local .env files.

.PHONY: help check-module check-go fmt fmt-check vet test test-race build run docker-build docker-test
help:
	@printf '%s\n' 'fmt | fmt-check | vet | test | test-race | build | run | docker-build | docker-test'

check-module:
	@test -f go.mod -a -f go.sum || { printf '%s\n' 'Missing go.mod/go.sum: integrator must initialize the backend-go module and pgx/v5 dependency. See README.md.' >&2; exit 1; }

check-go: check-module
	@command -v $(GO) >/dev/null 2>&1 || { printf '%s\n' 'Go is not installed. Use docker-test/docker-build with an accessible Docker daemon.' >&2; exit 1; }

fmt: check-go
	$(GO) fmt ./...

fmt-check: check-go
	@files="$$(gofmt -l cmd $$(test ! -d internal || printf internal))" || exit 1; test -z "$$files" || { printf '%s\n' 'Run make fmt.' >&2; exit 1; }

vet: check-go
	$(GO) vet ./...

test: check-go
	$(GO) test -count=1 ./...

test-race: check-go
	CGO_ENABLED=1 $(GO) test -race -count=1 ./...

build: check-go
	CGO_ENABLED=0 $(GO) build -trimpath -buildvcs=false -ldflags '$(LDFLAGS)' -o bin/api ./cmd/api

run: check-go
	$(GO) run -ldflags '$(LDFLAGS)' ./cmd/api

docker-build: check-module
	@tar -cf - Dockerfile go.mod go.sum cmd $$(test ! -d internal || printf internal) | $(DOCKER) build --build-arg GO_VERSION=$(GO_VERSION) --build-arg VERSION=$(VERSION) --build-arg COMMIT=$(COMMIT) -t $(IMAGE) -

# Copy only source into a disposable filesystem; avoid root-owned host output.
# Debian builder supplies the C toolchain required by the race detector.
docker-test: check-module
	@tar -cf - go.mod go.sum cmd $$(test ! -d internal || printf internal) | $(DOCKER) run --rm -i golang:$(GO_VERSION) sh -ec 'mkdir /src; tar -xf - -C /src; cd /src; files="$$(gofmt -l .)"; test -z "$$files"; go mod download; go mod verify; go vet ./...; go test -count=1 ./...; CGO_ENABLED=1 go test -race -count=1 ./...; CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /tmp/api ./cmd/api'
