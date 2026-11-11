package httpapi

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
	"ofirone/backend-go/internal/auth"
)

type MenuStore interface {
	ListMenus(context.Context, auth.Principal) ([]menuItem, error)
}

type menuQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type pgMenuStore struct{ db menuQuerier }

func NewPGMenuStore(db menuQuerier) MenuStore { return &pgMenuStore{db: db} }

type menuItem struct {
	Code       string     `json:"code"`
	Label      string     `json:"label"`
	Icon       string     `json:"icon"`
	Route      string     `json:"route,omitempty"`
	Action     string     `json:"action,omitempty"`
	ParentCode string     `json:"parent_code,omitempty"`
	SortOrder  int        `json:"sort_order"`
	Children   []menuItem `json:"children,omitempty"`
}

// P0 menu contract. Authorization comes from the verified JWT principal;
// the browser never decides which menu response it receives.
func (s *Server) menus(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Autenticación requerida.", false)
		return
	}
	if s.menuStore != nil {
		items, err := s.menuStore.ListMenus(r.Context(), p)
		if err != nil {
			WriteError(w, r, http.StatusServiceUnavailable, "MENU_UNAVAILABLE", "No se pudo cargar el menú.", true)
			return
		}
		writeJSON(w, r, http.StatusOK, struct {
			Data []menuItem `json:"data"`
		}{Data: items})
		return
	}
	writeJSON(w, r, http.StatusOK, struct {
		Data []menuItem `json:"data"`
	}{Data: []menuItem{
		{Code: "DASHBOARD", Label: "Escritorio", Icon: "mdi-view-dashboard", Route: "/", SortOrder: 10},
		{Code: "CUSTOMERS", Label: "Clientes", Icon: "mdi-account-group", Route: "/customers", SortOrder: 20},
		{Code: "PRODUCTS", Label: "Productos", Icon: "mdi-package-variant", Route: "/products", SortOrder: 30},
		{Code: "INVENTORY", Label: "Inventario", Icon: "mdi-warehouse", Route: "/inventory", SortOrder: 40},
		{Code: "SALES", Label: "Ventas", Icon: "mdi-cart", Route: "/sales", SortOrder: 50},
	}})
}

func (s *pgMenuStore) ListMenus(ctx context.Context, p auth.Principal) ([]menuItem, error) {
	rows, err := s.db.Query(ctx, `
		WITH RECURSIVE assigned AS (
			SELECT DISTINCT mi.menu_item_id, mi.code, mi.label, mi.icon, mi.route, mi.action, mi.parent_code, mi.sort_order
			FROM public.menu_items mi
			JOIN public.role_menus rm ON rm.menu_item_id = mi.menu_item_id AND rm.tenant_id = $1
			JOIN public.membership_roles mr ON mr.tenant_id = rm.tenant_id AND mr.role_id = rm.role_id
			JOIN public.tenant_memberships tm ON tm.tenant_id = mr.tenant_id AND tm.membership_id = mr.membership_id
			WHERE tm.identity_id = $2 AND tm.status = 'active' AND mi.is_active AND NOT mi.is_superadmin_only
			  AND (NOT EXISTS (SELECT 1 FROM public.menu_permissions mp WHERE mp.menu_item_id = mi.menu_item_id)
			       OR EXISTS (SELECT 1 FROM public.menu_permissions mp JOIN public.permissions p2 ON p2.permission_id = mp.permission_id WHERE mp.menu_item_id = mi.menu_item_id AND p2.code = ANY($3::text[])))
		), hierarchy AS (
			SELECT * FROM assigned
			UNION
			SELECT parent.menu_item_id, parent.code, parent.label, parent.icon, parent.route, parent.action, parent.parent_code, parent.sort_order
			FROM public.menu_items parent JOIN hierarchy h ON h.parent_code = parent.code
			WHERE parent.is_active AND NOT parent.is_superadmin_only
		)
		SELECT DISTINCT menu_item_id, code, label, icon, route, action, parent_code, sort_order
		FROM hierarchy ORDER BY sort_order, code`, string(p.Tenant.ID), string(p.Identity.ID), permissionsText(p.Permissions))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]menuItem, 0)
	for rows.Next() {
		var item menuItem
		var id, icon, route, action, parent *string
		if err := rows.Scan(&id, &item.Code, &item.Label, &icon, &route, &action, &parent, &item.SortOrder); err != nil {
			return nil, err
		}
		if icon != nil {
			item.Icon = *icon
		}
		if route != nil {
			item.Route = *route
		}
		if action != nil {
			item.Action = *action
		}
		if parent != nil {
			item.ParentCode = *parent
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func permissionsText(values []auth.Permission) []string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = string(v)
	}
	return out
}
