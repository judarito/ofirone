<template>
  <v-app
    class="ofir-shell"
    :class="isDark ? 'ofir-shell--dark' : 'ofir-shell--light'"
    data-testid="app-shell"
  >
    <!-- Layout con sidebar para rutas autenticadas -->
    <template v-if="!isAuthRoute">
      <v-app-bar
        class="ofir-topbar"
        density="comfortable"
        elevation="0"
        data-testid="app-topbar"
      >
        <v-app-bar-nav-icon 
          class="ofir-topbar__icon"
          data-testid="app-nav-toggle"
          @click="drawer = !drawer"
        ></v-app-bar-nav-icon>

        <v-toolbar-title class="app-brand">
          <img src="/branding/logo-login-text-mini.png" alt="OfirOne" class="app-brand__logo-full">
          <span class="app-brand__name">OfirOne</span>
        </v-toolbar-title>

        <v-spacer></v-spacer>

        <v-menu location="bottom end">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              variant="text"
              class="text-none mr-1 ofir-topbar__text-btn"
              prepend-icon="mdi-translate"
              data-testid="app-language-menu"
            >
              {{ currentLanguageLabel }}
            </v-btn>
          </template>
          <v-list density="compact" data-testid="app-language-options">
            <v-list-item
              v-for="lang in languageOptions"
              :key="lang.value"
              :active="locale === lang.value"
              :data-testid="buildTestId('app-language-option', lang.value)"
              @click="setLocale(lang.value)"
            >
              <v-list-item-title>{{ lang.title }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>

        <v-switch
          v-if="user"
          v-model="darkThemeEnabled"
          hide-details
          density="compact"
          inset
          color="secondary"
          class="theme-switch mr-2"
          data-testid="app-theme-switch"
        >
          <template #prepend>
            <v-icon size="16">mdi-white-balance-sunny</v-icon>
          </template>
          <template #append>
            <v-icon size="16">mdi-weather-night</v-icon>
          </template>
        </v-switch>

        <v-btn
          v-if="userProfile || tenantId"
          class="ofir-topbar__icon-btn"
          icon
          data-testid="app-alerts-button"
          @click="alertsDialog = true"
        >
          <v-badge
            :content="totalAlertsCount"
            :color="totalAlertsCount > 0 ? 'error' : 'grey'"
            :model-value="totalAlertsCount > 0"
          >
            <v-icon>mdi-bell</v-icon>
          </v-badge>
        </v-btn>

        <v-btn class="ofir-topbar__icon-btn" icon to="/help" data-testid="app-help-button">
          <v-icon>mdi-lifebuoy</v-icon>
        </v-btn>

        <v-btn
          v-if="canOpenAiInsights"
          class="ofir-topbar__icon-btn"
          icon
          to="/ai-insights"
          data-testid="app-ai-insights-button"
        >
          <v-icon>mdi-robot-outline</v-icon>
        </v-btn>

        <v-btn class="ofir-topbar__icon-btn" icon data-testid="app-profile-button" @click="handleProfileClick">
          <v-icon>mdi-account-circle</v-icon>
        </v-btn>
      </v-app-bar>

      <v-navigation-drawer
        class="ofir-sidebar"
        v-model="drawer"
        :permanent="!isMobile"
        :temporary="isMobile"
        :width="sidebarWidth"
        app
        data-testid="app-sidebar"
      >
        <v-list-item
          data-testid="app-sidebar-user"
          :title="userProfile?.full_name || user?.email || superAdminInfo?.email || t('app.user')"
          :subtitle="(canManageTenants && !userProfile) ? t('app.superAdmin') : (userProfile?.tenants?.name || t('app.noCompany'))"
        >
          <template #prepend>
            <v-avatar size="38" class="user-avatar mr-3" color="primary" variant="tonal">
              <v-icon size="24">mdi-account-circle</v-icon>
            </v-avatar>
          </template>
        </v-list-item>

        <v-divider></v-divider>

        <div class="ofir-sidebar__display-toggle px-3 pt-3">
          <div class="ofir-sidebar__display-toggle-label">Vista del menú</div>
          <v-btn-toggle
            v-model="menuDisplayMode"
            mandatory
            divided
            color="primary"
            class="ofir-sidebar__display-toggle-control"
            data-testid="app-menu-display-toggle"
          >
            <v-btn
              :value="MENU_DISPLAY_MODE_LIST"
              icon="mdi-format-list-bulleted"
              title="Vista en lista"
              data-testid="app-menu-display-list"
            />
            <v-btn
              :value="MENU_DISPLAY_MODE_GRID"
              icon="mdi-view-grid-outline"
              title="Vista en cuadrícula"
              data-testid="app-menu-display-grid"
            />
          </v-btn-toggle>
        </div>

        <v-list v-if="!isGridMenuMode" class="ofir-sidebar__menu" density="compact" nav data-testid="app-sidebar-menu">
          <template v-if="menuSections && menuSections.length > 0">
            <template v-for="(section, idx) in menuSections" :key="`section-${section?.title || idx}`">
              <!-- Item suelto (sin grupo) -->
              <v-list-item
                v-if="!section?.children"
                :prepend-icon="section?.icon"
                :title="section?.title"
                :to="section?.action ? undefined : section?.route"
                :value="section?.title"
                color="primary"
                :data-testid="buildTestId('app-sidebar-item', section?.route || section?.title || idx)"
                @click="section?.action ? handleMenuAction(section.action) : undefined"
              ></v-list-item>

              <!-- Grupo colapsable -->
              <v-list-group
                v-else-if="section?.children"
                :value="section?.title"
                :data-testid="buildTestId('app-sidebar-group', section?.title || idx)"
              >
                <template #activator="{ props }">
                  <v-list-item
                    v-bind="props"
                    :prepend-icon="section?.icon"
                    :title="section?.title"
                    :data-testid="buildTestId('app-sidebar-group-trigger', section?.title || idx)"
                  ></v-list-item>
                </template>
                <v-list-item
                  v-for="(child, childIdx) in section.children"
                  :key="`child-${child?.title || childIdx}`"
                  :prepend-icon="child?.icon"
                  :title="child?.title"
                  :to="child?.action ? undefined : child?.route"
                  :value="child?.title"
                  color="primary"
                  :data-testid="buildTestId('app-sidebar-child', child?.route || child?.title || childIdx)"
                  @click="child?.action ? handleMenuAction(child.action) : undefined"
                ></v-list-item>
              </v-list-group>
            </template>
          </template>
          
          <!-- Mensaje cuando no hay menú disponible -->
          <v-list-item v-else>
            <v-list-item-title class="text-caption text-grey">{{ t('app.loadingMenu') }}</v-list-item-title>
          </v-list-item>
        </v-list>

        <div v-else class="ofir-sidebar__grid-wrap px-3 pb-3">
          <template v-if="menuSections && menuSections.length > 0">
            <div class="ofir-sidebar__grid" data-testid="app-sidebar-grid">
              <div
                v-for="(section, idx) in menuSections"
                :key="`grid-section-${section?.title || idx}`"
                class="ofir-sidebar__grid-card"
                :class="{ 'ofir-sidebar__grid-card--expanded': section?.children && isGridSectionExpanded(section, idx) }"
                :data-testid="buildTestId('app-sidebar-grid-card', section?.title || idx)"
              >
                <button
                  type="button"
                  class="ofir-sidebar__grid-trigger"
                  :data-testid="buildTestId('app-sidebar-grid-trigger', section?.title || idx)"
                  @click="handleGridSectionSelection(section, idx)"
                >
                  <span class="ofir-sidebar__grid-icon">
                    <v-icon size="22">{{ section?.icon || 'mdi-view-grid-outline' }}</v-icon>
                  </span>
                  <span class="ofir-sidebar__grid-text">
                    <span class="ofir-sidebar__grid-title">{{ section?.title }}</span>
                    <span class="ofir-sidebar__grid-subtitle">
                      {{ section?.children?.length ? `${section.children.length} accesos` : 'Abrir módulo' }}
                    </span>
                  </span>
                  <v-icon v-if="section?.children" size="18" class="ofir-sidebar__grid-chevron">
                    {{ isGridSectionExpanded(section, idx) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
                  </v-icon>
                  <v-icon v-else size="18" class="ofir-sidebar__grid-chevron">
                    mdi-arrow-top-right
                  </v-icon>
                </button>

                <div
                  v-if="section?.children?.length && isGridSectionExpanded(section, idx)"
                  class="ofir-sidebar__grid-children"
                  :data-testid="buildTestId('app-sidebar-grid-children', section?.title || idx)"
                >
                  <button
                    v-for="(child, childIdx) in section.children"
                    :key="`grid-child-${child?.title || childIdx}`"
                    type="button"
                    class="ofir-sidebar__grid-child"
                    :data-testid="buildTestId('app-sidebar-grid-child', child?.route || child?.title || childIdx)"
                    @click="handleGridChildSelection(child)"
                  >
                    <v-icon size="16">{{ child?.icon || 'mdi-chevron-right' }}</v-icon>
                    <span>{{ child?.title }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="ofir-sidebar__grid-empty" data-testid="app-sidebar-grid-empty">
            {{ t('app.loadingMenu') }}
          </div>
        </div>

        <template v-slot:append>
          <div class="pa-2">
            <v-btn
              block
              prepend-icon="mdi-logout"
              color="error"
              variant="outlined"
              data-testid="app-logout-button"
              @click="handleLogout"
            >
              {{ t('app.logout') }}
            </v-btn>
          </div>
        </template>
      </v-navigation-drawer>

      <v-main class="ofir-main" data-testid="app-main">
        <v-container fluid class="pa-4 ofir-main__container" data-testid="app-main-container">
          <v-alert
            v-if="showBillingBanner"
            :type="billingBannerType"
            variant="tonal"
            class="mb-4"
            icon="mdi-credit-card-alert-outline"
          >
            <div class="d-flex align-center justify-space-between flex-wrap ga-3">
              <div>
                <strong>Estado comercial:</strong> {{ billingBannerMessage }}
                <div class="text-body-2 mt-1">
                  Plan {{ billingSummary?.plan_name || billingSummary?.plan_code || 'sin nombre' }} ·
                  Estado {{ billingSummary?.status_label || 'Sin estado' }}
                </div>
              </div>
              <v-btn
                color="primary"
                variant="tonal"
                :to="{ path: '/tenant-config', query: { tab: 'billing' } }"
              >
                Ver suscripción
              </v-btn>
            </div>
          </v-alert>
          <router-view v-slot="{ Component, route: currentRoute }">
            <div
              class="ofir-route-view"
              :data-testid="buildRouteTestId(currentRoute)"
            >
              <component :is="Component" />
            </div>
          </router-view>
        </v-container>
      </v-main>

      <v-footer app class="text-center ofir-footer" elevation="0" data-testid="app-footer">
        <v-col class="text-center" cols="12">
          {{ new Date().getFullYear() }} — <strong>OfirOne</strong>
        </v-col>
      </v-footer>

      <!-- Snackbar global -->
      <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000" data-testid="app-snackbar">
        {{ snackbarMessage }}
        <template v-slot:actions>
          <v-btn variant="text" @click="snackbar = false">{{ t('common.close') }}</v-btn>
        </template>
      </v-snackbar>

      <AppAlertsDialog v-if="alertsDialog" v-model="alertsDialog" />
    </template>

    <!-- Layout simple para rutas de autenticación -->
    <template v-else>
      <router-view v-slot="{ Component, route: currentRoute }">
        <div
          class="ofir-route-view ofir-route-view--public"
          :data-testid="buildRouteTestId(currentRoute)"
        >
          <component :is="Component" />
        </div>
      </router-view>
    </template>
  </v-app>
</template>

<script setup>
import { defineAsyncComponent, ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useNotification } from '@/composables/useNotification'
import { useTheme } from '@/composables/useTheme'
import { useSuperAdmin } from '@/composables/useSuperAdmin'
import { useTenantBilling } from '@/composables/useTenantBilling'
import { useDisplay } from 'vuetify'
import rolesService from '@/services/roles.service'
import { useAppAlerts } from '@/composables/useAppAlerts'
import { useI18n } from '@/i18n'
import { filterMenuTreeByBilling, getBillingRouteAccess } from '../../shared/utils/billingAccess'
import { buildRouteTestId, buildTestId } from '@/utils/testIds'
import {
  loadMenuDisplayMode,
  MENU_DISPLAY_MODE_GRID,
  MENU_DISPLAY_MODE_LIST,
  normalizeMenuDisplayMode,
  persistMenuDisplayMode,
} from '@/utils/menuDisplayMode'

const AppAlertsDialog = defineAsyncComponent(() => import('@/components/AppAlertsDialog.vue'))

const router = useRouter()
const route = useRoute()
const { signOut, user, userProfile, hasPermission, hasAnyPermission } = useAuth()
const { tenantId, clearTenant } = useTenant()
const { locale: tenantLocale, loadSettings } = useTenantSettings()
const { snackbar, snackbarMessage, snackbarColor } = useNotification()
const { isDark, setTheme, ensureThemeForUser, syncThemeFromTenant } = useTheme()
const { canManageTenants, superAdminInfo } = useSuperAdmin()
const { billingSummary, billingBannerMessage } = useTenantBilling()
const { mobile: isMobile } = useDisplay()
const { t, setLocale, locale } = useI18n()

const languageOptions = computed(() => [
  { title: 'Español', value: 'es' },
  { title: 'English', value: 'en' }
])

const currentLanguageLabel = computed(() => {
  return locale.value === 'en' ? 'EN' : 'ES'
})

const darkThemeEnabled = computed({
  get: () => isDark.value,
  set: (enabled) => {
    setTheme(enabled ? 'dark' : 'light', user.value?.id || null)
  }
})

const drawer = ref(true)
const menuDisplayMode = ref(loadMenuDisplayMode())
const expandedGridSections = ref({})
const isGridMenuMode = computed(() => menuDisplayMode.value === MENU_DISPLAY_MODE_GRID)
const sidebarWidth = computed(() => (isGridMenuMode.value ? 392 : 304))

// Menús dinámicos cargados desde DB (fn_get_user_menus)
const dynamicMenuTree = ref(null)  // null = sin cargar, [] = cargado vacío, [{...}] = árbol
/**
 * Carga el árbol de menús del usuario desde la base de datos.
 * fn_get_user_menus ya resuelve la jerarquía: incluye grupos padre
 * automáticamente aunque solo estén asignados los hijos.
 */
async function loadDynamicMenus(authUserId) {
  if (!authUserId) return
  try {
    const result = await rolesService.getUserMenus(authUserId)
    if (result.success && result.data.length > 0) {
      dynamicMenuTree.value = result.data  // árbol con children ya armado
    } else {
      // Función existe pero sin menús asignados, O error de red/404
      // → mantener null para que menuSections use el menú estático como fallback
      dynamicMenuTree.value = null
      if (!result.success) {
        console.debug('Menús dinámicos no disponibles (fn_get_user_menus), usando menú estático:', result.error)
      }
    }
  } catch (e) {
    console.debug('fn_get_user_menus no disponible, usando menú estático:', e.message)
    dynamicMenuTree.value = null
  }
}

const alertsDialog = ref(false)

const billingBannerType = computed(() => {
  const status = billingSummary.value?.status
  if (status === 'past_due' || status === 'suspended') return 'error'
  if (status === 'grace_period') return 'warning'
  return 'info'
})

const showBillingBanner = computed(() => {
  return Boolean(
    !isAuthRoute.value &&
    tenantId.value &&
    userProfile.value &&
    billingSummary.value &&
    billingBannerMessage.value
  )
})

const canOpenAiInsights = computed(() => getBillingRouteAccess(billingSummary.value, '/ai-insights').allowed)

// Composable: alertas del sistema + ubicaciones
const {
  allAlerts,
  totalAlertsCount,
  loadAlerts,
  subscribeToAlerts,
  unsubscribeFromAlerts,
} = useAppAlerts()

// Rutas que usan layout aislado (login + storefront público)
const isAuthRoute = computed(() => route.path === '/login' || route.meta?.publicShell === true)

// Menú específico para Super Admin (usuarios sin tenant)
const superAdminMenuItems = computed(() => [
  {
    title: t('app.systemManagement'),
    icon: 'mdi-cog-outline',
    permissions: [],
    children: [
      { title: t('app.tenantManagement'), icon: 'mdi-office-building-plus', route: '/tenant-management', permissions: ['SUPER_ADMIN_ONLY'] },
      { title: t('app.tenantBilling'), icon: 'mdi-credit-card-cog', route: '/superadmin/billing', permissions: ['SUPER_ADMIN_ONLY'] },
      { title: t('app.rolesPermissionsMenus'), icon: 'mdi-shield-crown', route: '/superadmin/roles-menus', permissions: ['SUPER_ADMIN_ONLY'] },
    ]
  },
  { title: t('app.userManual'), icon: 'mdi-book-open-page-variant', action: 'openManual', permissions: [] },
  { title: t('app.about'), icon: 'mdi-information', route: '/about', permissions: [] },
])

// Filtrar menú según permisos del usuario
const menuSections = computed(() => {
  // Guarda: esperar a que se inicialicen los datos
  if (!user.value && !canManageTenants.value) {
    return []
  }

  // Superadmin (sin perfil de tenant): menú especial hardcodeado
  if (!userProfile.value && canManageTenants.value) {
    return superAdminMenuItems.value
  }

  // Si no tiene perfil, no mostrar menú
  if (!userProfile.value) {
    return []
  }

  // ── MENÚ DINÁMICO (DB-driven) ─────────────────────────────────
  // fn_get_user_menus resuelve jerarquía (padres auto-incluidos)
  if (!dynamicMenuTree.value || dynamicMenuTree.value.length === 0) {
    return []  // Aún cargando, error de red, o sin menús asignados
  }

  const billingSafeTree = filterMenuTreeByBilling(billingSummary.value, dynamicMenuTree.value)

  // Convertir árbol de DB al formato que espera el sidebar
  return billingSafeTree.map(root => {
    const item = {
      title: root.label,
      icon: root.icon,
      route: root.route || undefined,
      action: root.action || undefined,
    }
    if (root.children && root.children.length > 0) {
      item.children = root.children.map(child => ({
        title: child.label,
        icon: child.icon,
        route: child.route || undefined,
        action: child.action || undefined,
      }))
    }
    return item
  })
})


const handleResize = () => {
  if (isMobile.value) {
    drawer.value = false
  } else {
    drawer.value = true
  }
}

const getGridSectionKey = (section, idx = 0) => {
  const title = String(section?.title || `section-${idx}`)
  const route = String(section?.route || '')
  return `${title}:${route}:${idx}`
}

const isGridSectionExpanded = (section, idx = 0) => {
  return Boolean(expandedGridSections.value[getGridSectionKey(section, idx)])
}

const toggleGridSection = (section, idx = 0) => {
  const key = getGridSectionKey(section, idx)
  expandedGridSections.value = {
    ...expandedGridSections.value,
    [key]: !expandedGridSections.value[key]
  }
}

const navigateFromMenuItem = async (item) => {
  if (item?.action) {
    handleMenuAction(item.action)
  } else if (item?.route) {
    await router.push(item.route)
  }

  if (isMobile.value) {
    drawer.value = false
  }
}

const handleGridSectionSelection = async (section, idx = 0) => {
  if (section?.children?.length) {
    toggleGridSection(section, idx)
    return
  }

  await navigateFromMenuItem(section)
}

const handleGridChildSelection = async (child) => {
  await navigateFromMenuItem(child)
}

const handleProfileClick = () => {
  try {
    // Guarda: asegurar que hay un usuario autenticado
    if (!user.value?.id && !canManageTenants.value) {
      console.warn('No hay usuario autenticado')
      return
    }

    // Super Admin va a gestión de tenants, usuario normal a config de tenant
    if (canManageTenants.value && !userProfile.value) {
      router.push('/tenant-management')
    } else {
      router.push('/tenant-config')
    }
  } catch (error) {
    console.error('Error en handleProfileClick:', error)
    // Fallback seguro
    router.push('/tenant-config')
  }
}

const handleMenuAction = (action) => {
  if (action === 'openManual') {
    router.push('/help')
  }
}

const handleLogout = async () => {
  const result = await signOut()
  if (result.success) {
    clearTenant()
    await router.replace('/login')
  }
}

// Iniciar/detener suscripción según tenant y ruta
watch([tenantId, isAuthRoute], ([newTenantId, newIsAuthRoute]) => {
  if (newTenantId && !newIsAuthRoute) {
    loadAlerts()
    subscribeToAlerts()
  } else {
    unsubscribeFromAlerts()
    allAlerts.value = []
  }
}, { immediate: true })

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  handleResize()
  
  // Cargar configuración del tenant y aplicar locale
  if (tenantId.value) {
    await loadSettings()
    if (tenantLocale.value) {
      setLocale(tenantLocale.value)
    }
  }

  // Tema por usuario: localStorage primero; fallback tenant_settings solo si no hay cache.
  if (tenantId.value) {
    await syncThemeFromTenant(tenantId.value, user.value?.id || null)
  } else {
    await ensureThemeForUser({ authUserId: user.value?.id || null })
  }

  // Cargar menús dinámicos si hay usuario con perfil (tenant user)
  if (user.value?.id && userProfile.value) {
    loadDynamicMenus(user.value.id)
  }
})

// Recargar menús dinámicos cuando el usuario inicia sesión o cambia de tenant
watch(
  () => user.value?.id,
  async (newUserId) => {
    if (newUserId && userProfile.value) {
      loadDynamicMenus(newUserId)
    } else {
      dynamicMenuTree.value = null  // Limpiar al cerrar sesión
    }
    if (tenantId.value) {
      await syncThemeFromTenant(tenantId.value, newUserId || null)
    } else {
      await ensureThemeForUser({ authUserId: newUserId || null })
    }
  }
)

watch(
  () => tenantId.value,
  async (newTenantId) => {
    if (newTenantId && user.value?.id) {
      loadDynamicMenus(user.value.id)  // Recargar menús al cambiar tenant
      await loadSettings(true)
      await syncThemeFromTenant(newTenantId, user.value?.id || null)
    }
  }
)

watch(tenantLocale, (newLocale) => {
  if (newLocale) {
    setLocale(newLocale)
  }
})

watch(menuDisplayMode, (value) => {
  persistMenuDisplayMode(normalizeMenuDisplayMode(value))
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  unsubscribeFromAlerts()
})
</script>

<style scoped>
.ofir-shell {
  --ofir-blue: #2563eb;
  --ofir-blue-soft: #1d4ed8;
  --ofir-green: #78d64b;
  --ofir-panel-dark: rgba(11, 18, 38, 0.86);
  --ofir-panel-light: rgba(255, 255, 255, 0.92);
  --ofir-border-dark: rgba(122, 153, 255, 0.2);
  --ofir-border-light: rgba(37, 99, 235, 0.22);
}

.ofir-shell :deep(.v-application__wrap) {
  background-repeat: no-repeat;
  background-attachment: fixed;
}

.ofir-shell--dark :deep(.v-application__wrap) {
  background-image:
    radial-gradient(circle at 10% 5%, rgba(46, 90, 255, 0.24), transparent 32%),
    radial-gradient(circle at 95% 0%, rgba(120, 214, 75, 0.2), transparent 28%),
    linear-gradient(160deg, #060b18 0%, #0a1125 45%, #060b18 100%);
}

.ofir-shell--light :deep(.v-application__wrap) {
  background-image:
    radial-gradient(circle at 10% 4%, rgba(37, 99, 235, 0.12), transparent 32%),
    radial-gradient(circle at 92% 0%, rgba(120, 214, 75, 0.1), transparent 24%),
    linear-gradient(165deg, #ecf2fb 0%, #f6f9ff 42%, #edf3fd 100%);
}

.ofir-topbar {
  z-index: 1200;
  border-bottom: 1px solid transparent;
  backdrop-filter: blur(8px);
}

.ofir-shell--dark .ofir-topbar {
  background: rgba(10, 16, 35, 0.78) !important;
  border-bottom-color: var(--ofir-border-dark);
}

.ofir-shell--light .ofir-topbar {
  background: rgba(248, 251, 255, 0.88) !important;
  border-bottom-color: var(--ofir-border-light);
}

.ofir-topbar__icon {
  border-radius: 12px;
}

.ofir-topbar__icon-btn,
.ofir-topbar__text-btn {
  border-radius: 12px;
}

.ofir-shell--dark .ofir-topbar__icon-btn,
.ofir-shell--dark .ofir-topbar__text-btn {
  background: rgba(14, 24, 48, 0.7);
  color: #ecf2ff;
  border: 1px solid rgba(112, 141, 255, 0.2);
}

.ofir-shell--light .ofir-topbar__icon-btn,
.ofir-shell--light .ofir-topbar__text-btn {
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(44, 88, 209, 0.15);
}

.app-brand {
  line-height: 1;
  margin-inline-start: 0 !important;
}

.app-brand :deep(.v-toolbar-title__placeholder) {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
}

.app-brand__logo-full {
  width: 58px;
  height: 50px;
  object-fit: contain;
  object-position: center;
  display: block;
}

.app-brand__name {
  font-weight: 800;
  letter-spacing: 0.25px;
  line-height: 1;
}

.ofir-shell--dark .app-brand__name {
  color: #eef3ff;
}

.ofir-shell--light .app-brand__name {
  color: #203763;
}

.ofir-sidebar {
  z-index: 1000;
  border-right: 1px solid transparent;
}

.ofir-shell--dark .ofir-sidebar {
  background: linear-gradient(180deg, rgba(9, 16, 35, 0.95), rgba(8, 14, 28, 0.92)) !important;
  border-right-color: rgba(99, 131, 255, 0.22);
}

.ofir-shell--light .ofir-sidebar {
  background: linear-gradient(180deg, rgba(237, 244, 255, 0.95), rgba(234, 242, 252, 0.95)) !important;
  border-right-color: rgba(68, 110, 228, 0.2);
}

.ofir-sidebar__menu :deep(.v-list-item) {
  border-radius: 14px;
  margin: 2px 8px;
}

.ofir-shell--dark .ofir-sidebar__menu :deep(.v-list-item) {
  color: #d8e2ff;
}

.ofir-shell--dark .ofir-sidebar__menu :deep(.v-list-item:hover) {
  background: rgba(33, 59, 126, 0.32);
}

.ofir-shell--light .ofir-sidebar__menu :deep(.v-list-item) {
  color: #29416e;
}

.ofir-shell--light .ofir-sidebar__menu :deep(.v-list-item:hover) {
  background: rgba(37, 99, 235, 0.08);
}

.ofir-sidebar__menu :deep(.v-list-item--active) {
  position: relative;
  font-weight: 700;
}

.ofir-sidebar__display-toggle-label {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.ofir-shell--dark .ofir-sidebar__display-toggle-label {
  color: #99acd9;
}

.ofir-shell--light .ofir-sidebar__display-toggle-label {
  color: #5b729f;
}

.ofir-sidebar__display-toggle-control {
  display: inline-flex;
  width: auto;
}

.ofir-sidebar__display-toggle-control :deep(.v-btn) {
  min-width: 42px;
}

.ofir-shell--dark .ofir-sidebar__menu :deep(.v-list-item--active) {
  background: linear-gradient(90deg, rgba(120, 214, 75, 0.24), rgba(37, 99, 235, 0.26));
  color: #f4ffe9;
}

.ofir-shell--light .ofir-sidebar__menu :deep(.v-list-item--active) {
  background: linear-gradient(90deg, rgba(120, 214, 75, 0.2), rgba(37, 99, 235, 0.18));
  color: #1f3661;
}

.ofir-sidebar__grid-wrap {
  overflow-y: auto;
}

.ofir-sidebar__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ofir-sidebar__grid-card {
  border-radius: 16px;
  border: 1px solid transparent;
  overflow: hidden;
}

.ofir-sidebar__grid-card--expanded {
  grid-column: 1 / -1;
}

.ofir-shell--dark .ofir-sidebar__grid-card {
  background: rgba(15, 24, 47, 0.84);
  border-color: rgba(98, 129, 255, 0.18);
}

.ofir-shell--light .ofir-sidebar__grid-card {
  background: rgba(255, 255, 255, 0.84);
  border-color: rgba(62, 102, 219, 0.15);
}

.ofir-sidebar__grid-trigger {
  width: 100%;
  min-height: 98px;
  padding: 12px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.ofir-sidebar__grid-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ofir-shell--dark .ofir-sidebar__grid-icon {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.28), rgba(120, 214, 75, 0.24));
  color: #edf4ff;
}

.ofir-shell--light .ofir-sidebar__grid-icon {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(120, 214, 75, 0.16));
  color: #214180;
}

.ofir-sidebar__grid-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ofir-sidebar__grid-title {
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.28;
}

.ofir-shell--dark .ofir-sidebar__grid-title {
  color: #eef4ff;
}

.ofir-shell--light .ofir-sidebar__grid-title {
  color: #213861;
}

.ofir-sidebar__grid-subtitle {
  font-size: 0.7rem;
  line-height: 1.35;
}

.ofir-shell--dark .ofir-sidebar__grid-subtitle {
  color: #9ab0da;
}

.ofir-shell--light .ofir-sidebar__grid-subtitle {
  color: #667ea7;
}

.ofir-sidebar__grid-chevron {
  align-self: flex-end;
  margin-top: auto;
}

.ofir-shell--dark .ofir-sidebar__grid-chevron {
  color: #a7bbee;
}

.ofir-shell--light .ofir-sidebar__grid-chevron {
  color: #6783b2;
}

.ofir-sidebar__grid-children {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 0 10px 10px;
}

.ofir-sidebar__grid-child {
  min-height: 42px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  line-height: 1.25;
}

.ofir-shell--dark .ofir-sidebar__grid-child {
  background: rgba(9, 17, 34, 0.62);
  border-color: rgba(97, 128, 255, 0.14);
  color: #deebff;
}

.ofir-shell--light .ofir-sidebar__grid-child {
  background: rgba(239, 245, 255, 0.92);
  border-color: rgba(71, 111, 219, 0.12);
  color: #254377;
}

.ofir-sidebar__grid-empty {
  padding: 14px 4px;
  font-size: 0.82rem;
}

.ofir-shell--dark .ofir-sidebar__grid-empty {
  color: #92a7d4;
}

.ofir-shell--light .ofir-sidebar__grid-empty {
  color: #6880ab;
}

.ofir-main__container {
  max-width: 1500px;
}

.ofir-main {
  position: relative;
}

.ofir-shell--dark .ofir-main {
  color: #dde8ff;
}

.ofir-shell--light .ofir-main {
  color: #23406f;
}

.ofir-main :deep(.v-card) {
  border-radius: 16px;
  border: 1px solid transparent;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.ofir-main :deep(.v-card:hover) {
  transform: translateY(-1px);
}

.ofir-shell--dark .ofir-main :deep(.v-card) {
  background: linear-gradient(145deg, rgba(15, 24, 48, 0.9), rgba(11, 18, 37, 0.9)) !important;
  border-color: rgba(112, 142, 255, 0.2);
  box-shadow: 0 10px 24px rgba(2, 7, 18, 0.44);
}

.ofir-shell--light .ofir-main :deep(.v-card) {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(241, 247, 255, 0.95)) !important;
  border-color: rgba(37, 99, 235, 0.14);
  box-shadow: 0 10px 20px rgba(35, 74, 148, 0.1);
}

.ofir-main :deep(.v-field) {
  border-radius: 12px;
}

.ofir-shell--dark .ofir-main :deep(.v-field) {
  background: rgba(10, 18, 36, 0.68);
}

.ofir-shell--light .ofir-main :deep(.v-field) {
  background: rgba(255, 255, 255, 0.92);
}

.ofir-main :deep(.v-table) {
  border-radius: 14px;
  overflow: hidden;
}

.ofir-shell--dark .ofir-main :deep(.v-table) {
  background: rgba(8, 15, 32, 0.64);
}

.ofir-shell--light .ofir-main :deep(.v-table) {
  background: rgba(255, 255, 255, 0.9);
}

.ofir-main :deep(.v-table thead th) {
  font-weight: 700 !important;
  letter-spacing: 0.2px;
}

.ofir-shell :deep(.v-tabs) {
  border-radius: 14px;
  padding: 6px;
}

.ofir-shell--dark :deep(.v-tabs) {
  background: rgba(9, 16, 33, 0.58);
  border: 1px solid rgba(108, 139, 255, 0.2);
}

.ofir-shell--light :deep(.v-tabs) {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(37, 99, 235, 0.14);
}

.ofir-shell :deep(.v-tab) {
  border-radius: 10px;
  min-height: 44px;
  padding-inline: 14px;
  text-transform: none;
  font-weight: 700;
  line-height: 1.2;
  white-space: normal;
  overflow: visible;
}

.ofir-shell :deep(.v-tab .v-btn__content) {
  line-height: 1.2;
  padding-block: 4px;
  overflow: visible;
}

.ofir-shell :deep(.v-slide-group__content) {
  align-items: stretch;
}

.ofir-shell--dark :deep(.v-tab--selected) {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.28), rgba(120, 214, 75, 0.26));
}

.ofir-shell--light :deep(.v-tab--selected) {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.18), rgba(120, 214, 75, 0.16));
}

:deep(.v-overlay__content > .v-card) {
  border-radius: 18px;
  border: 1px solid transparent;
  overflow: hidden;
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-surface), 0.98),
    rgba(var(--v-theme-background), 0.95)
  ) !important;
  border-color: rgba(var(--v-theme-primary), 0.2);
  box-shadow: 0 16px 36px rgba(16, 24, 40, 0.18);
}

:deep(.v-overlay__content .v-card-title) {
  font-weight: 800;
  letter-spacing: 0.25px;
}

:deep(.v-overlay__content .v-card-actions) {
  border-top: 1px solid transparent;
  padding-top: 10px;
  border-top-color: rgba(var(--v-theme-primary), 0.14);
}

.alerts-dialog :deep(.v-overlay__content) {
  width: min(1080px, calc(100vw - 24px));
}

.alerts-modal {
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-surface), 0.985),
    rgba(var(--v-theme-background), 0.95)
  ) !important;
  box-shadow: 0 20px 38px rgba(18, 28, 48, 0.2);
}

.alerts-modal__header {
  min-height: 60px;
  gap: 8px;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.2);
  letter-spacing: 0.25px;
}

.ofir-shell--dark .alerts-modal__header {
  background: linear-gradient(120deg, rgba(29, 80, 196, 0.95), rgba(20, 42, 103, 0.92));
  color: #f4f8ff;
}

.ofir-shell--light .alerts-modal__header {
  background: linear-gradient(120deg, rgba(38, 95, 224, 0.92), rgba(62, 139, 230, 0.9));
  color: #f8fcff;
}

.alerts-modal__close {
  border-radius: 12px;
}

.ofir-shell--dark .alerts-modal__close {
  background: rgba(8, 15, 33, 0.38);
}

.ofir-shell--light .alerts-modal__close {
  background: rgba(255, 255, 255, 0.28);
}

.alerts-modal__tabs {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.16);
}

.ofir-shell--dark .alerts-modal__tabs {
  background: linear-gradient(180deg, rgba(10, 18, 38, 0.85), rgba(9, 15, 31, 0.75));
}

.ofir-shell--light .alerts-modal__tabs {
  background: linear-gradient(180deg, rgba(245, 249, 255, 0.98), rgba(236, 243, 255, 0.92));
}

.alerts-modal__tabs :deep(.v-slide-group__content) {
  gap: 8px;
}

.alerts-modal__tabs :deep(.v-tab) {
  min-height: 42px;
  border-radius: 11px;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
}

.alerts-modal__tabs :deep(.v-tab--selected) {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.28), rgba(120, 214, 75, 0.24));
}

.alerts-modal__tabs :deep(.v-badge__badge) {
  font-weight: 800;
}

.alerts-modal__window {
  background: transparent;
}

.alerts-modal__filters {
  padding-top: 14px !important;
  padding-bottom: 10px !important;
}

.alerts-modal__filters :deep(.v-field) {
  border-radius: 12px;
}

.alerts-mobile-wrap {
  max-height: 500px;
  overflow: auto;
  padding: 10px !important;
}

.alerts-mobile-item {
  border-radius: 14px !important;
  border-width: 1px !important;
}

.ofir-shell--dark .alerts-mobile-item {
  border-color: rgba(112, 141, 255, 0.24) !important;
}

.ofir-shell--light .alerts-mobile-item {
  border-color: rgba(37, 99, 235, 0.18) !important;
}

.alerts-table-wrap {
  max-height: 500px;
  overflow: hidden;
}

.alerts-table {
  background: transparent !important;
}

.alerts-table :deep(thead th) {
  font-size: 0.76rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.45px;
  text-transform: uppercase;
  white-space: nowrap;
}

.alerts-table :deep(td) {
  padding-top: 11px !important;
  padding-bottom: 11px !important;
  vertical-align: middle;
}

.alerts-table :deep(tbody tr) {
  transition: background 0.18s ease;
}

.ofir-shell--dark .alerts-table :deep(tbody tr:hover) {
  background: rgba(34, 63, 133, 0.2);
}

.ofir-shell--light .alerts-table :deep(tbody tr:hover) {
  background: rgba(37, 99, 235, 0.07);
}

.alerts-empty-state {
  margin: 12px;
  border-radius: 14px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
}

.ofir-shell--dark .alerts-empty-state {
  background: rgba(11, 18, 38, 0.64);
}

.ofir-shell--light .alerts-empty-state {
  background: rgba(245, 250, 255, 0.9);
}

.alerts-modal__actions {
  gap: 10px;
  flex-wrap: wrap;
}

.alerts-modal__actions :deep(.v-btn) {
  border-radius: 11px;
  font-weight: 700;
  text-transform: none;
}

@media (max-width: 960px) {
  .alerts-dialog :deep(.v-overlay__content) {
    width: calc(100vw - 12px);
  }

  .alerts-modal__tabs {
    padding-inline: 6px;
  }

  .alerts-modal__tabs :deep(.v-tab) {
    min-width: max-content;
    font-size: 0.75rem;
    padding-inline: 10px;
  }

  .alerts-modal__actions {
    padding: 12px !important;
  }
}

.ofir-footer {
  backdrop-filter: blur(6px);
  border-top: 1px solid transparent;
}

.ofir-shell--dark .ofir-footer {
  background: rgba(9, 14, 28, 0.72) !important;
  border-top-color: rgba(98, 129, 255, 0.2);
  color: #d2dcff;
}

.ofir-shell--light .ofir-footer {
  background: rgba(244, 248, 255, 0.9) !important;
  border-top-color: rgba(62, 108, 224, 0.2);
  color: #2d466f;
}

.user-avatar {
  background: transparent;
}

.theme-switch {
  margin-left: 4px;
}

.theme-switch :deep(.v-selection-control) {
  min-height: 34px;
}

.theme-switch :deep(.v-selection-control__wrapper) {
  margin: 0 4px;
}

.theme-switch :deep(.v-icon) {
  color: rgba(229, 238, 255, 0.95);
}

@media (max-width: 960px) {
  .app-brand__logo-full {
    width: 52px;
    height: 44px;
  }

  .app-brand__name {
    font-size: 1.05rem;
  }
}
</style>
