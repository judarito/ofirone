import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { fileURLToPath, URL } from 'node:url'

const BACKEND_FLAGS = [
  'VITE_USE_BACKEND_AUTH',
  'VITE_USE_BACKEND_CUSTOMERS',
  'VITE_USE_BACKEND_TENANT_CONFIG',
  'VITE_USE_BACKEND_LOOKUPS',
  'VITE_USE_BACKEND_MASTERS',
  'VITE_USE_BACKEND_CATALOG',
  'VITE_USE_BACKEND_INVENTORY',
  'VITE_USE_BACKEND_POS_CONTEXT',
  'VITE_USE_BACKEND_PURCHASES',
  'VITE_USE_BACKEND_SALES',
  'VITE_USE_BACKEND_CXC',
  'VITE_USE_BACKEND_REPORTS',
  'VITE_USE_BACKEND_ALERTS',
  'VITE_USE_BACKEND_PRICING',
  // These remain opt-in until their Go handlers are complete.
  'VITE_USE_BACKEND_IMPORT_JOBS',
  'VITE_USE_BACKEND_MEDIA_JOBS',
]

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Go is the production/default provider. Legacy providers must be selected
  // explicitly so a missing Cloudflare variable cannot silently re-enable
  // Supabase calls after a deployment.
  const provider = String(env.VITE_DATA_PROVIDER || 'go').trim().toLowerCase()
  const useGo = provider === 'go'
  const define = Object.fromEntries(BACKEND_FLAGS.map((name) => [
    `import.meta.env.${name}`,
    JSON.stringify(useGo
      ? (name === 'VITE_USE_BACKEND_IMPORT_JOBS' || name === 'VITE_USE_BACKEND_MEDIA_JOBS' ? 'false' : 'true')
      : (env[name] || 'false')),
  ]))

  return {
    define,
    plugins: [
      vue(),
      vuetify({ autoImport: true })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
