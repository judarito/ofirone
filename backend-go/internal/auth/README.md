# Autenticación portable

Puertos, contexto y middleware con biblioteca estándar. Verificación JWT con `github.com/golang-jwt/jwt/v5` v5.3.1.

- `TokenVerifier.Verify(ctx, token)` recibe el contexto original y un Bearer token opaco. El adaptador es responsable de verificar validez, vencimiento, emisor, audiencia, revocación y pertenencia al tenant según su proveedor. No implementar criptografía JWT manualmente.
- `Principal` contiene `Identity`, `Tenant` y permisos del tenant verificado. Identificadores tipados, sin imponer UUID ni formato de proveedor. Un principal sin identidad o tenant se rechaza. Rutas de plataforma sin tenant requieren un contrato separado explícito.
- `WithPrincipal` y `PrincipalFromContext` copian permisos; `IdentityFromContext`, `TenantFromContext` y `HasPermission` permiten consumirlos. Los permisos se comparan exactamente; no hay privilegios por ausencia de perfil ni bypass implícito.
- `NewMiddleware(verifier)` devuelve un middleware obligatorio o error de configuración. Inyectar un adaptador real o mock; el constructor recibe una implementación no nula. Aplicarlo únicamente a rutas protegidas.

```go
middleware, err := auth.NewMiddleware(verifier)
if err != nil {
    return err
}
protected := middleware(handler)
```

Solo acepta un encabezado `Authorization: Bearer <token>` (máximo 8192 bytes), con esquema sin distinción de mayúsculas, un espacio y alfabeto b64token. No toma tokens de cookies/URL ni autoridad de encabezados de tenant. La política de espacios es deliberadamente estricta.

Credenciales ausentes/malformadas y errores que envuelven `ErrInvalidToken` o `ErrExpiredToken` producen 401 y `WWW-Authenticate`. Otros errores del verificador o un principal incompleto producen 503. Ningún fallo llama al handler. Las respuestas son JSON sin detalles internos y `Cache-Control: no-store`; HEAD no incluye cuerpo.

El envelope mantiene `code`, `message`, `details`, `request_id`, `retryable`. `request_id` toma el encabezado **de respuesta** `X-Request-ID` generado por el middleware HTTP exterior; queda vacío si no se instala ese middleware. El paquete no importa infraestructura HTTP del proyecto.

La autenticación establece contexto; los handlers/casos de uso deben comprobar permisos y los repositorios deben aplicar aislamiento por tenant. Este paquete no implementa login, emisión de tokens, selección de tenant, persistencia, ni protección SQL.

## Verificador JWT HMAC

`NewJWTVerifier` implementa `TokenVerifier` y recibe configuración explícita. La clave debe proceder de la configuración segura del despliegue, con bytes aleatorios: mínimo 32 para HS256, 48 para HS384 o 64 para HS512. El constructor copia la clave; modificar el slice original no cambia el verificador. Solo se acepta el algoritmo exacto configurado.

```go
verifier, err := auth.NewJWTVerifier(auth.JWTVerifierConfig{
    Issuer:    "https://identity.example.test",
    Audience:  "ofirone-api",
    Algorithm: "HS256",
    HMACKey:   injectedKey,
})
if err != nil {
    return err
}
middleware, err := auth.NewMiddleware(verifier)
```

La biblioteca valida firma, algoritmo, `iss`, `aud`, `exp` obligatorio y `nbf` cuando está presente, sin tolerancia temporal adicional. `aud` puede ser un string o una lista que incluya la audiencia configurada. Se rechazan tokens sin firma, claves equivocadas y tokens mayores a 8192 bytes.

Los claims `identity_id` y `tenant_id` deben ser strings no vacíos sin espacios ni caracteres de control, sin imponer UUID. `permissions` debe ser una lista explícita de strings no vacíos sin espacios ni caracteres de control; `[]` es válido y no concede permisos. Claims ausentes, `null` o tipos incorrectos se rechazan. Los permisos conservan coincidencia exacta, sin expansión de comodines.

Solo después de verificar todos los claims se devuelve un `Principal`. Los fallos devuelven `ErrInvalidToken`; un token vencido también satisface `errors.Is(err, ErrExpiredToken)`. No se exponen claims, claves ni errores internos de la biblioteca. El contexto cancelado conserva su error. El verificador admite uso concurrente y no consulta proveedores externos.

La autoridad de tenant y permisos procede del emisor confiable. Revocación de sesiones y cambios posteriores de membresía/permisos requieren integración adicional; este verificador solo comprueba el token firmado y su vigencia. No se conecta automáticamente a las rutas de la API.

Verificación desde `backend-go/`:

```bash
go test -race ./internal/auth
go vet ./internal/auth
```
