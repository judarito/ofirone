import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Supabase es legado y opcional. En el modo Go no debe impedir que la app
// arranque ni crear un cliente que intente conectarse en segundo plano.
const disabledSupabase = {
  auth: {
    async getSession() { return { data: { session: null }, error: null } },
    async getUser() { return { data: { user: null }, error: null } },
    async refreshSession() { return { data: { session: null }, error: new Error('Supabase deshabilitado') } },
    async signInWithPassword() { return { data: null, error: new Error('Supabase deshabilitado') } },
    async signUp() { return { data: null, error: new Error('Supabase deshabilitado') } },
    async signOut() { return { error: null } },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
  },
  from() {
    throw new Error('Supabase deshabilitado; usa la API Go')
  },
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : disabledSupabase

// Composable para usar Supabase en componentes
export const useSupabase = () => {
  return {
    supabase,
    // Métodos de autenticación
    auth: {
      signUp: async (email, password) => {
        return await supabase.auth.signUp({ email, password })
      },
      signIn: async (email, password) => {
        return await supabase.auth.signInWithPassword({ email, password })
      },
      signOut: async () => {
        return await supabase.auth.signOut()
      },
      getUser: async () => {
        return await supabase.auth.getUser()
      },
      getSession: async () => {
        return await supabase.auth.getSession()
      },
      onAuthStateChange: (callback) => {
        return supabase.auth.onAuthStateChange(callback)
      }
    }
  }
}
