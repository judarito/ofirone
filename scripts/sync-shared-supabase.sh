#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARED_DIR="$ROOT_DIR/shared/supabase"
MIGRATIONS_MANIFEST="$SHARED_DIR/shared-migrations.txt"
FUNCTIONS_MANIFEST="$SHARED_DIR/shared-functions.txt"
MODE="${1:-link}"
TARGETS=(web mobile)
STATUS=0

if [[ ! -f "$MIGRATIONS_MANIFEST" ]]; then
  echo "No existe el manifiesto de migraciones compartidas: $MIGRATIONS_MANIFEST" >&2
  exit 1
fi

if [[ ! -f "$FUNCTIONS_MANIFEST" ]]; then
  echo "No existe el manifiesto de funciones compartidas: $FUNCTIONS_MANIFEST" >&2
  exit 1
fi

if [[ "$MODE" != "sync" && "$MODE" != "link" && "$MODE" != "check" ]]; then
  echo "Uso: scripts/sync-shared-supabase.sh [link|sync|check]" >&2
  exit 1
fi

sync_manifest() {
  local manifest="$1"
  local source_kind="$2"
  local target_kind="$3"
  local target="$4"

  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -z "$relative_path" ]] && continue

    local source_path="$SHARED_DIR/$source_kind/$relative_path"
    local target_path="$ROOT_DIR/$target/$target_kind/$relative_path"

    if [[ ! -f "$source_path" ]]; then
      echo "Falta archivo fuente compartido: $source_path" >&2
      STATUS=1
      continue
    fi

    if [[ "$MODE" == "sync" ]]; then
      mkdir -p "$(dirname "$target_path")"
      cp "$source_path" "$target_path"
      echo "SYNC  $target/$target_kind/$relative_path"
      continue
    fi

    if [[ "$MODE" == "link" ]]; then
      mkdir -p "$(dirname "$target_path")"
      rm -f "$target_path"
      local relative_source
      relative_source="$(realpath --relative-to="$(dirname "$target_path")" "$source_path")"
      ln -s "$relative_source" "$target_path"
      echo "LINK  $target/$target_kind/$relative_path -> $relative_source"
      continue
    fi

    if [[ ! -f "$target_path" ]]; then
      echo "MISS  $target/$target_kind/$relative_path"
      STATUS=1
      continue
    fi

    if cmp -s "$source_path" "$target_path"; then
      echo "OK    $target/$target_kind/$relative_path"
    else
      echo "DIFF  $target/$target_kind/$relative_path"
      STATUS=1
    fi
  done < "$manifest"
}

for target in "${TARGETS[@]}"; do
  sync_manifest "$MIGRATIONS_MANIFEST" "migrations" "migrations" "$target"
  sync_manifest "$FUNCTIONS_MANIFEST" "functions" "supabase/functions" "$target"
done

exit "$STATUS"
