# Manual de Usuario OfirOne

Fecha de actualizacion: 2026-03-18

## Objetivo

Este manual esta pensado para usuarios operativos y administradores de tenant. Su meta no es explicar cada boton del sistema, sino ayudar a que el equipo pueda ejecutar sus procesos criticos con seguridad:

- vender
- comprar
- operar caja
- cargar inventario
- activar contabilidad

## Donde consultar la ayuda

La ayuda principal vive dentro de la app en la ruta `/help`.

Desde ahi el usuario encuentra:

- guia de `Primeros pasos`
- guias operativas por proceso
- FAQs de errores comunes
- checklists interactivos con progreso guardado localmente
- accesos directos a los modulos donde se ejecuta cada paso

## Rutas de ayuda disponibles

### 1. Primeros pasos

Pensado para administradores de tenant que necesitan dejar la empresa lista para operar en poco tiempo.

Incluye:

- configuracion basica de empresa
- catalogo inicial
- caja y sesion
- stock inicial
- primera venta de prueba

### 2. Venta

Guia para cajeros y administradores.

Incluye:

- busqueda de productos
- cliente cuando aplica
- pagos
- cobro
- validacion posterior

### 3. Compra

Guia para compras, administracion y bodega.

Incluye:

- proveedor
- sede de recepcion
- lineas de compra
- costos
- verificacion en inventario

### 4. Caja

Guia operativa para apertura, uso y cierre de caja.

Incluye:

- apertura de sesion
- operacion diaria
- arqueo
- cierre
- control de sesiones vencidas
- parametro de horas maximas por sesion

Importante:

- las cajas no operan solo por existir; operan a traves de sesiones
- cada sesion de caja debe abrirse al iniciar el turno y cerrarse al finalizarlo
- en Configuracion de Empresa existe un parametro del tenant que define cuantas horas maximo puede estar abierta una sesion de caja antes de marcarse como vencida

### 5. Inventario

Guia para control de stock y movimientos.

Incluye:

- productos y variantes
- compras
- ajustes
- traslados
- cargue masivo
- validacion en kardex

### 6. Contabilidad

Guia para adopcion gradual del modulo contable.

Incluye:

- activacion
- plan de cuentas
- automatizacion
- cola contable
- validacion de reportes

## Enfoque de uso recomendado

1. El administrador entra primero a `Primeros pasos`.
2. El equipo operativo usa las guias del modulo que realmente necesita.
3. Ante un bloqueo, se consulta primero la FAQ relacionada antes de escalar soporte.

## Ayuda contextual dentro de la app

Los modulos criticos muestran una tarjeta de ayuda rapida:

- `POS`
- `Compras`
- `Inventario`
- `Contabilidad`

Cada tarjeta enlaza al articulo correcto y a una FAQ relacionada.

## Criterios de contenido

Toda guia de usuario debe incluir:

- para que sirve el proceso
- que se necesita antes de empezar
- pasos cortos y verificables
- resultado esperado
- errores comunes
- acceso directo al modulo donde se ejecuta

## Mantenimiento

- El contenido funcional del manual debe mantenerse alineado con `src/content/helpCenter.js`.
- Si cambia el flujo operativo de un modulo critico, se debe actualizar tambien la ayuda contextual y la guia del centro de ayuda.
