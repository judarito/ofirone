// Command dev-auth-bootstrap creates/updates one local DEV login.
// It refuses to run unless APP_ENV is development (or DEV_AUTH_ALLOW is set).
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"ofirone/backend-go/internal/auth"
)

func main() {
	if os.Getenv("APP_ENV") != "development" && os.Getenv("DEV_AUTH_ALLOW") != "1" { panic("refusing: set APP_ENV=development or DEV_AUTH_ALLOW=1") }
	dsn, email, password := os.Getenv("DATABASE_URL"), strings.ToLower(strings.TrimSpace(os.Getenv("DEV_AUTH_EMAIL"))), os.Getenv("DEV_AUTH_PASSWORD")
	if dsn == "" || email == "" || len(password) < 12 { panic("DATABASE_URL, DEV_AUTH_EMAIL and DEV_AUTH_PASSWORD (12+ chars) are required") }
	hash, err := auth.HashPassword(password); if err != nil { panic(err) }
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second); defer cancel()
	p, err := pgxpool.New(ctx, dsn); if err != nil { panic(err) }; defer p.Close()
	tx, err := p.Begin(ctx); if err != nil { panic(err) }; defer tx.Rollback(ctx)
	// DEV-only convenience: install the pre-auth function before seeding.
	if ddl, readErr := os.ReadFile("../database/migrations/0023_auth_login_lookup.up.sql"); readErr == nil {
		ddlText := strings.ReplaceAll(strings.ReplaceAll(string(ddl), "BEGIN;", ""), "COMMIT;", "")
		if _, err = tx.Exec(ctx, ddlText); err != nil { panic(err) }
	}
	var tenant, role, identity, membership string
	if err = tx.QueryRow(ctx, `SELECT tenant_id FROM public.tenants ORDER BY tenant_id LIMIT 1`).Scan(&tenant); err != nil {
		if err = tx.QueryRow(ctx, `INSERT INTO public.tenants(slug,name,status) VALUES('dev-local','DEV Local','active') RETURNING tenant_id`).Scan(&tenant); err != nil { panic("could not create DEV tenant") }
	}
	if err = tx.QueryRow(ctx, `INSERT INTO public.roles(tenant_id,code,name) VALUES($1,'dev_admin','DEV Admin') ON CONFLICT(tenant_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING role_id`, tenant).Scan(&role); err != nil { panic(err) }
	if err = tx.QueryRow(ctx, `INSERT INTO public.identities(email,display_name,status,email_verified_at) VALUES($1,$2,'active',clock_timestamp()) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,status='active',email_verified_at=clock_timestamp() RETURNING identity_id`, email, "DEV Test User").Scan(&identity); err != nil { panic(err) }
	if _, err = tx.Exec(ctx, `INSERT INTO public.identity_credentials(identity_id,password_hash) VALUES($1,$2) ON CONFLICT(identity_id) DO UPDATE SET password_hash=EXCLUDED.password_hash`, identity, hash); err != nil { panic(err) }
	if err = tx.QueryRow(ctx, `INSERT INTO public.tenant_memberships(tenant_id,identity_id,status) VALUES($1,$2,'active') ON CONFLICT(tenant_id,identity_id) DO UPDATE SET status='active' RETURNING membership_id`, tenant, identity).Scan(&membership); err != nil { panic(err) }
	if _, err = tx.Exec(ctx, `INSERT INTO public.membership_roles(tenant_id,membership_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, tenant, membership, role); err != nil { panic(err) }
	if err = tx.Commit(ctx); err != nil { panic(err) }
	store, err := auth.NewPGLoginStore(p, time.Hour); if err != nil { panic(err) }
	record, err := store.FindLogin(ctx, email, "")
	if err != nil { panic(fmt.Sprintf("user was written but login lookup failed: %v", err)) }
	ok, err := auth.VerifyPassword(password, record.PasswordHash)
	if err != nil || !ok { panic("user lookup succeeded but Argon2 verification failed") }
	fmt.Println("DEV auth user ready:", email)
}

