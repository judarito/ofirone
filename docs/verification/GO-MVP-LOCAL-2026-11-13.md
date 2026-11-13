# Verificación local del MVP Go — 2026-11-13

## Resultado

La capa web quedó validada localmente contra el estado actual de la rama `dev`:

- `npm test -- --run`: **45 archivos, 357 pruebas PASS**.
- `npm run build`: **PASS**.
- `git diff --check`: **PASS**.
- El build conserva únicamente las advertencias conocidas de Vite: un módulo de sesión importado de forma estática y dinámica, y algunos chunks grandes.

## Backend

No se ejecutó `go test ./...` ni `go vet ./...` localmente porque el binario `go` no está instalado en este entorno. Esas validaciones permanecen cubiertas por:

- `.github/workflows/ci.yml` — pruebas y compilación de Go.
- `.github/workflows/deploy-mvp-dev.yml` — `go test`, `go vet` y `go build` antes de publicar.

## Alcance validado

La validación web cubre los adapters y servicios ya conectados al proveedor Go para autenticación, clientes, catálogo, compras MVP, inventario/Kardex, POS/ventas, CXC, maestros, reportes y alertas. No sustituye la prueba contra PostgreSQL real del flujo completo:

`compra → stock → Kardex → venta → descuento de stock`.

## Siguiente evidencia requerida

1. Ejecutar en CI `go test ./...`, `go vet ./...` y `go build ./cmd/api`.
2. Ejecutar una prueba E2E contra el despliegue de `dev` con un tenant de prueba.
3. Verificar que las solicitudes del alcance MVP no apunten a dominios de Supabase.
4. Guardar conteos antes/después: compra, `stock_balances`, `inventory_moves`, venta y stock final.

Este reporte no modifica datos ni secretos y no reemplaza la evidencia del otro LLM.
