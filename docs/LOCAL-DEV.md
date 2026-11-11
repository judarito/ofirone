# Desarrollo local reproducible

Usa un único comando para evitar mezclar binarios, flags o procesos antiguos:

```bash
./tools/dev/start-local.sh
```

El script detiene únicamente los procesos que ocupan los puertos `8787` y `5173`, recompila el backend desde `backend-go/cmd/api`, verifica `/healthz` y arranca Vite con la configuración de `web/.env.local`.

Si `go` no está en el PATH, el script se detiene deliberadamente; no ejecuta un binario viejo. Se puede indicar una instalación concreta:

```bash
GO_BIN=/ruta/a/go ./tools/dev/start-local.sh
```

Los logs quedan en `.local-run/backend.log` y `.local-run/frontend.log`.
