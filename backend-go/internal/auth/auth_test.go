package auth

import (
	"context"
	"errors"
	"testing"
)

func testPrincipal() Principal {
	return Principal{Identity: Identity{ID: "user-1"}, Tenant: Tenant{ID: "tenant-1"}, Permissions: []Permission{"sales:read"}}
}

func TestContext(t *testing.T) {
	ctx := context.Background()
	if _, ok := PrincipalFromContext(ctx); ok || HasPermission(ctx, "sales:read") {
		t.Fatal("empty context grants authority")
	}
	if _, ok := IdentityFromContext(ctx); ok {
		t.Fatal("unexpected identity")
	}
	if _, ok := TenantFromContext(ctx); ok {
		t.Fatal("unexpected tenant")
	}
	p := testPrincipal()
	ctx, err := WithPrincipal(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	p.Permissions[0] = "sales:write"
	if !HasPermission(ctx, "sales:read") || HasPermission(ctx, "sales:write") || HasPermission(ctx, "") || HasPermission(ctx, "*") {
		t.Fatal("permissions are not isolated or exact")
	}
	got, ok := PrincipalFromContext(ctx)
	if !ok {
		t.Fatal("missing principal")
	}
	got.Permissions[0] = "sales:write"
	if !HasPermission(ctx, "sales:read") {
		t.Fatal("returned permissions mutate context")
	}
	identity, ok := IdentityFromContext(ctx)
	if !ok || identity.ID != "user-1" {
		t.Fatal("incorrect identity")
	}
	tenant, ok := TenantFromContext(ctx)
	if !ok || tenant.ID != "tenant-1" {
		t.Fatal("incorrect tenant")
	}
	child, err := WithPrincipal(ctx, Principal{Identity: Identity{ID: "user-2"}, Tenant: Tenant{ID: "tenant-2"}})
	if err != nil {
		t.Fatal(err)
	}
	if HasPermission(child, "sales:read") {
		t.Fatal("inherited another tenant's permissions")
	}
	if !HasPermission(ctx, "sales:read") {
		t.Fatal("overwriting child changed parent")
	}
}

func TestInvalidPrincipal(t *testing.T) {
	for _, p := range []Principal{
		{}, {Identity: Identity{ID: "user"}}, {Tenant: Tenant{ID: "tenant"}},
		{Identity: Identity{ID: " "}, Tenant: Tenant{ID: "tenant"}},
		{Identity: Identity{ID: "user"}, Tenant: Tenant{ID: " tenant"}},
	} {
		if p.Valid() {
			t.Fatal("invalid principal accepted")
		}
		if _, err := WithPrincipal(context.Background(), p); !errors.Is(err, ErrInvalidPrincipal) {
			t.Fatalf("unexpected error: %v", err)
		}
	}
}
