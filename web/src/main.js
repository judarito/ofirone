import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import vuetify from './plugins/vuetify'
import { supabase } from './plugins/supabase'
import { useAuth } from './composables/useAuth'
import { startSessionMonitoring } from './utils/sessionManager'
import { createI18nPlugin } from './i18n'
import '@mdi/font/css/materialdesignicons.css'
import './style.css'

const app = createApp(App)

// Any protected Go request that returns 401 invalidates the local session.
// This prevents the shell from remaining visible with an expired token.
const nativeFetch = window.fetch.bind(window)
window.fetch = async (...args) => {
  const response = await nativeFetch(...args)
  const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
  if (response.status === 401 && requestUrl.includes('/api/v1/')) {
    window.dispatchEvent(new CustomEvent('ofirone:backend-unauthorized'))
  }
  return response
}

// Hacer Supabase disponible globalmente
app.config.globalProperties.$supabase = supabase

// Inicializar autenticación antes de montar la app
const { initAuth } = useAuth()
initAuth().then((result) => {
  app.use(router)
  app.use(vuetify)
  app.use(createI18nPlugin())
  app.mount('#app')

  // Iniciar monitoreo de sesión después de montar la app
  if (result?.isAuthenticated) {
    startSessionMonitoring()
  }
})
