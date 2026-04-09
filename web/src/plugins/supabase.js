import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan las variables de entorno de Supabase. Verifica tu archivo .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
