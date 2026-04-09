<template>
  <div>
    <!-- Estado de carga inicial -->
    <div v-if="!isInitialized || isResolving" class="text-center pa-4">
      <v-progress-circular indeterminate color="primary"></v-progress-circular>
      <div class="mt-2">Cargando...</div>
    </div>

    <!-- Contenedor con key para forzar re-render estable -->
    <div v-else :key="`tenant-management-${canManageTenants}`">
      <!-- VALIDACIÓN DE ACCESO -->
      <v-alert 
        v-if="!canManageTenants" 
        type="error" 
        variant="tonal" 
        class="mb-4"
      >
        <v-icon start>mdi-lock</v-icon>
        <strong>Acceso Restringido</strong>
        <div class="mt-2">
          Solo Super Administradores pueden gestionar tenants.
        </div>
        <div class="text-caption mt-1">
          Usuario: {{ superAdminInfo?.email || 'No disponible' }} | 
          Perfil: {{ superAdminInfo?.hasProfile ? 'Con tenant' : 'Sin tenant' }}
        </div>
      </v-alert>

      <!-- INTERFAZ PRINCIPAL -->
      <v-card v-if="canManageTenants">
      <v-card-title class="bg-primary">
        <v-icon start color="white">mdi-office-building-plus</v-icon>
        <span class="text-white">Gestión de Tenants</span>
      </v-card-title>

      <v-tabs v-model="tab" color="primary" class="mt-2">
        <v-tab value="create">Crear Tenant</v-tab>
        <v-tab value="list">Lista de Tenants</v-tab>
      </v-tabs>

      <v-window v-model="tab">
        <!-- TAB: CREAR TENANT -->
        <v-window-item value="create">
          <v-card-text>
            <v-form ref="form" @submit.prevent="createTenant">
              <v-row>
                <!-- DATOS DEL TENANT -->
                <v-col cols="12">
                  <div class="text-h6 mb-2">
                    <v-icon start color="primary">mdi-office-building</v-icon>
                    Datos del Negocio
                  </div>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="tenantData.name"
                    label="Nombre Comercial *"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required]"
                    prepend-inner-icon="mdi-store"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="tenantData.legal_name"
                    label="Razón Social"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-file-document"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="tenantData.tax_id"
                    label="NIT/RUT *"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required]"
                    prepend-inner-icon="mdi-barcode"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="tenantData.email"
                    label="Email Empresa *"
                    type="email"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required, rules.email]"
                    prepend-inner-icon="mdi-email"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="tenantData.phone"
                    label="Teléfono"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-phone"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="tenantData.invoice_prefix"
                    label="Prefijo de Facturas *"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required]"
                    hint="Ej: FAC, INV, VTA"
                    prepend-inner-icon="mdi-receipt"
                  ></v-text-field>
                </v-col>

                <v-col cols="12">
                  <v-textarea
                    v-model="tenantData.address"
                    :label="t('common.address')"
                    variant="outlined"
                    density="comfortable"
                    rows="2"
                    prepend-inner-icon="mdi-map-marker"
                  ></v-textarea>
                </v-col>

                <!-- DATOS DEL ADMINISTRADOR -->
                <v-col cols="12" class="mt-4">
                  <v-divider></v-divider>
                  <div class="text-h6 my-2">
                    <v-icon start color="success">mdi-account-tie</v-icon>
                    Usuario Administrador
                  </div>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="adminData.full_name"
                    label="Nombre Completo *"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required]"
                    prepend-inner-icon="mdi-account"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="adminData.email"
                    label="Email Administrador *"
                    type="email"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required, rules.email]"
                    prepend-inner-icon="mdi-email-outline"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="adminData.password"
                    label="Contraseña *"
                    :type="showPassword ? 'text' : 'password'"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required, rules.minLength(8)]"
                    prepend-inner-icon="mdi-lock"
                    :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append-inner="showPassword = !showPassword"
                  ></v-text-field>
                </v-col>

                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="confirmPassword"
                    label="Confirmar Contraseña *"
                    :type="showPassword ? 'text' : 'password'"
                    variant="outlined"
                    density="comfortable"
                    :rules="[rules.required, rules.passwordMatch]"
                    prepend-inner-icon="mdi-lock-check"
                  ></v-text-field>
                </v-col>

                <!-- INFORMACIÓN DE CONFIGURACIÓN -->
                <v-col cols="12" class="mt-2">
                  <v-alert type="info" variant="tonal">
                    <v-icon start>mdi-information</v-icon>
                    <strong>Configuración Automática</strong>
                    <div class="mt-2 text-body-2">
                      El nuevo tenant se creará con:
                      <ul class="mt-2 ml-4">
                        <li>12 unidades de medida predefinidas (Unidad, Kg, Metro, Litro, etc.)</li>
                        <li>3 impuestos básicos (IVA 19%, 5%, 0%)</li>
                        <li>5 métodos de pago comunes (Efectivo, Tarjetas, Transferencia, etc.)</li>
                        <li>4 roles con permisos (Administrador, Gerente, Cajero, Bodeguero)</li>
                        <li>1 ubicación principal y 1 caja registradora</li>
                      </ul>
                    </div>
                    <div class="mt-2 text-body-2">
                      <v-icon start size="small">mdi-rocket-launch</v-icon>
                      Después de crear el tenant, se abrirá un <strong>Asistente de Configuración</strong> para guiar los pasos restantes.
                    </div>
                  </v-alert>
                </v-col>
              </v-row>
            </v-form>
          </v-card-text>

          <v-card-actions class="pa-4">
            <v-btn
              variant="text"
              @click="resetForm"
            >
              Limpiar
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn
              color="primary"
              variant="elevated"
              size="large"
              :loading="creating"
              @click="createTenant"
              prepend-icon="mdi-plus"
            >
              Crear Tenant
            </v-btn>
          </v-card-actions>
        </v-window-item>

        <!-- TAB: LISTA DE TENANTS -->
        <v-window-item value="list">
          <v-card-text>
            <ListView
              title="Lista de Tenants"
              icon="mdi-office-building-multiple"
              :items="tenants"
              :total-items="tenants.length"
              :loading="loadingTenants"
              :page-size="12"
              item-key="tenant_id"
              title-field="name"
              subtitle-field="email"
              avatar-icon="mdi-domain"
              avatar-color="primary"
              empty-message="No hay tenants registrados"
              :editable="false"
              :deletable="false"
              :show-create-button="false"
              :client-side="true"
              :table-columns="tenantTableColumns"
              :search-fields="['name', 'tax_id', 'email', 'legal_name']"
              view-storage-key="superadmin-tenants"
            >
              <template #filters>
                <div class="d-flex align-center justify-space-between flex-wrap ga-3">
                  <div class="text-caption text-medium-emphasis">
                    Gestiona tenants activos e inactivos desde una sola vista.
                  </div>
                  <v-btn
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-refresh"
                    @click="loadTenants"
                    :loading="loadingTenants"
                  >
                    Actualizar
                  </v-btn>
                </div>
              </template>

              <template #subtitle="{ item }">
                {{ [item.tax_id ? `NIT: ${item.tax_id}` : null, item.email].filter(Boolean).join(' • ') }}
              </template>

              <template #content="{ item }">
                <div class="mt-2 d-flex flex-wrap ga-2">
                  <v-chip
                    :color="item.is_active ? 'success' : 'error'"
                    size="small"
                    variant="flat"
                  >
                    {{ item.is_active ? 'Activo' : 'Inactivo' }}
                  </v-chip>
                  <v-chip size="small" variant="tonal">
                    Creado: {{ formatDate(item.created_at) }}
                  </v-chip>
                </div>
              </template>

              <template #table-cell-is_active="{ item }">
                <v-chip
                  :color="item.is_active ? 'success' : 'error'"
                  size="small"
                  variant="flat"
                >
                  {{ item.is_active ? 'Activo' : 'Inactivo' }}
                </v-chip>
              </template>

              <template #table-cell-created_at="{ item }">
                {{ formatDate(item.created_at) }}
              </template>

              <template #actions="{ item }">
                <v-btn
                  size="small"
                  variant="text"
                  color="primary"
                  @click.stop="viewTenantTemplate(item.tenant_id)"
                >
                  Ver Config
                </v-btn>
              </template>
            </ListView>
          </v-card-text>
        </v-window-item>
      </v-window>
    </v-card>

    <!-- Dialog de resultados -->
    <v-dialog v-model="resultDialog" max-width="600">
      <v-card>
        <v-card-title class="bg-success">
          <v-icon start color="white">mdi-check-circle</v-icon>
          <span class="text-white">Tenant Creado Exitosamente</span>
        </v-card-title>
        <v-card-text class="pa-4">
          <v-list density="compact">
            <v-list-item>
              <v-list-item-title class="font-weight-bold">Tenant ID</v-list-item-title>
              <v-list-item-subtitle>{{ createdResult.tenant_id }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title class="font-weight-bold">Usuario ID</v-list-item-title>
              <v-list-item-subtitle>{{ createdResult.user_id }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title class="font-weight-bold">Sede ID</v-list-item-title>
              <v-list-item-subtitle>{{ createdResult.location_id }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item>
              <v-list-item-title class="font-weight-bold">Caja ID</v-list-item-title>
              <v-list-item-subtitle>{{ createdResult.register_id }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <v-alert type="success" variant="tonal" class="mt-4">
            {{ createdResult.message }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="closeResultDialog">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarMessage }}
    </v-snackbar>
    </div> <!-- Cierre del contenedor v-else con key -->
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSuperAdmin } from '@/composables/useSuperAdmin'
import ListView from '@/components/ListView.vue'
import tenantsService from '@/services/tenants.service'
import { humanizeAppError } from '@/utils/appErrors'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { canManageTenants, superAdminInfo, isResolving } = useSuperAdmin()

// Agregar estabilidad a los cambios reactivos
const isInitialized = ref(false)

onMounted(() => {
  // Marcar como inicializado después de la primera carga
  setTimeout(() => {
    isInitialized.value = true
  }, 100)
  // Cargar lista de tenants al inicializar 
  loadTenants()
})

const tab = ref('create')
const form = ref(null)
const creating = ref(false)
const showPassword = ref(false)
const resultDialog = ref(false)
const createdResult = ref({})
const loadingTenants = ref(false)
const tenants = ref([])

const tenantData = ref({
  name: '',
  legal_name: '',
  tax_id: '',
  email: '',
  phone: '',
  address: '',
  invoice_prefix: 'FAC',
  invoice_start_number: 1
})

const adminData = ref({
  full_name: '',
  email: '',
  password: ''
})

const confirmPassword = ref('')

const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

const tenantTableColumns = [
  { title: 'NIT', key: 'tax_id', width: '150px' },
  { title: 'Email', key: 'email', width: '220px' },
  { title: 'Estado', key: 'is_active', width: '140px' },
  { title: 'Creado', key: 'created_at', width: '180px' }
]

const rules = {
  required: v => !!v || 'Campo requerido',
  email: v => /.+@.+\..+/.test(v) || 'Email inválido',
  minLength: (min) => v => (v && v.length >= min) || `Mínimo ${min} caracteres`,
  passwordMatch: v => v === adminData.value.password || 'Las contraseñas no coinciden'
}

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

const createTenant = async () => {
  if (!form.value) {
    showMsg('Error: formulario no inicializado', 'error')
    return
  }

  const { valid } = await form.value.validate()
  if (!valid) {
    showMsg('Por favor completa todos los campos requeridos', 'error')
    return
  }

  creating.value = true

  try {
    const result = await tenantsService.createTenant(
      tenantData.value,
      adminData.value
    )

    if (result.success) {
      createdResult.value = result.data
      resultDialog.value = true
      resetForm()
      showMsg('Tenant creado exitosamente', 'success')
    } else {
      showMsg(`Error: ${result.error}`, 'error')
    }
  } catch (error) {
    console.error('Error creando tenant:', error)
    showMsg(`Error inesperado: ${error.message}`, 'error')
  } finally {
    creating.value = false
  }
}

const resetForm = () => {
  tenantData.value = {
    name: '',
    legal_name: '',
    tax_id: '',
    email: '',
    phone: '',
    address: '',
    invoice_prefix: 'FAC',
    invoice_start_number: 1
  }
  adminData.value = {
    full_name: '',
    email: '',
    password: ''
  }
  confirmPassword.value = ''
  form.value?.resetValidation()
}

const loadTenants = async () => {
  loadingTenants.value = true
  try {
    const result = await tenantsService.getAllTenants()
    if (result.success) {
      tenants.value = result.data
    } else {
      showMsg(`Error: ${result.error}`, 'error')
    }
  } finally {
    loadingTenants.value = false
  }
}

const viewTenantTemplate = async (tenantId) => {
  const result = await tenantsService.getTenantTemplate(tenantId)
  if (result.success) {
    console.log('Template del tenant:', result.data)
    showMsg('Template generado (ver consola)', 'info')
  } else {
    showMsg(`Error: ${result.error}`, 'error')
  }
}

const closeResultDialog = () => {
  resultDialog.value = false
  createdResult.value = {}
  tab.value = 'list'
  loadTenants()
}

const showMsg = (msg, color = 'success') => {
  snackbarMessage.value = color === 'error'
    ? humanizeAppError(msg, { defaultMessage: 'Ocurrió un error en gestión de tenants.' })
    : msg
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(() => {
  // Ya se carga desde el primer onMounted
})
</script>
