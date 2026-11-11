#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend-go"
WEB_DIR="$ROOT_DIR/web"
GO_BIN="${GO_BIN:-go}"

if ! command -v "$GO_BIN" >/dev/null 2>&1; then
  echo "Go no está instalado. No se usará un binario viejo: instala Go o define GO_BIN=/ruta/al/go." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env.database.local" ]]; then
  echo "Falta .env.database.local" >&2
  exit 1
fi

set -a
source <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=\(.*\)$/\1=\2/p' "$ROOT_DIR/.env.database.local")
set +a

export PORT=8787
export CORS_ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
export JWT_ISSUER="${JWT_ISSUER:-ofirone-local}"
export JWT_AUDIENCE="${JWT_AUDIENCE:-ofirone-web}"
export JWT_ALGORITHM="${JWT_ALGORITHM:-HS256}"
export JWT_HMAC_KEY="${JWT_HMAC_KEY:-ofirone-dev-only-key-change-me-32-bytes!!}"

# Only stop the two development ports; never kill arbitrary Go/Node processes.
fuser -k 8787/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true

mkdir -p "$ROOT_DIR/.local-run"
echo "Construyendo backend desde el código fuente..."
(cd "$BACKEND_DIR" && "$GO_BIN" build -trimpath -buildvcs=false -o "$ROOT_DIR/.local-run/api" ./cmd/api)

echo "Iniciando backend en http://127.0.0.1:8787"
(cd "$BACKEND_DIR" && exec "$ROOT_DIR/.local-run/api") >"$ROOT_DIR/.local-run/backend.log" 2>&1 &
BACKEND_PID=$!

for _ in {1..30}; do
  curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || { cat "$ROOT_DIR/.local-run/backend.log" >&2; exit 1; }
  sleep 1
done
curl -fsS http://127.0.0.1:8787/healthz >/dev/null

echo "Iniciando frontend en http://127.0.0.1:5173"
(cd "$WEB_DIR" && exec npm run dev -- --host 127.0.0.1 --port 5173) >"$ROOT_DIR/.local-run/frontend.log" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  kill "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT
wait "$FRONTEND_PID"
