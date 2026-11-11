# EXT-18 — Rol runtime sin BYPASSRLS

Estado: **resuelto parcialmente en DEV (hotfix), pendiente de ledger**.

- `ofirone_auth` estaba con `rolbypassrls=true`; se ejecutó `ALTER ROLE ofirone_auth NOBYPASSRLS`.
- Se creó/validó la política `identity_credentials_auth_read` (`SELECT` solo para `ofirone_auth`), sin INSERT/UPDATE/DELETE.
- Prueba: auth lee credenciales (login por email/tenant), INSERT rechazado `42501`.
- Migración propuesta `0025_runtime_role` creada y aplicada **manualmente**; **no está en el ledger** (22) porque `0023/0024` siguen pendientes.

Evidencia: [`validation-EXT-18-auth-role-fix-2026-11-10.txt`](validation-EXT-18-auth-role-fix-2026-11-10.txt). No se alteró el owner de DEV/PROD.
