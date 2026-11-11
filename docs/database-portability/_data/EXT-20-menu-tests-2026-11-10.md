# EXT-20 — Menús por rol

Estado: **PASS (tests de contrato)**.

Tests añadidos en `backend-go/internal/httpapi/menu_roles_test.go`:
- ADMINISTRADOR recibe `USERS` y no `SALES`; CAJERO recibe `SALES` y no `USERS`.
- El tenant se toma del principal; el menú de otro tenant no se filtra.
- Sin autenticación → 401.
- No se editó `menus.go`.
