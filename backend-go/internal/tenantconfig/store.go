package tenantconfig

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalid = errors.New("tenantconfig: invalid request")
var ErrNotFound = errors.New("tenantconfig: not found")

type Settings struct {
	TenantID                    string  `json:"tenant_id"`
	BusinessName                *string `json:"business_name,omitempty"`
	BusinessAddress             *string `json:"business_address,omitempty"`
	BusinessPhone               *string `json:"business_phone,omitempty"`
	LogoURL                     *string `json:"logo_url,omitempty"`
	ReceiptFooter               *string `json:"receipt_footer,omitempty"`
	DefaultTaxIncluded          bool    `json:"default_tax_included"`
	DefaultPageSize             int     `json:"default_page_size"`
	Theme                       string  `json:"theme"`
	DateFormat                  string  `json:"date_format"`
	Locale                      string  `json:"locale"`
	SessionTimeoutMinutes       int     `json:"session_timeout_minutes"`
	AccountingEnabled           bool    `json:"accounting_enabled"`
	AccountingMode              string  `json:"accounting_mode"`
	AccountingAutoPostSales     bool    `json:"accounting_auto_post_sales"`
	AccountingAutoPostPurchases bool    `json:"accounting_auto_post_purchases"`
	ExpiryAlertDays             int     `json:"expiry_alert_days"`
	ReserveStockOnLayaway       bool    `json:"reserve_stock_on_layaway"`
	MaxDiscountWithoutAuth      float64 `json:"max_discount_without_auth"`
	RoundingMethod              string  `json:"rounding_method"`
	RoundingMultiple            int     `json:"rounding_multiple"`
	InvoicePrefix               string  `json:"invoice_prefix"`
	NextInvoiceNumber           int     `json:"next_invoice_number"`
	ElectronicInvoicingEnabled  bool    `json:"electronic_invoicing_enabled"`
	PrintFormat                 string  `json:"print_format"`
	ThermalPaperWidth           int     `json:"thermal_paper_width"`
	EmailAlertsEnabled          bool    `json:"email_alerts_enabled"`
	AlertEmail                  *string `json:"alert_email,omitempty"`
	NotifyLowStock              bool    `json:"notify_low_stock"`
	NotifyExpiringProducts      bool    `json:"notify_expiring_products"`
}

type BillingSummary struct {
	TenantID         string         `json:"tenant_id"`
	PlanCode         string         `json:"plan_code"`
	PlanName         string         `json:"plan_name"`
	Status           string         `json:"status"`
	CurrentPeriodEnd *time.Time     `json:"current_period_end,omitempty"`
	TrialEndAt       *time.Time     `json:"trial_end_at,omitempty"`
	GraceEndAt       *time.Time     `json:"grace_end_at,omitempty"`
	FeatureFlags     map[string]any `json:"feature_flags"`
	PlanLimits       map[string]any `json:"plan_limits"`
}

type Store interface {
	GetSettings(context.Context, string) (Settings, error)
	SaveSettings(context.Context, string, Settings) (Settings, error)
	GetBillingSummary(context.Context, string) (BillingSummary, error)
}
type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(p *pgxpool.Pool) *PGStore { return &PGStore{pool: p} }
func (s *PGStore) tx(ctx context.Context, tenant string, fn func(pgx.Tx) error) error {
	if strings.TrimSpace(tenant) == "" {
		return ErrInvalid
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "select set_config('app.tenant_id',$1,true)", tenant); e != nil {
		return e
	}
	if e = fn(tx); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *PGStore) GetSettings(ctx context.Context, tenant string) (out Settings, e error) {
	e = s.tx(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `select tenant_id::text,business_name,business_address,business_phone,logo_url,receipt_footer,default_tax_included,default_page_size,theme,date_format,locale,session_timeout_minutes,accounting_enabled,accounting_mode,accounting_auto_post_sales,accounting_auto_post_purchases,expiry_alert_days,reserve_stock_on_layaway,max_discount_without_auth,rounding_method,rounding_multiple,invoice_prefix,next_invoice_number,electronic_invoicing_enabled,print_format,thermal_paper_width,email_alerts_enabled,alert_email,notify_low_stock,notify_expiring_products from public.tenant_settings where tenant_id=$1::uuid`, tenant).Scan(&out.TenantID, &out.BusinessName, &out.BusinessAddress, &out.BusinessPhone, &out.LogoURL, &out.ReceiptFooter, &out.DefaultTaxIncluded, &out.DefaultPageSize, &out.Theme, &out.DateFormat, &out.Locale, &out.SessionTimeoutMinutes, &out.AccountingEnabled, &out.AccountingMode, &out.AccountingAutoPostSales, &out.AccountingAutoPostPurchases, &out.ExpiryAlertDays, &out.ReserveStockOnLayaway, &out.MaxDiscountWithoutAuth, &out.RoundingMethod, &out.RoundingMultiple, &out.InvoicePrefix, &out.NextInvoiceNumber, &out.ElectronicInvoicingEnabled, &out.PrintFormat, &out.ThermalPaperWidth, &out.EmailAlertsEnabled, &out.AlertEmail, &out.NotifyLowStock, &out.NotifyExpiringProducts)
	})
	if errors.Is(e, pgx.ErrNoRows) {
		e = ErrNotFound
	}
	return
}
func (s *PGStore) SaveSettings(ctx context.Context, tenant string, v Settings) (out Settings, e error) {
	if v.DefaultPageSize < 1 || v.DefaultPageSize > 100 || v.SessionTimeoutMinutes < 1 || v.MaxDiscountWithoutAuth < 0 || v.MaxDiscountWithoutAuth > 100 {
		return out, ErrInvalid
	}
	e = s.tx(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `insert into public.tenant_settings (tenant_id,business_name,business_address,business_phone,logo_url,receipt_footer,default_tax_included,default_page_size,theme,date_format,locale,session_timeout_minutes,accounting_enabled,accounting_mode,accounting_auto_post_sales,accounting_auto_post_purchases,expiry_alert_days,reserve_stock_on_layaway,max_discount_without_auth,rounding_method,rounding_multiple,invoice_prefix,next_invoice_number,electronic_invoicing_enabled,print_format,thermal_paper_width,email_alerts_enabled,alert_email,notify_low_stock,notify_expiring_products) values($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) on conflict(tenant_id) do update set business_name=excluded.business_name,business_address=excluded.business_address,business_phone=excluded.business_phone,logo_url=excluded.logo_url,receipt_footer=excluded.receipt_footer,default_tax_included=excluded.default_tax_included,default_page_size=excluded.default_page_size,theme=excluded.theme,date_format=excluded.date_format,locale=excluded.locale,session_timeout_minutes=excluded.session_timeout_minutes,accounting_enabled=excluded.accounting_enabled,accounting_mode=excluded.accounting_mode,accounting_auto_post_sales=excluded.accounting_auto_post_sales,accounting_auto_post_purchases=excluded.accounting_auto_post_purchases,expiry_alert_days=excluded.expiry_alert_days,reserve_stock_on_layaway=excluded.reserve_stock_on_layaway,max_discount_without_auth=excluded.max_discount_without_auth,rounding_method=excluded.rounding_method,rounding_multiple=excluded.rounding_multiple,invoice_prefix=excluded.invoice_prefix,next_invoice_number=excluded.next_invoice_number,electronic_invoicing_enabled=excluded.electronic_invoicing_enabled,print_format=excluded.print_format,thermal_paper_width=excluded.thermal_paper_width,email_alerts_enabled=excluded.email_alerts_enabled,alert_email=excluded.alert_email,notify_low_stock=excluded.notify_low_stock,notify_expiring_products=excluded.notify_expiring_products returning tenant_id::text,business_name,business_address,business_phone,logo_url,receipt_footer,default_tax_included,default_page_size,theme,date_format,locale,session_timeout_minutes,accounting_enabled,accounting_mode,accounting_auto_post_sales,accounting_auto_post_purchases,expiry_alert_days,reserve_stock_on_layaway,max_discount_without_auth,rounding_method,rounding_multiple,invoice_prefix,next_invoice_number,electronic_invoicing_enabled,print_format,thermal_paper_width,email_alerts_enabled,alert_email,notify_low_stock,notify_expiring_products`, tenant, v.BusinessName, v.BusinessAddress, v.BusinessPhone, v.LogoURL, v.ReceiptFooter, v.DefaultTaxIncluded, v.DefaultPageSize, v.Theme, v.DateFormat, v.Locale, v.SessionTimeoutMinutes, v.AccountingEnabled, v.AccountingMode, v.AccountingAutoPostSales, v.AccountingAutoPostPurchases, v.ExpiryAlertDays, v.ReserveStockOnLayaway, v.MaxDiscountWithoutAuth, v.RoundingMethod, v.RoundingMultiple, v.InvoicePrefix, v.NextInvoiceNumber, v.ElectronicInvoicingEnabled, v.PrintFormat, v.ThermalPaperWidth, v.EmailAlertsEnabled, v.AlertEmail, v.NotifyLowStock, v.NotifyExpiringProducts).Scan(&out.TenantID, &out.BusinessName, &out.BusinessAddress, &out.BusinessPhone, &out.LogoURL, &out.ReceiptFooter, &out.DefaultTaxIncluded, &out.DefaultPageSize, &out.Theme, &out.DateFormat, &out.Locale, &out.SessionTimeoutMinutes, &out.AccountingEnabled, &out.AccountingMode, &out.AccountingAutoPostSales, &out.AccountingAutoPostPurchases, &out.ExpiryAlertDays, &out.ReserveStockOnLayaway, &out.MaxDiscountWithoutAuth, &out.RoundingMethod, &out.RoundingMultiple, &out.InvoicePrefix, &out.NextInvoiceNumber, &out.ElectronicInvoicingEnabled, &out.PrintFormat, &out.ThermalPaperWidth, &out.EmailAlertsEnabled, &out.AlertEmail, &out.NotifyLowStock, &out.NotifyExpiringProducts)
	})
	return
}
func (s *PGStore) GetBillingSummary(ctx context.Context, tenant string) (out BillingSummary, e error) {
	e = s.tx(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `select tenant_id::text,'starter','Starter','active',null::timestamptz,null::timestamptz,null::timestamptz,'{}'::jsonb,'{}'::jsonb from public.tenants where tenant_id=$1::uuid`, tenant).Scan(&out.TenantID, &out.PlanCode, &out.PlanName, &out.Status, &out.CurrentPeriodEnd, &out.TrialEndAt, &out.GraceEndAt, &out.FeatureFlags, &out.PlanLimits)
	})
	if errors.Is(e, pgx.ErrNoRows) {
		e = ErrNotFound
	}
	return
}
