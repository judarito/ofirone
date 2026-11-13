# OfirOne · Plan para el MVP piloto

Base revisada: `dev`, 2026-11-13. Objetivo: que una tienda pueda operar un turno completo desde la web con la API Go y PostgreSQL, y que el equipo pueda demostrar que ventas, compras, inventario y caja concilian.

## Alcance y decisiones

- Reutilizar Vue y los módulos Go existentes. Separar los despliegues de frontend y API. El navegador consume la API HTTP.
- Usar PostgreSQL estándar con Neon como primer proveedor. Probar las migraciones contra PostgreSQL limpio antes de apuntar a Neon. Mantener una URL configurable en el servidor.
- Operar en línea, con una sede por empresa para el piloto. Conservar el aislamiento entre empresas. Habilitar administrador y cajero con permisos explícitos en el servidor.
- Entregar acceso, productos, ingreso manual de stock, caja, venta, comprobante, anulación autorizada y resumen del turno. Mantener clientes básicos si hacen falta para emitir el comprobante.
- Priorizar compras, inventario, ventas, clientes y CXC. Posponer manufactura, tienda pública, pasarela, IA, móvil, operación offline y reportes avanzados. Tratar el comprobante del piloto como interno y confirmar las necesidades de facturación antes de operar con ventas reales.
- Preparar un contenedor Go y desplegarlo en un entorno de prueba. Usar R2 y Queues cuando haya un caso de uso concreto. La confirmación del cobro, sus pagos y sus movimientos de stock pertenecen a la transacción de PostgreSQL.

## Fase 1 · Instalar, probar y responder correctamente

- [x] Sincronizar el lockfile web y comprobar `npm ci`, pruebas y build.
- [x] Agregar un job Go a CI para PR y pushes a `dev`, con pruebas y compilación de API y worker.
- [x] Corregir el alta de ventas para responder con el ID y el total que guardó el backend. Cubrirlo con una prueba HTTP.
- [ ] Inventariar los dos archivos con versión `0025` y cotejar sus checksums con los entornos existentes antes de ordenar las migraciones. Automatizar la inicialización y validar el esquema con un rol de aplicación separado del de migración.

Salida: CI verifica las dos aplicaciones y una base descartable se puede inicializar de manera repetible.

## Fase 2 · Integridad de venta, inventario y caja

- [ ] Calcular precios, impuestos y descuentos en servidor a partir del catálogo y de permisos explícitos. Acordar unidades monetarias y redondeo.
- [x] Mantener el mismo ID y la misma clave mientras se reintenta el cobro en el POS web abierto. Bloquear envíos simultáneos y ajustar el cambio sobre una copia de los pagos.
- [x] En la API, deduplicar por empresa y clave, devolver la venta original ante un reintento equivalente y responder HTTP 409 si cambia el cuerpo. Validado con PostgreSQL local descartable, dos solicitudes simultáneas y un reintento después del cierre de caja.
  - Aplicar la migración `0029_sale_request_fingerprint` antes de desplegar la API actualizada. Las claves creadas antes de esta migración se rechazan con 409 si se reenvían, porque no hay huella con la cual verificar el cuerpo.
  - Para repetir la prueba, desde `backend-go` apuntar `OFIRONE_SALE_RETRY_TEST_DATABASE_URL` a una base vacía en `127.0.0.1` y ejecutar `go test ./internal/sales -run TestSaleRetryPostgres -v`. El test carga los SQL `up` por nombre para preparar su base de prueba. La reconciliación del historial de migraciones de los entornos sigue siendo una tarea independiente.
- [ ] Recuperar el estado de un cobro pendiente después de recargar el navegador antes de iniciar otro intento.
- [ ] Resolver existencias según tipo de producto. Para artículos con stock, rechazar la venta si falta inventario. Si se requiere lote, resolverlo o exigirlo. Registrar venta, pago y movimiento dentro de una transacción.
- [ ] Verificar que la caja pertenezca a la empresa y sede, siga abierta y pueda ser operada por la sesión actual. Conciliar efectivo, transferencias y otros medios por separado.
- [ ] Anular con autorización, motivo, operador y movimientos inversos. Definir el tratamiento de un turno ya cerrado. Repetir una anulación debe ser seguro.
- [ ] Probar dos ventas simultáneas sobre la última unidad, reintento tras pérdida de respuesta, error en mitad de la transacción y anulación duplicada.

Salida: los saldos de stock y caja coinciden con sus movimientos y cada operación queda trazable.

## Fase 3 · Web independiente y permisos

- [ ] Mapear imports y llamadas de las pantallas MVP. Conectar sesión, productos, inventario, POS y caja a la API Go. Verificar inicio y operación con variables Supabase ausentes.
- [ ] Aplicar autorización por empresa, rol y recurso en cada operación. Evaluar cookies HttpOnly para la sesión web y, según la topología, CORS y protección CSRF.
- [ ] Probar que un usuario de otra empresa no puede listar, leer, modificar ni anular recursos ajenos. Comprobar que cajero y administrador tengan las acciones esperadas.
- [ ] Dejar el menú del piloto limitado a las pantallas operativas. Probar sesión expirada, pérdida de red y recuperación de la venta antes de volver a cobrar.

### Avance de migración Go — 2026-11-13

- [x] Compras MVP: crear/recibir compras en una transacción Go/PostgreSQL, generar lote y movimiento de inventario, listar con líneas enriquecidas y abrir detalle.
- [x] Compras MVP: exigir sede y proveedor antes de enviar; evitar el `422 INVALID_PURCHASE` por formularios incompletos.
- [x] Frontend de compras: el flujo Go no usa Supabase para crear, listar ni consultar el detalle cuando `VITE_DATA_PROVIDER=go`.
- [x] Inventario MVP: stock y Kardex consumen los endpoints Go; el stock se calcula desde lotes y los movimientos desde `inventory_moves`.
- [ ] Verificación E2E pendiente: compra → stock → Kardex → venta, contra el despliegue actualizado de Render/Cloudflare.

Salida: el navegador completa un turno usando la API Go y sin tráfico hacia Supabase en el alcance del piloto.

## Fase 4 · Datos, despliegue y piloto

- [ ] Desplegar web y contenedor Go en un entorno aislado con PostgreSQL de prueba. Comprobar HTTPS, secretos, readiness, logs y versión de esquema. Validar el destino de despliegue y el costo del contenedor según el horario de operación.
- [ ] Preparar un import repetible de empresas, productos, usuarios y saldos iniciales si hay datos existentes. Ensayar la importación y conciliar conteos, precios y existencias. Definir alta o restablecimiento de credenciales.
- [ ] Ejecutar en navegador con dos empresas: acceso → producto → ingreso → apertura → venta → comprobante → anulación → cierre. Registrar evidencia de saldos, permisos y persistencia tras recargar.
- [ ] Pilotear con una tienda y acordar ventana de corte, responsable de conciliación y procedimiento de reversión. Si ya se registraron ventas en el piloto, exportarlas y conciliarlas antes de regresar al sistema anterior.
- [ ] Incorporar R2 privado para archivos si el piloto los necesita. Para trabajos asíncronos, persistir el evento junto con la operación, reintentar su envío y deduplicar en el consumidor. Revisar fallos y reintentos antes de habilitar correos o exportaciones automáticas.

Salida: un turno completo conciliado, datos restaurables y una reversión ensayada.
