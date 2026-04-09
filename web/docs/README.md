# Documentación del Sistema

Este directorio contiene la documentación del sistema OfirOne.

## 📘 Manual de Usuario

El manual de usuario completo está disponible en dos ubicaciones:

1. **Versión Web Estática:**
   - Ubicación: `/public/MANUAL_USUARIO.html`
   - Uso: referencia estática y exportación a PDF
   - Se abre en una nueva pestaña del navegador

2. **Versión de Desarrollo:**
   - Ubicación: `/docs/MANUAL_USUARIO.html`
   - Para desarrollo y edición

3. **Centro de ayuda integrado (principal para usuarios):**
   - Ruta dentro de la app: `/help`
   - Acceso: desde la barra superior de la aplicación
   - Incluye guías por proceso, FAQs y ayuda contextual

## 🎯 Uso

### Para Usuarios
- Iniciar sesión en la aplicación
- Abrir el centro de ayuda desde la barra superior o navegar a `/help`
- Usar el manual HTML solo cuando necesite una versión extensa o exportable

### Para Desarrolladores
Si necesitas editar el manual:

1. Editar el archivo en `/docs/MANUAL_USUARIO.html`
2. Copiar los cambios a `/public/MANUAL_USUARIO.html`:
   ```powershell
   Copy-Item "docs\MANUAL_USUARIO.html" "public\MANUAL_USUARIO.html"
   ```

## 📄 Convertir a PDF

Para generar una versión PDF del manual:

1. Abrir `public/MANUAL_USUARIO.html` en Chrome/Edge
2. Presionar `Ctrl + P` (Imprimir)
3. Seleccionar "Guardar como PDF"
4. Ajustar márgenes a "Mínimo"
5. Guardar el archivo

## 📝 Contenido del Manual

El manual incluye documentación completa de:

- ✅ Introducción y primeros pasos
- ⚙️ Configuración inicial
- 📍 Ubicaciones y cajas registradoras
- 📂 Catálogos base
- 📦 Gestión de productos
- 📊 Control de inventario
- 🏭 Manufactura (BOMs + Producción)
- 🛒 Compras
- 💵 Punto de venta
- 💎 Plan Separe
- 💼 Sesiones de caja
- 📊 Reportes
