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
