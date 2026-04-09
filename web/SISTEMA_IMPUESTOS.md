# Sistema de Impuestos - Guía de Uso

## 📋 Descripción General

El sistema de impuestos de POSLite es un modelo **flexible y jerárquico** que permite configurar impuestos a diferentes niveles de especificidad.

## 🎯 Niveles de Configuración

### 1. **TENANT** (Por Defecto)
- Aplica a **todos** los productos del negocio
- Menor prioridad
- **Ejemplo**: IVA 19% para todo el inventario

### 2. **CATEGORY** (Categoría)
- Aplica a todos los productos de una categoría específica
- Sobrescribe la regla de TENANT
- **Ejemplo**: Exento 0% para productos de canasta básica

### 3. **PRODUCT** (Producto)
- Aplica a todas las variantes de un producto específico
- Sobrescribe reglas de CATEGORY y TENANT
- **Ejemplo**: IVA 5% para libros

### 4. **VARIANT** (Variante)
- Aplica solo a una variante específica
- **Mayor prioridad** - sobrescribe todas las demás
- **Ejemplo**: IVA 0% para libro digital, IVA 5% para libro físico

## 🚀 Configuración Paso a Paso

### Paso 1: Crear Impuestos

1. Ve a **Configuración → Impuestos**
2. Crea los impuestos que necesitas:
   - **IVA 19%**: Code: `IVA`, Rate: `0.19`
   - **IVA 5%**: Code: `IVA_REDUCIDO`, Rate: `0.05`
   - **Exento**: Code: `EXENTO`, Rate: `0.00`

### Paso 2: Crear Reglas de Impuestos

1. Ve a **Configuración → Reglas de Impuestos**
2. Crea la regla por defecto:
   - **Impuesto**: IVA 19%
   - **Alcance**: Tenant (Por defecto)
   - **Prioridad**: 0
   
3. Crea reglas específicas según necesites:

#### Ejemplo: Categoría "Alimentos Básicos" sin impuesto
- **Impuesto**: Exento 0%
- **Alcance**: Categoría
- **Categoría**: Alimentos Básicos
- **Prioridad**: 10

#### Ejemplo: Producto "Libro Digital" con IVA reducido
- **Impuesto**: IVA 5%
- **Alcance**: Producto
- **Producto**: Libro Digital
- **Prioridad**: 20

## 🔍 Funcionamiento Automático

El sistema usa la función `fn_get_tax_rate_for_variant()` que automáticamente:

1. Busca si hay una regla específica para la **VARIANT**
2. Si no, busca una regla para el **PRODUCT**
3. Si no, busca una regla para la **CATEGORY**
4. Si no, usa la regla del **TENANT**
5. Si no hay ninguna regla, retorna `0` (sin impuesto)

## 📊 Prioridad de Reglas

Cuando hay múltiples reglas del mismo nivel (ej: 2 reglas TENANT), el sistema usa:

1. **scope_weight**: VARIANT=4, PRODUCT=3, CATEGORY=2, TENANT=1
2. **priority**: El número más alto gana
3. Se toma la primera regla que cumpla

## ⚙️ Interfaz Visual

### Filtros Disponibles
- **Alcance**: Filtra por tipo de regla (TENANT, CATEGORY, PRODUCT, VARIANT)
- **Impuesto**: Filtra por impuesto específico
- **Estado**: Filtra por activas/inactivas

### Información Mostrada
- **Impuesto aplicado** y su tasa
- **Alcance** de la regla
- **Entidad asociada** (categoría, producto o variante)
- **Prioridad** de la regla
- **Estado** de la regla e impuesto

## 🔐 Permisos

Para gestionar impuestos y reglas necesitas el permiso:
- `SETTINGS.TAXES.MANAGE`

## 💡 Casos de Uso Comunes

### Caso 1: IVA 19% por defecto, excepto alimentos sin impuesto

```
1. Regla TENANT: IVA 19%, prioridad 0
2. Regla CATEGORY (Alimentos): Exento 0%, prioridad 10
```

### Caso 2: IVA diferenciado por producto

```
1. Regla TENANT: IVA 19%, prioridad 0
2. Regla PRODUCT (Libros): IVA 5%, prioridad 10
3. Regla PRODUCT (Medicamentos): Exento 0%, prioridad 10
```

### Caso 3: Impuesto por variante

```
1. Regla TENANT: IVA 19%, prioridad 0
2. Regla VARIANT (Libro Digital): IVA 0%, prioridad 20
3. Regla VARIANT (Libro Físico): IVA 5%, prioridad 20
```

## 📝 Notas Importantes

- Las reglas se aplican **automáticamente** al crear ventas o contratos Plan Separe
- Puedes **desactivar** una regla sin eliminarla
- Si desactivas un **impuesto**, todas sus reglas dejan de aplicarse
- La **prioridad** solo importa cuando hay múltiples reglas del mismo alcance

## 🔧 Seguridad (RLS)

El archivo de migración `RLS_TAX_RULES.sql` configura:
- Usuarios pueden **ver** impuestos y reglas de su tenant
- Solo usuarios con `SETTINGS.TAXES.MANAGE` pueden **crear/editar/eliminar**

## 📦 Archivos del Sistema

- **Frontend**:
  - `/src/views/TaxRules.vue` - Interfaz de reglas
  - `/src/services/taxRules.service.js` - Servicio de reglas
  - `/src/services/taxes.service.js` - Servicio de impuestos

- **Base de Datos**:
  - `migrations/InitDB.sql` - Tablas `taxes` y `tax_rules`
  - `migrations/SpVistasFN.sql` - Función `fn_get_tax_rate_for_variant()`
  - `migrations/RLS_TAX_RULES.sql` - Políticas de seguridad

## 🎓 Ejemplo Práctico Completo

**Escenario**: Tienda de retail con diferentes impuestos

1. **Crear Impuestos**:
   - IVA General 19%
   - IVA Reducido 5%
   - Exento 0%

2. **Crear Reglas**:
   - TENANT: IVA 19% (por defecto para todo)
   - CATEGORY "Alimentos": Exento 0%
   - CATEGORY "Libros": IVA 5%
   - PRODUCT "Whisky": IVA 19% + Impuesto al consumo

3. **Resultado**:
   - Una camisa → 19% (regla TENANT)
   - Arroz → 0% (regla CATEGORY Alimentos)
   - Novela → 5% (regla CATEGORY Libros)
   - Whisky → 19% (regla PRODUCT específica)

---

Para soporte adicional, consulta el código fuente o contacta al equipo de desarrollo.
