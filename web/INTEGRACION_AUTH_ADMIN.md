# Integración con Supabase Auth Admin API

## Problema

Las funciones RPC en PostgreSQL no pueden crear usuarios directamente en Supabase Auth debido a limitaciones de seguridad. La creación de usuarios en `auth.users` requiere usar la **Admin API de Supabase**.

## Solución

Necesitas crear un **endpoint de API en tu backend** (Node.js, Python, etc.) que use el **Service Role Key** de Supabase para crear usuarios.

## Implementación

### Opción 1: Backend Node.js/Express

```javascript
// backend/routes/users.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Cliente con Service Role Key (tiene permisos de admin)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Endpoint para crear usuario
export async function createUser(req, res) {
  try {
    const { email, password, full_name, roleIds, is_active, tenant_id } = req.body

    // 1. Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirmar email
      user_metadata: {
        full_name
      }
    })

    if (authError) {
      return res.status(400).json({ error: authError.message })
    }

    // 2. Crear usuario en la tabla users
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_user_id: authData.user.id,
        tenant_id,
        email,
        full_name,
        is_active
      })
      .select()
      .single()

    if (userError) {
      // Si falla, eliminar usuario de Auth
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return res.status(400).json({ error: userError.message })
    }

    // 3. Asignar roles
    if (roleIds && roleIds.length > 0) {
      const userRoles = roleIds.map(roleId => ({
        user_id: userData.user_id,
        role_id: roleId
      }))

      const { error: rolesError } = await supabaseAdmin
        .from('user_roles')
        .insert(userRoles)

      if (rolesError) {
        console.error('Error al asignar roles:', rolesError)
      }
    }

    res.json({
      success: true,
      user: userData
    })

  } catch (error) {
    console.error('Error en createUser:', error)
    res.status(500).json({ error: error.message })
  }
}

// Endpoint para cambiar contraseña
export async function changePassword(req, res) {
  try {
    const { auth_user_id, new_password } = req.body

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      auth_user_id,
      { password: new_password }
    )

    if (error) {
      return res.status(400).json({ error: error.message })
    }

    res.json({ success: true })

  } catch (error) {
    console.error('Error en changePassword:', error)
    res.status(500).json({ error: error.message })
  }
}
```

### Opción 2: Supabase Edge Functions

```typescript
// supabase/functions/create-user/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

serve(async (req) => {
  try {
    const { email, password, full_name, roleIds, is_active, tenant_id } = await req.json()

    // 1. Crear usuario en Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    })

    if (authError) throw authError

    // 2. Crear en tabla users
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_user_id: authData.user.id,
        tenant_id,
        email,
        full_name,
        is_active
      })
      .select()
      .single()

    if (userError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      throw userError
    }

    // 3. Asignar roles
    if (roleIds?.length > 0) {
      const userRoles = roleIds.map(roleId => ({
        user_id: userData.user_id,
        role_id: roleId
      }))
      await supabaseAdmin.from('user_roles').insert(userRoles)
    }

    return new Response(JSON.stringify({ success: true, user: userData }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
```

### Opción 3: Actualizar RPC (Simulado para desarrollo)

Si estás en desarrollo local y no quieres configurar un backend, puedes modificar la función RPC para simular la creación:

```sql
-- SOLO PARA DESARROLLO - No usar en producción
CREATE OR REPLACE FUNCTION create_auth_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role_ids uuid[] DEFAULT '{}',
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id uuid;
  v_user_id uuid;
  v_tenant_id uuid;
  v_role_id uuid;
BEGIN
  -- Obtener tenant actual
  SELECT tenant_id INTO v_tenant_id
  FROM users WHERE auth_user_id = auth.uid();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el tenant';
  END IF;

  -- Verificar email único
  IF EXISTS (SELECT 1 FROM users WHERE tenant_id = v_tenant_id AND email = p_email) THEN
    RAISE EXCEPTION 'El email ya existe';
  END IF;

  -- SIMULACIÓN: Generar UUID temporal
  -- En producción, esto debe venir de Supabase Auth
  v_auth_user_id := gen_random_uuid();

  -- Insertar en tabla users
  INSERT INTO users (auth_user_id, tenant_id, email, full_name, is_active)
  VALUES (v_auth_user_id, v_tenant_id, p_email, p_full_name, p_is_active)
  RETURNING user_id INTO v_user_id;

  -- Asignar roles
  FOREACH v_role_id IN ARRAY p_role_ids
  LOOP
    INSERT INTO user_roles (user_id, role_id)
    VALUES (v_user_id, v_role_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'auth_user_id', v_auth_user_id,
    'note', 'DESARROLLO: Usuario creado sin contraseña real en Supabase Auth'
  );
END;
$$;
```

## Configuración del Frontend

Una vez tengas el endpoint, actualiza `users.service.js`:

```javascript
// Opción con backend propio
export async function createUser(userData) {
  const response = await fetch('https://tu-backend.com/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
    },
    body: JSON.stringify(userData)
  })
  
  if (!response.ok) {
    throw new Error(await response.text())
  }
  
  return response.json()
}

// Opción con Edge Function
export async function createUser(userData) {
  const { data, error } = await supabase.functions.invoke('create-user', {
    body: userData
  })
  
  if (error) throw error
  return data
}
```

## Variables de Entorno

Asegúrate de tener estas variables en tu backend:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # ¡NUNCA en el frontend!
```

**⚠️ IMPORTANTE:** El Service Role Key NUNCA debe estar en el frontend, solo en el backend.

## Política de Seguridad

Añade RLS para proteger la tabla users:

```sql
-- Solo admins pueden crear usuarios
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios solo ven su propio tenant"
ON users FOR SELECT
USING (
  tenant_id = (SELECT tenant_id FROM users WHERE auth_user_id = auth.uid())
);

CREATE POLICY "Solo admins pueden insertar usuarios"
ON users FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    INNER JOIN roles r ON r.role_id = ur.role_id
    INNER JOIN users u ON u.user_id = ur.user_id
    WHERE u.auth_user_id = auth.uid()
    AND r.name = 'ADMINISTRADOR'
  )
);
```

## Próximos Pasos

1. Decide qué opción usar (Backend Node.js, Edge Functions, o desarrollo simulado)
2. Implementa el endpoint correspondiente
3. Actualiza `users.service.js` con la integración
4. Prueba la creación de usuarios desde la UI
5. Configura las políticas RLS apropiadas
