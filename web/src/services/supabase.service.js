import { supabase } from '@/plugins/supabase'
import router from '@/router'

class SupabaseService {
  constructor() {
    this.client = supabase
    this._sessionValid = false
    this._sessionCheckedAt = 0
    this._pendingValidation = null
    this._lastSession = null
  }

  // Validar sesión antes de operaciones (con caché de 30s y lock de concurrencia)
  async validateSession() {
    const session = await this.getValidSession()
    return !!session
  }

  async getValidSession(options = {}) {
    const forceRefresh = options.forceRefresh === true
    const minValiditySeconds = Math.max(0, Number(options.minValiditySeconds || 0))
    const redirectOnFail = options.redirectOnFail !== false
    const now = Date.now()

    if (!forceRefresh && this._sessionValid && this._lastSession && (now - this._sessionCheckedAt) < 30000) {
      const expiresAt = Number(this._lastSession.expires_at || 0)
      const nowSec = Math.floor(Date.now() / 1000)
      if ((expiresAt - nowSec) > minValiditySeconds) {
        return this._lastSession
      }
    }

    if (this._pendingValidation) {
      return this._pendingValidation
    }

    this._pendingValidation = this._doGetValidSession({ redirectOnFail, minValiditySeconds })
    try {
      return await this._pendingValidation
    } finally {
      this._pendingValidation = null
    }
  }

  async _doGetValidSession(options = {}) {
    const redirectOnFail = options.redirectOnFail !== false
    const minValiditySeconds = Math.max(0, Number(options.minValiditySeconds || 0))

    try {
      const { data: { session } } = await this.client.auth.getSession()

      if (!session) {
        this._sessionValid = false
        this._lastSession = null
        if (redirectOnFail) this._redirectToLogin()
        return null
      }

      const expiresAt = session.expires_at || 0
      const nowSec = Math.floor(Date.now() / 1000)
      let nextSession = session

      if ((expiresAt - nowSec) <= minValiditySeconds) {
        const { data, error } = await this.client.auth.refreshSession()
        if (error || !data.session) {
          console.warn('Session refresh failed:', error?.message)
          this._sessionValid = false
          this._lastSession = null
          if (redirectOnFail) this._redirectToLogin()
          return null
        }
        nextSession = data.session
      }

      this._sessionValid = true
      this._sessionCheckedAt = Date.now()
      this._lastSession = nextSession
      return nextSession
    } catch (error) {
      console.error('Error validating session:', error)
      this._sessionValid = false
      this._lastSession = null
      return null
    }
  }

  // Invalidar caché manualmente (para visibilitychange / wake-up)
  invalidateSessionCache() {
    this._sessionValid = false
    this._sessionCheckedAt = 0
    this._lastSession = null
  }

  _redirectToLogin() {
    if (router.currentRoute.value.path !== '/login') {
      router.push('/login')
    }
  }

  // Manejar errores de autenticación
  handleAuthError(error) {
    if (error?.message?.includes('JWT') || 
        error?.message?.includes('expired') ||
        error?.message?.includes('invalid') ||
        error?.code === 'PGRST301') {
      console.warn('Authentication error detected:', error)
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login')
      }
      return true
    }
    return false
  }

  // =============== AUTENTICACIÓN ===============
  async signIn(email, password) {
    return await this.client.auth.signInWithPassword({ email, password })
  }

  async signUp(email, password, metadata = {}) {
    return await this.client.auth.signUp({
      email,
      password,
      options: { data: metadata }
    })
  }

  async signOut() {
    try {
      return await this.client.auth.signOut()
    } finally {
      this.invalidateSessionCache()
    }
  }

  async getUser() {
    return await this.client.auth.getUser()
  }

  async getSession() {
    return await this.client.auth.getSession()
  }

  async resetPassword(email) {
    return await this.client.auth.resetPasswordForEmail(email)
  }

  async updateUser(updates) {
    return await this.client.auth.updateUser(updates)
  }

  // =============== BASE DE DATOS ===============
  
  // SELECT
  async select(table, columns = '*', filters = {}) {
    // Validar sesión antes de la operación
    const isValid = await this.validateSession()
    if (!isValid) {
      throw new Error('Sesión inválida o expirada')
    }

    let query = this.client.from(table).select(columns)
    
    // Aplicar filtros
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value)
    })
    
    const result = await query
    
    if (result.error) {
      this.handleAuthError(result.error)
    }
    
    return result
  }

  // INSERT
  async insert(table, data) {
    // Validar sesión antes de la operación
    const isValid = await this.validateSession()
    if (!isValid) {
      throw new Error('Sesión inválida o expirada')
    }

    const result = await this.client.from(table).insert(data).select()
    
    if (result.error) {
      this.handleAuthError(result.error)
    }
    
    return result
  }

  // UPDATE
  async update(table, data, filters = {}) {
    // Validar sesión antes de la operación
    const isValid = await this.validateSession()
    if (!isValid) {
      throw new Error('Sesión inválida o expirada')
    }

    let query = this.client.from(table).update(data)
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value)
    })
    
    const result = await query.select()
    
    if (result.error) {
      this.handleAuthError(result.error)
    }
    
    return result
  }

  // DELETE
  async delete(table, filters = {}) {
    // Validar sesión antes de la operación
    const isValid = await this.validateSession()
    if (!isValid) {
      throw new Error('Sesión inválida o expirada')
    }

    let query = this.client.from(table).delete()
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value)
    })
    
    const result = await query
    
    if (result.error) {
      this.handleAuthError(result.error)
    }
    
    return result
  }

  // Buscar por ID
  async findById(table, id) {
    return await this.client.from(table).select('*').eq('id', id).single()
  }

  // =============== STORAGE ===============
  
  async uploadFile(bucket, path, file) {
    return await this.client.storage.from(bucket).upload(path, file)
  }

  async downloadFile(bucket, path) {
    return await this.client.storage.from(bucket).download(path)
  }

  async deleteFile(bucket, path) {
    return await this.client.storage.from(bucket).remove([path])
  }

  getPublicUrl(bucket, path) {
    const { data } = this.client.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  }

  // =============== REALTIME ===============
  
  subscribe(table, callback, event = '*') {
    return this.client
      .channel(`public:${table}`)
      .on('postgres_changes', 
        { event, schema: 'public', table }, 
        callback
      )
      .subscribe()
  }

  unsubscribe(channel) {
    return this.client.removeChannel(channel)
  }

  // =============== RPC (Funciones) ===============
  
  async callFunction(functionName, params = {}) {
    return await this.client.rpc(functionName, params)
  }
}

// Exportar instancia única
export const supabaseService = new SupabaseService()
export default supabaseService
