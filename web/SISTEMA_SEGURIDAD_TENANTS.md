# 🔐 Sistema de Seguridad para Gestión de Tenants

## Problema
La gestión de tenants es una funcionalidad **crítica** que permite crear nuevos negocios completos en el sistema. Si cualquier usuario pudiera acceder, sería un riesgo de seguridad grave.

## Solución Implementada: Super Admin

### 🎯 Concepto de Super Admin
**Super Admin** = Usuario especial que:
- ✅ Está autenticado en `auth.users` (Supabase Auth)
- ❌ **NO** tiene registro en tabla `users` 
- ❌ **NO** tiene `tenant_id` (no pertenece a ningún negocio)
- 🔑 Puede crear y gestionar todos los tenants del sistema

## 🏗️ Arquitectura de Seguridad

### 1. Frontend - Composable `useSuperAdmin.js`
```javascript
// Detecta automáticamente si el usuario es Super Admin
const { canManageTenants, isSuperAdmin } = useSuperAdmin()

// Solo Super Admins verán el menú de gestión
canManageTenants.value // true/false
```

### 2. Frontend - Menú Dinámico
```javascript
// En App.vue - Solo aparece para Super Admins
{ 
  title: 'Gestión de Tenants', 
  permissions: ['SUPER_ADMIN_ONLY'] // Marcador especial
}
```

### 3. Frontend - Router Guard
```javascript
// En router/index.js
{
  path: '/tenant-management',
  meta: { requiresSuperAdmin: true } // Guard especial
}
```

### 4. Backend - Stored Procedure Protegido
```sql
-- En SECURE_TENANT_MANAGEMENT.sql
create function fn_is_super_admin() -- Validación a nivel DB
create function fn_create_tenant() -- Solo Super Admins pueden ejecutar
```

## 🛡️ Capas de Protección

### **Capa 1: Menú**
- Solo Super Admins ven "Gestión de Tenants" en navegación
- Filtro automático basado en `canManageTenants`

### **Capa 2: Router** 
- Guard valida `requiresSuperAdmin` antes de cargar componente
- Redirección automática si no es Super Admin

### **Capa 3: Componente**
- Doble validación en `TenantManagement.vue`
- Mensaje de acceso restringido si logran llegar

### **Capa 4: Base de Datos**
- `fn_create_tenant()` valida con `fn_is_super_admin()`
- Imposible crear tenants sin ser Super Admin

## 🔧 Implementación Técnica

### Archivos Creados/Modificados:

1. **`/composables/useSuperAdmin.js`** - Lógica de detección
2. **`/utils/superAdmin.js`** - Helpers para router 
3. **`/App.vue`** - Filtro de menú
4. **`/router/index.js`** - Guard de rutas
5. **`/views/TenantManagement.vue`** - Validación en componente
6. **`/migrations/SECURE_TENANT_MANAGEMENT.sql`** - Protección DB

## 👤 Cómo Crear Super Admin

### Opción 1: Usuario Existente
1. Usuario se registra normalmente
2. **Eliminar** su registro de tabla `users`:
   ```sql
   DELETE FROM users WHERE user_id = 'uuid-del-usuario';
   ```
3. Ahora es Super Admin (auth sin tenant)

### Opción 2: Usuario Nuevo  
1. Crear usuario en Supabase Auth Panel
2. **NO** crear registro en tabla `users`
3. Al loguearse será automáticamente Super Admin

### Opción 3: Email Específico (Opcional)
```javascript
// En useSuperAdmin.js - Descomentar:
const allowedSuperAdminEmails = [
  'admin@miempresa.com',
  'superadmin@sistema.com'
]
```

## 🔍 Cómo Verificar

### Frontend - Check Status:
```javascript
const { canManageTenants, superAdminInfo } = useSuperAdmin()
console.log('Es Super Admin?', canManageTenants.value)
console.log('Info:', superAdminInfo.value)
```

### Backend - Check en SQL:
```sql
SELECT fn_is_super_admin(); -- true/false
SELECT auth.uid(), auth.email(); -- Info usuario actual
```

## 🚨 Estados de Usuario

| Escenario | auth.users | users table | tenant_id | Tipo | Acceso Tenants |
|-----------|------------|-------------|-----------|------|----------------|
| **Super Admin** | ✅ | ❌ | ❌ | Global | ✅ SÍ |
| **Admin Tenant** | ✅ | ✅ | ✅ | Local | ❌ NO |
| **Cajero** | ✅ | ✅ | ✅ | Local | ❌ NO |
| **Sin Auth** | ❌ | ❌ | ❌ | Guest | ❌ NO |

## 📋 Pasos para Usar

### 1. Ejecutar Migraciones:
```sql
-- En Supabase SQL Editor:
-- Ejecutar: migrations/CreateTenantSP.sql
-- Ejecutar: migrations/SECURE_TENANT_MANAGEMENT.sql
```

### 2. Crear Super Admin:
```sql
-- Eliminar usuario de tabla users (mantener en auth)
DELETE FROM users WHERE email = 'tu-admin@email.com';
```

### 3. Acceder al Sistema:
- Login con email de Super Admin
- Ir a **Configuración** → **Gestión de Tenants**
- Solo Super Admins verán esta opción

## ⚡ Ventajas del Sistema

- ✅ **Seguridad Multi-Capa**: 4 niveles de protección
- ✅ **Detección Automática**: Sin configuración manual
- ✅ **Escalable**: Fácil agregar más Super Admins  
- ✅ **Transparente**: UI adapta automáticamente
- ✅ **Robusto**: Protección hasta nivel de DB
- ✅ **Auditable**: Logs de seguridad en cada acción

## 🔄 Modo Desarrollo

En desarrollo, el sistema usa UUIDs temporales en lugar de crear usuarios Auth reales (para evitar límites de email). El control de Super Admin sigue funcionando igual.

---

**¡Sistema de Seguridad Completo Implementado!** 🛡️