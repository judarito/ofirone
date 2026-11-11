# Impuestos, monedas y configuración regional

Paquete independiente. El punto de integración es `httpapi.NewReferenceTaxHandler(reference_tax.NewPGStore(pool), fallback)` (fallback opcional).
Registrar las rutas `/api/v1/taxes`, `/api/v1/currencies`, `/api/v1/regional-settings` y `/api/v1/tax-info/variants/{variant_id}` dentro del middleware existente de autenticación y CORS. CORS debe permitir GET, HEAD, POST, PUT y DELETE. La ruta tax-info conserva la precedencia VARIANT > PRODUCT > CATEGORY > TENANT y devuelve tasa cero cuando no hay regla activa.

## Contrato

Cada colección ofrece GET paginado y POST. Cada `/{id}` ofrece GET, HEAD, PUT (reemplazo completo) y DELETE (desactivación lógica). PUT conserva el ID de la URL y exige el resto de los campos de negocio. `is_active` es true por defecto; false permite desactivar y true reactivar. No se borran registros ni referencias históricas.

- Impuesto: `{"code":"IVA19","name":"IVA 19%","rate":19,"is_inclusive":false,"is_active":true}`. Tasa obligatoria entre 0 y 100, hasta seis decimales, incluida tasa cero.
- Moneda: `{"code":"COP","name":"Peso colombiano","decimal_places":2,"is_active":true}`. ISO 4217 reconocido, mayúsculas; XXX no es una moneda operativa. Precisión de presentación entre 0 y 6. No incluye conversión cambiaria ni modificación de importes históricos.
- Perfil regional: `{"code":"default","name":"Colombia","currency_code":"COP","locale":"es-CO","timezone":"America/Bogota","is_active":true}`. Idioma BCP 47 válido y zona horaria reconocida. Permite varios perfiles; no cambia automáticamente la configuración de otros módulos.

La moneda debe existir en el mismo tenant; los perfiles activos requieren moneda activa. La moneda utilizada por un perfil activo no se puede desactivar. Los cambios de código se propagan a perfiles por FK. Los códigos son únicos por tenant; el mismo código puede existir en otro tenant.

GET `?limit=25&cursor=...` devuelve `{"items":[],"has_more":false,"next_cursor":"..."}`. Cursor opaco vinculado a colección y tenant, orden por código e ID; límite 1–100. El cursor permite recorrer conjuntos estables; las ediciones concurrentes del código pueden cambiar la posición de registros entre páginas. Se incluyen registros activos e inactivos para administración.

Errores: 400 JSON inválido/campos desconocidos; 401 sin principal verificado; 404 registro ajeno o inexistente; 409 código duplicado/moneda en uso; 422 validación o cursor inválido; 500 fallo interno saneado; 503 store sin configurar. El tenant se toma exclusivamente del contexto autenticado.

## Persistencia e integración pendiente

`taxes` usa el esquema existente de 0004; `tax_rules` se crea en la migración portable 0028. No ejecutar DDL en el arranque.

Cada operación PostgreSQL abre transacción con `set_config('app.tenant_id', ..., true)` y filtro explícito por tenant; no deja contexto en el pool. Las altas y modificaciones de perfiles bloquean la moneda para coordinarse con su desactivación.

Frontend: `taxesClient`, `currenciesClient`, `regionalSettingsClient` en `backendReferenceTaxClient.js`; métodos `list`, `get`, `create`, `update`, `deactivate`. Usa exclusivamente la sesión Go y admite AbortSignal. Las pantallas y su conexión quedan a cargo del integrador dentro de sus archivos asignados.

Validación local ejecutada: tests de dominio, contratos HTTP y cliente, además de `TestPostgresCRUDAndRLS` en PostgreSQL 16.15 local desechable con rol `NOSUPERUSER NOBYPASSRLS`. Verifica CRUD de los tres recursos, tasa cero, duplicados por tenant, aislamiento de lecturas/escrituras, keyset sin omisiones, moneda activa y limpieza del contexto en el pool. DEV/PROD no se usaron.

Para repetir la integración, definir `REFERENCE_TAX_TEST_DATABASE_URL` apuntando a una base **vacía y desechable** y ejecutar `go test ./internal/reference_tax -run TestPostgresCRUDAndRLS -v` desde backend-go. El test crea 0001/0004, el esquema del paquete, dos tenants sintéticos y un rol de ejecución; rechaza bases con `public.tenants` existente. Descartar la base y el rol al finalizar la prueba.
