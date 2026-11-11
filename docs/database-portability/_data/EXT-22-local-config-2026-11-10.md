# EXT-22 — Contrato de configuración local

Estado: **PASS (documentado)**.

- Existen `backend-go/.env.example`, `.env.example` y `web/.env.example`.
- Backend Go: `DATABASE_URL` (obligatoria), `AUTH_DATABASE_URL`, `JWT_*`, `PORT`/`ADDR`; **no** incluir valores reales.
- Web: `VITE_BACKEND_URL`/base API y variables de Supabase legacy; Vite lee `.env.local`.
- Arranque: `cd backend-go && go run ./cmd/api`; `cd web && npm run dev`.
- Nunca versionar `.env`/`.env.local`; usar gestor de secretos.
