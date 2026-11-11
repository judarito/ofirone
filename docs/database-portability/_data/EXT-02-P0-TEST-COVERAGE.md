# EXT-02 — Cobertura de pruebas P0

Fecha: 2026-11-09. Sin cambios de código de producción.

## Matriz de cobertura propuesta

| Área | Caso | Entrada | Resultado esperado | Objetivo |
|---|---|---|---|---|
| Aislamiento | Tenant cruzado en catálogo | contexto A + variant B | `23503`/`42501` | N9/N10; `validation-business-0022` |
| Aislamiento | Tenant cruzado en caja | venta B con sesión A | `23514`/`23503` | `validation-cash-0015` |
| Ventas | Idempotencia de venta | misma `idempotency_key` en tenant | `23505` en el segundo | `validation-business-0022` |
| Ventas | Idempotencia entre tenants | misma key, otro tenant | permitida | `validation-business-0022` |
| Paginación | Cursor repetido | repetir `after_*` de la última fila | misma página, sin duplicados | Faltante explícito; añadir a paginación |
| Paginación | Cursor inválido/última página | cursor fuera de rango | 0 filas | `validation-pagination` |
| Caja | Operación tras cierre | venta/pago con sesión cerrada | `23514` | `validation-cash-0015` |
| Caja | Sesión única concurrente | dos aperturas misma sede | `23505` | `validation-cash-0015` |
| CxC/CxP | Sobrepago | pago > saldo | `23514` | `validation-p1-guards` |
| Compras | Transición inválida | `received→draft` | `23514` | `validation-p1-lifecycle` |
| Jobs | Claim concurrente | dos workers, `SKIP LOCKED` | un solo claim por job | `validation-business-0022` (N18) |
| API | 401/403/409 | sin token, tenant ajeno, conflicto | códigos HTTP correctos | Faltante; tests Go de `httpapi` |
| Transacción | Fallo a mitad de venta | error en pago/línea | rollback total | Faltante; test Go/DB |
| Banco | Restore/rollback | fallo de migración | sin cambios parciales | `validation-K` (bloqueado) |

## Prioridad
1. Cursor repetido y transacción fallida.
2. 401/403/409 en `backend-go/internal/httpapi` (solo tests aislados, sin tocar lógica).
3. Claim concurrente real con dos conexiones.

## Evidencia existente
`validation-business-0022`, `validation-pagination`, `validation-cash-0015`, `validation-p1-lifecycle-0012`, `validation-p1-guards-proposal`.
