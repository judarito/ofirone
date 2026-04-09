# Sistema de Roles y Permisos

## Estructura

### 1. Tablas de Base de Datos

- **permissions**: Catálogo global de permisos
- **roles**: Roles por tenant
- **role_permissions**: Asignación de permisos a roles
- **user_roles**: Asignación de roles a usuarios

### 2. Inicialización

Ejecutar en orden:
1. `InitDB.sql` - Crea las tablas base
2. `InitPermissions.sql` - Inserta permisos y función de inicialización

Para inicializar roles en un tenant:
```sql
select fn_init_tenant_roles('tu-tenant-id-aqui');
```

Esto crea 3 roles base:
- **ADMINISTRADOR**: Todos los permisos
- **CAJERO**: Ventas, pagos, caja, clientes básicos
- **INVENTARIO**: Inventario, catálogo, reportes inventario

## Uso en el Frontend

### 1. Verificar Permisos en Componentes

```vue
<script setup>
import { useAuth } from '@/composables/useAuth'

const { hasPermission, hasAnyPermission, hasRole } = useAuth()

// Verificar un permiso
const canCreateSale = hasPermission('SALES.CREATE')

// Verificar cualquiera de varios permisos
const canManageCash = hasAnyPermission(['CASH.SESSION.OPEN', 'CASH.SESSION.CLOSE'])

// Verificar rol
const isAdmin = hasRole('ADMINISTRADOR')
</script>

<template>
  <div>
    <v-btn v-if="canCreateSale" @click="createSale">Nueva Venta</v-btn>
    <v-btn v-if="isAdmin" @click="openSettings">Configuración</v-btn>
  </div>
</template>
```

### 2. Ocultar Elementos del Menú

```vue
<script setup>
import { useAuth } from '@/composables/useAuth'

const { hasPermission, hasAnyPermission } = useAuth()

const menuItems = computed(() => [
  {
    title: 'Ventas',
    icon: 'mdi-cash-register',
    route: '/pos',
    visible: hasPermission('SALES.CREATE')
  },
  {
    title: 'Inventario',
    icon: 'mdi-package-variant',
    route: '/inventory',
    visible: hasAnyPermission(['INVENTORY.VIEW', 'INVENTORY.ADJUST'])
  },
  {
    title: 'Configuración',
    icon: 'mdi-cog',
    route: '/settings',
    visible: hasPermission('SETTINGS.TENANT.MANAGE')
  }
].filter(item => item.visible))
</script>
```

### 3. Proteger Rutas

```javascript
// En router/index.js
{
  path: '/inventory',
  component: Inventory,
  meta: { 
    requiresAuth: true,
    requiredPermission: 'INVENTORY.VIEW'
  }
}

// En el navigation guard
router.beforeEach((to, from, next) => {
  if (to.meta.requiredPermission) {
    const { hasPermission } = useAuth()
    if (!hasPermission(to.meta.requiredPermission)) {
      next('/unauthorized')
      return
    }
  }
  next()
})
```

### 4. Verificar en el Backend

Los permisos también deben verificarse en los Stored Procedures:

```sql
create or replace function sp_create_sale(...)
returns uuid
language plpgsql
security definer
as $$
declare
  v_has_permission boolean;
begin
  -- Verificar permiso
  select exists(
    select 1
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.permission_id = rp.permission_id
    where ur.user_id = p_created_by
      and p.code = 'SALES.CREATE'
  ) into v_has_permission;

  if not v_has_permission then
    raise exception 'No tiene permiso para crear ventas';
  end if;

  -- Resto de la lógica...
end;
$$;
```

## Permisos Disponibles

### Ventas
- `SALES.CREATE` - Crear venta
- `SALES.VOID` - Anular venta
- `SALES.RETURN` - Registrar devolución
- `SALES.VIEW` - Ver ventas
- `SALES.DISCOUNT.LINE` - Descuento por línea
- `SALES.DISCOUNT.TOTAL` - Descuento total

### Caja
- `CASH.SESSION.OPEN` - Abrir caja
- `CASH.SESSION.CLOSE` - Cerrar caja
- `CASH.MOVEMENT.INCOME` - Registrar ingreso
- `CASH.MOVEMENT.EXPENSE` - Registrar gasto
- `CASH.REGISTER.MANAGE` - Gestionar cajas registradoras

### Inventario
- `INVENTORY.VIEW` - Ver stock/kardex
- `INVENTORY.ADJUST` - Ajustar inventario
- `INVENTORY.TRANSFER` - Trasladar inventario
- `INVENTORY.PURCHASE` - Ingreso por compra

### Catálogo
- `CATALOG.PRODUCT.CREATE` - Crear producto
- `CATALOG.PRODUCT.UPDATE` - Editar producto
- `CATALOG.PRODUCT.DELETE` - Eliminar producto
- `CATALOG.CATEGORY.MANAGE` - Gestionar categorías

### Clientes
- `CUSTOMERS.CREATE` - Crear cliente
- `CUSTOMERS.UPDATE` - Editar cliente
- `CUSTOMERS.VIEW` - Ver clientes
- `CUSTOMERS.DELETE` - Eliminar cliente

### Reportes
- `REPORTS.SALES.VIEW` - Ver reportes de ventas
- `REPORTS.INVENTORY.VIEW` - Ver reportes de inventario
- `REPORTS.CASH.VIEW` - Ver reportes de caja

### Configuración
- `SETTINGS.TENANT.MANAGE` - Configuración empresa
- `SETTINGS.LOCATIONS.MANAGE` - Gestionar sedes
- `SETTINGS.TAXES.MANAGE` - Gestionar impuestos
- `SECURITY.USERS.MANAGE` - Gestionar usuarios
- `SECURITY.ROLES.MANAGE` - Gestionar roles

## Mejores Prácticas

1. **Principio de mínimo privilegio**: Asignar solo los permisos necesarios
2. **Verificación en múltiples capas**: Frontend (UX) + Backend (seguridad)
3. **Roles predefinidos**: Usar roles base y personalizarlos según necesidad
4. **Auditoría**: Registrar cambios en roles y permisos
5. **Testing**: Probar con usuarios de diferentes roles
