package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PGLoginStore struct {
	pool       *pgxpool.Pool
	sessionTTL time.Duration
}

func NewPGLoginStore(pool *pgxpool.Pool, sessionTTL time.Duration) (*PGLoginStore, error) {
	if pool == nil || sessionTTL <= 0 {
		return nil, fmt.Errorf("auth: invalid postgres login store")
	}
	return &PGLoginStore{pool: pool, sessionTTL: sessionTTL}, nil
}

func (s *PGLoginStore) FindLogin(ctx context.Context, email string, tenant TenantID) (LoginRecord, error) {
	if email == "" {
		return LoginRecord{}, ErrAuthenticationFailed
	}
	var r LoginRecord
	var membership string
	permissions := []string{}
	query := `SELECT i.identity_id,tm.tenant_id,ic.password_hash,tm.membership_id,COALESCE(array_agg(DISTINCT p.code) FILTER(WHERE p.code IS NOT NULL),'{}') FROM public.identities i JOIN public.identity_credentials ic ON ic.identity_id=i.identity_id JOIN public.tenant_memberships tm ON tm.identity_id=i.identity_id AND tm.status='active' LEFT JOIN public.membership_roles mr ON mr.tenant_id=tm.tenant_id AND mr.membership_id=tm.membership_id LEFT JOIN public.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id LEFT JOIN public.permissions p ON p.permission_id=rp.permission_id WHERE lower(i.email)=lower($1) AND i.status='active'`
	args := []any{email}
	if tenant != "" {
		query += ` AND tm.tenant_id=$2::uuid`
		args = append(args, string(tenant))
	}
	query += ` GROUP BY i.identity_id,tm.tenant_id,ic.password_hash,tm.membership_id ORDER BY tm.tenant_id LIMIT 1`
	err := s.pool.QueryRow(ctx, query, args...).Scan(&r.Principal.Identity.ID, &r.Principal.Tenant.ID, &r.PasswordHash, &membership, &permissions)
	if err != nil {
		return LoginRecord{}, ErrAuthenticationFailed
	}
	r.Principal.Permissions = make([]Permission, 0, len(permissions))
	for _, p := range permissions {
		r.Principal.Permissions = append(r.Principal.Permissions, Permission(p))
	}
	var sessionID string
	err = s.pool.QueryRow(ctx, `INSERT INTO public.sessions(tenant_id,membership_id,identity_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4::interval) RETURNING session_id`, r.Principal.Tenant.ID, membership, r.Principal.Identity.ID, fmt.Sprintf("%d seconds", int(s.sessionTTL.Seconds()))).Scan(&sessionID)
	if err != nil {
		return LoginRecord{}, ErrAuthenticationFailed
	}
	r.SessionID = sessionID
	return r, nil
}
func (s *PGLoginStore) SaveRefresh(ctx context.Context, session string, tenant TenantID, hash [32]byte, expires time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO public.refresh_tokens(tenant_id,session_id,token_hash,expires_at) VALUES($1,$2,$3,$4)`, tenant, session, hash[:], expires)
	return err
}
func (s *PGLoginStore) ConsumeRefresh(ctx context.Context, hash [32]byte) (LoginRecord, error) {
	var r LoginRecord
	permissions := []string{}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return r, ErrAuthenticationFailed
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, `UPDATE public.refresh_tokens SET consumed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING tenant_id,session_id`, hash[:]).Scan(&r.Principal.Tenant.ID, &r.SessionID); err != nil {
		return r, ErrAuthenticationFailed
	}
	if err = tx.QueryRow(ctx, `SELECT i.identity_id,COALESCE(array_agg(DISTINCT p.code) FILTER(WHERE p.code IS NOT NULL),'{}') FROM public.sessions s JOIN public.identities i ON i.identity_id=s.identity_id JOIN public.membership_roles mr ON mr.tenant_id=s.tenant_id AND mr.membership_id=s.membership_id LEFT JOIN public.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id LEFT JOIN public.permissions p ON p.permission_id=rp.permission_id WHERE s.session_id=$1 AND s.tenant_id=$2 AND s.revoked_at IS NULL GROUP BY i.identity_id`, r.SessionID, r.Principal.Tenant.ID).Scan(&r.Principal.Identity.ID, &permissions); err != nil {
		return r, ErrAuthenticationFailed
	}
	r.Principal.Permissions = make([]Permission, 0, len(permissions))
	for _, p := range permissions {
		r.Principal.Permissions = append(r.Principal.Permissions, Permission(p))
	}
	if err = tx.Commit(ctx); err != nil {
		return LoginRecord{}, ErrAuthenticationFailed
	}
	return r, nil
}
func (s *PGLoginStore) RevokeSession(ctx context.Context, session string, tenant TenantID) error {
	_, err := s.pool.Exec(ctx, `UPDATE public.sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND session_id=$2 AND revoked_at IS NULL`, tenant, session)
	return err
}
