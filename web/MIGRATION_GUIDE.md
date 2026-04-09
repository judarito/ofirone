# Actualizar Base de Datos en Supabase

## Opción 1: Desde el SQL Editor de Supabase (Recomendado)

1. Abre tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Ve a **SQL Editor** en el menú lateral
3. Crea una nueva query
4. Copia y pega el contenido completo del archivo `full_migration.sql`
5. Haz clic en **Run** para ejecutar

## Opción 2: Usando CLI de Supabase

### Instalación de Supabase CLI

```powershell
# Instalar Supabase CLI (si no lo tienes)
npm install -g supabase
```

### Ejecutar migración

```powershell
# Inicializar Supabase en el proyecto (solo primera vez)
supabase init

# Conectar con tu proyecto
supabase link --project-ref mcufhthejdwonndvpmev

# Aplicar la migración
supabase db push --db-url "postgresql://postgres:[YOUR-PASSWORD]@db.mcufhthejdwonndvpmev.supabase.co:5432/postgres"
```

## Opción 3: Script Node.js para ejecutar la migración

Crea un archivo `run-migration.js`:

```javascript
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabaseUrl = 'https://mcufhthejdwonndvpmev.supabase.co'
const supabaseServiceKey = 'TU_SERVICE_ROLE_KEY' // Obtener de Settings > API

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
  try {
    const sql = readFileSync('./migrations/full_migration.sql', 'utf8')
    
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql })
    
    if (error) {
      console.error('Error ejecutando migración:', error)
    } else {
      console.log('✅ Migración completada exitosamente')
    }
  } catch (err) {
    console.error('Error:', err)
  }
}

runMigration()
```

## Notas Importantes

⚠️ **Backup**: Antes de ejecutar, asegúrate de hacer un backup de tu base de datos desde Supabase Dashboard > Database > Backups

⚠️ **Service Role Key**: Para la opción 3, necesitas el Service Role Key (Settings > API > service_role)

⚠️ **RLS**: El script incluye políticas de Row Level Security (RLS) para multi-tenancy

## Verificación

Después de ejecutar la migración, verifica que las tablas se crearon correctamente:

```sql
-- Ver todas las tablas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Verificar que la columna auth_user_id existe en users
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users';
```

## Rollback (si algo sale mal)

Si necesitas revertir:

```sql
-- Eliminar todas las tablas (CUIDADO!)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
```
