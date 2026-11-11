# EXT-15 — Concurrencia

Fecha: 2026-11-09. Base desechable, dos conexiones concurrentes.

| Prueba | Resultado |
|---|---|
| Dos ventas con la misma `idempotency_key` | una OK, una `23505` — **PASS** |
| Dos consumidores del mismo refresh token | consumos `1` y `0` — **PASS** |
| Locks del runner bajo concurrencia | **BLOQ** (runner no aplica desde vacío; EXT-07) |

Evidencia: [`validation-EXT-15-concurrency-2026-11-09.txt`](validation-EXT-15-concurrency-2026-11-09.txt). No se modificó lógica de producción.
