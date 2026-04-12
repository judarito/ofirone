#!/usr/bin/env sh
set -eu

TARGET="node_modules/llama.rn/android/build.gradle"

if [ ! -f "$TARGET" ]; then
  echo "[postinstall] llama.rn no instalado, se omite parche."
  exit 0
fi

TMP_FILE="$(mktemp)"
TMP_STAGE="$(mktemp)"

cleanup() {
  rm -f "$TMP_FILE" "$TMP_STAGE"
}

trap cleanup EXIT INT TERM

cp "$TARGET" "$TMP_FILE"

# Evitamos `sed -i` para no depender de variaciones del entorno del runner.
# EAS puede fallar de forma poco clara en `Install dependencies` si este paso
# no es portable.
sed 's/return rootProject.hasProperty("newArchEnabled") && rootProject.getProperty("newArchEnabled") == "true"/return rootProject.hasProperty("newArchEnabled") \&\& rootProject.getProperty("newArchEnabled").toString().toBoolean()/' "$TMP_FILE" > "$TMP_STAGE"
mv "$TMP_STAGE" "$TMP_FILE"

# Fix 2: always apply RN Gradle plugin so NativeRNLlamaSpec is generated
# even when the app builds with -PnewArchEnabled=false.
sed 's/^if (isNewArchitectureEnabled()) {$/if (true) {/g' "$TMP_FILE" > "$TMP_STAGE"
mv "$TMP_STAGE" "$TMP_FILE"

if cmp -s "$TARGET" "$TMP_FILE"; then
  echo "[postinstall] no se encontraron cambios pendientes en llama.rn."
  exit 0
fi

mv "$TMP_FILE" "$TARGET"
echo "[postinstall] parche llama.rn aplicado correctamente."
