<template>
  <div class="login-root" :class="{ 'login-dark': isDark }">
    <section class="login-page">
      <div class="bg-orb orb-a"></div>
      <div class="bg-orb orb-b"></div>

      <v-container class="fill-height" fluid>
        <v-row class="fill-height" align="center" justify="center">
          <v-col cols="12" lg="10" xl="9">
            <v-sheet class="login-shell" rounded="xl" elevation="0">
              <div class="brand-panel d-none d-md-flex">
                <div class="brand-inner">
                  <img
                    src="/branding/logo-login.png"
                    alt="OfirOne"
                    class="brand-logo"
                  >
                  <div class="brand-kicker">{{ t('login.kicker') }}</div>
                  <h1 class="brand-title">{{ t('login.brandTitle') }}</h1>
                  <p class="brand-copy">
                    {{ t('login.brandCopy') }}
                  </p>
                  <div class="brand-points">
                    <v-chip size="small" variant="flat" class="brand-chip">
                      <v-icon start>mdi-shield-check</v-icon>
                      {{ t('login.tenantSecurity') }}
                    </v-chip>
                    <v-chip size="small" variant="flat" class="brand-chip">
                      <v-icon start>mdi-sync-circle</v-icon>
                      {{ t('login.realtime') }}
                    </v-chip>
                    <v-chip size="small" variant="flat" class="brand-chip">
                      <v-icon start>mdi-robot-outline</v-icon>
                      {{ t('login.operationalAI') }}
                    </v-chip>
                  </div>
                </div>
              </div>

              <div class="form-panel">
                <template v-if="recoveryMode">
                  <div class="form-header">
                    <div class="form-logo">
                      <v-icon size="26">mdi-lock-reset</v-icon>
                    </div>
                    <div>
                      <h2 class="form-title">{{ t('login.newPasswordTitle') }}</h2>
                      <p class="form-subtitle">{{ t('login.newPasswordSubtitle') }}</p>
                    </div>
                  </div>

                  <v-form @submit.prevent="handleUpdatePassword">
                    <v-text-field
                      v-model="recoveryPassword"
                      :label="t('login.newPassword')"
                      prepend-inner-icon="mdi-lock-outline"
                      :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                      :type="showPassword ? 'text' : 'password'"
                      variant="outlined"
                      required
                      class="mb-2 login-input"
                      @click:append-inner="showPassword = !showPassword"
                    ></v-text-field>

                    <v-text-field
                      v-model="recoveryPasswordConfirm"
                      :label="t('login.confirmPassword')"
                      prepend-inner-icon="mdi-lock-check-outline"
                      :type="showPassword ? 'text' : 'password'"
                      variant="outlined"
                      required
                      class="mb-3 login-input"
                    ></v-text-field>

                    <v-btn
                      type="submit"
                      color="primary"
                      size="large"
                      block
                      :loading="loading"
                      class="login-btn"
                    >
                      <v-icon start>mdi-content-save-check</v-icon>
                      {{ t('login.savePassword') }}
                    </v-btn>

                    <v-alert
                      v-if="recoveryMessage"
                      :type="recoverySuccess ? 'success' : 'error'"
                      variant="tonal"
                      class="mt-4"
                    >
                      {{ recoveryMessage }}
                    </v-alert>
                  </v-form>
                </template>

                <template v-else>
                  <div class="form-header">
                    <div class="form-logo form-logo--composite">
                      <img
                        src="/branding/logo-login-text-mini.png"
                        alt="OfirOne"
                        class="form-logo-composite-image"
                      >
                    </div>
                    <div>
                      <h2 class="form-title">{{ t('login.signInTitle') }}</h2>
                      <p class="form-subtitle">{{ t('login.signInSubtitle') }}</p>
                    </div>
                  </div>

                  <v-form @submit.prevent="handleLogin" ref="loginForm">
                    <v-text-field
                      v-model="loginData.email"
                      :label="t('login.email')"
                      prepend-inner-icon="mdi-email-outline"
                      variant="outlined"
                      type="email"
                      :rules="[rules.required, rules.email]"
                      required
                      class="mb-2 login-input"
                    ></v-text-field>

                    <v-text-field
                      v-model="loginData.password"
                      :label="t('login.password')"
                      prepend-inner-icon="mdi-lock-outline"
                      :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                      :type="showPassword ? 'text' : 'password'"
                      variant="outlined"
                      :rules="[rules.required]"
                      required
                      class="mb-2 login-input"
                      @click:append-inner="showPassword = !showPassword"
                    ></v-text-field>

                    <div class="form-actions-row">
                      <v-checkbox
                        v-model="rememberMe"
                        :label="t('login.rememberMe')"
                        density="compact"
                        hide-details
                      ></v-checkbox>
                      <v-btn
                        variant="text"
                        size="small"
                        color="primary"
                        class="login-link-btn"
                        @click="showResetPassword = true"
                      >
                        {{ t('login.forgotPassword') }}
                      </v-btn>
                    </div>

                    <v-btn
                      type="submit"
                      color="primary"
                      size="large"
                      block
                      :loading="loading"
                      class="login-btn"
                    >
                      <v-icon start>mdi-login</v-icon>
                      {{ t('login.enterSystem') }}
                    </v-btn>

                    <v-alert
                      v-if="loginError"
                      type="error"
                      variant="tonal"
                      closable
                      class="mt-4"
                      @click:close="loginError = ''"
                    >
                      {{ loginError }}
                    </v-alert>
                  </v-form>
                </template>
              </div>
            </v-sheet>
          </v-col>
        </v-row>
      </v-container>
    </section>

    <v-dialog v-model="showResetPassword" max-width="500">
      <v-card rounded="xl">
        <v-card-title>
          <v-icon start>mdi-lock-reset</v-icon>
          {{ t('login.resetPasswordTitle') }}
        </v-card-title>
        <v-card-text>
          <v-form @submit.prevent="handleResetPassword">
            <v-text-field
              v-model="resetEmail"
              :label="t('login.email')"
              prepend-inner-icon="mdi-email-outline"
              variant="outlined"
              type="email"
              class="login-input"
              required
            ></v-text-field>

            <v-alert
              v-if="resetMessage"
              :type="resetSuccess ? 'success' : 'error'"
              variant="tonal"
              class="mb-4"
            >
              {{ resetMessage }}
            </v-alert>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="showResetPassword = false">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            @click="handleResetPassword"
            :loading="loading"
          >
            {{ t('login.send') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useTenant } from '@/composables/useTenant'
import { useTheme } from '@/composables/useTheme'
import { useSuperAdmin } from '@/composables/useSuperAdmin'
import { useI18n } from '@/i18n'

const router = useRouter()
const { signIn, resetPassword, updatePassword, loading } = useAuth()
const { saveTenant } = useTenant()
const { syncThemeFromTenant, ensureThemeForUser, isDark } = useTheme()
const { canManageTenants } = useSuperAdmin()
const { t } = useI18n()

const showPassword = ref(false)
const rememberMe = ref(false)
const showResetPassword = ref(false)
const recoveryMode = ref(false)

const loginData = ref({
  email: '',
  password: ''
})

const resetEmail = ref('')
const loginError = ref('')
const resetMessage = ref('')
const resetSuccess = ref(false)
const recoveryPassword = ref('')
const recoveryPasswordConfirm = ref('')
const recoveryMessage = ref('')
const recoverySuccess = ref(false)

const loginForm = ref(null)

const rules = {
  required: value => !!value || t('login.requiredField'),
  email: value => {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return pattern.test(value) || t('login.invalidEmail')
  }
}

const handleLogin = async () => {
  const { valid } = await loginForm.value.validate()
  if (!valid) return

  loginError.value = ''

  const result = await signIn(loginData.value.email, loginData.value.password)

  if (result.success) {
    if (result.tenant) {
      saveTenant({
        tenant_id: result.tenant.tenant_id,
        tenant_name: result.tenant.name,
        currency_code: result.tenant.currency_code
      })

      await syncThemeFromTenant(result.tenant.tenant_id, result.data?.user?.id || null)
    } else {
      await ensureThemeForUser({ authUserId: result.data?.user?.id || null })
    }

    if (canManageTenants.value && !result.profile) {
      router.push('/tenant-management')
      return
    }

    router.push('/')
  } else {
    loginError.value = result.error || t('login.loginError')
  }
}

const handleResetPassword = async () => {
  const normalizedEmail = (resetEmail.value || '').trim()
  if (!normalizedEmail) return
  if (rules.email(normalizedEmail) !== true) {
    resetSuccess.value = false
    resetMessage.value = t('login.invalidEmail')
    return
  }

  resetMessage.value = ''

  const result = await resetPassword(normalizedEmail)

  if (result.success) {
    resetSuccess.value = true
    resetMessage.value = t('login.resetSent')
  } else {
    resetSuccess.value = false
    resetMessage.value = result.error || t('login.sendMailError')
  }
}

const handleUpdatePassword = async () => {
  recoveryMessage.value = ''

  if (!recoveryPassword.value || recoveryPassword.value.length < 6) {
    recoverySuccess.value = false
    recoveryMessage.value = t('login.minPassword')
    return
  }

  if (recoveryPassword.value !== recoveryPasswordConfirm.value) {
    recoverySuccess.value = false
    recoveryMessage.value = t('login.passwordMismatch')
    return
  }

  const result = await updatePassword(recoveryPassword.value)
  if (!result.success) {
    recoverySuccess.value = false
    recoveryMessage.value = result.error || t('login.updatePasswordError')
    return
  }

  recoverySuccess.value = true
  recoveryMessage.value = t('login.passwordUpdated')
  setTimeout(() => {
    router.push('/')
  }, 1200)
}

onMounted(async () => {
  await ensureThemeForUser({ authUserId: null })
  const hash = (window.location.hash || '').toLowerCase()
  const search = (window.location.search || '').toLowerCase()
  recoveryMode.value =
    hash.includes('type=recovery') ||
    search.includes('type=recovery') ||
    (hash.includes('access_token=') && hash.includes('refresh_token='))
})
</script>

<style scoped>
.login-root {
  min-height: 100%;
}

.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 10% 15%, rgba(10, 79, 211, 0.2), transparent 30%),
    radial-gradient(circle at 88% 12%, rgba(245, 158, 11, 0.2), transparent 32%),
    radial-gradient(circle at 88% 88%, rgba(22, 163, 74, 0.18), transparent 32%),
    linear-gradient(135deg, #f3f8ff 0%, #ecf6ff 48%, #eef9f2 100%);
}

.login-page :deep(.v-container) {
  position: relative;
  z-index: 2;
  min-height: 100vh;
}

.bg-orb {
  position: absolute;
  z-index: 0;
  border-radius: 999px;
  filter: blur(20px);
  opacity: 0.5;
  pointer-events: none;
}

.orb-a {
  width: 260px;
  height: 260px;
  top: -80px;
  right: -80px;
  background: #0a4fd3;
}

.orb-b {
  width: 300px;
  height: 300px;
  bottom: -110px;
  left: -80px;
  background: #14a04a;
}

.login-shell {
  min-height: 620px;
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  background: rgba(var(--v-theme-surface), 0.9);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(var(--v-theme-outline), 0.22);
  box-shadow: 0 28px 64px rgba(14, 36, 64, 0.14);
  overflow: hidden;
}

.brand-panel {
  background: linear-gradient(160deg, #0a45b8 0%, #0a65d1 42%, #11a44a 100%);
  color: #fff;
  display: flex;
  justify-content: center;
  padding: 48px;
}

.brand-inner {
  max-width: 420px;
}

.brand-logo {
  width: 220px;
  max-width: 100%;
  display: block;
  margin: 0 auto 18px;
  filter: drop-shadow(0 14px 24px rgba(8, 35, 95, 0.35));
}

.brand-kicker {
  letter-spacing: 1.8px;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.9;
  margin-bottom: 12px;
}

.brand-title {
  font-size: clamp(28px, 3vw, 44px);
  line-height: 1.08;
  margin-bottom: 16px;
  font-weight: 800;
}

.brand-copy {
  font-size: 16px;
  line-height: 1.55;
  opacity: 0.94;
  margin-bottom: 24px;
}

.brand-points {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.brand-chip {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #ffffff !important;
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.brand-chip :deep(.v-icon) {
  color: #ffffff !important;
}

.form-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40px 38px;
  max-width: 460px;
  margin: 0 auto;
  width: 100%;
  color: rgb(var(--v-theme-on-surface));
}

.form-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.form-logo {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #0a4fd3;
  background: linear-gradient(145deg, rgba(10, 79, 211, 0.13), rgba(22, 163, 74, 0.13));
  border: 1px solid rgba(10, 79, 211, 0.18);
}

.form-logo-image {
  width: 34px;
  height: 34px;
  object-fit: contain;
}

.form-logo--composite {
  width: auto;
  height: auto;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
}

.form-logo-composite-image {
  width: 72px;
  height: 72px;
  object-fit: contain;
  display: block;
}

.form-title {
  font-size: 28px;
  line-height: 1.1;
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
}

.form-subtitle {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px;
}

.login-root :deep(.login-input .v-field) {
  background-color: rgba(var(--v-theme-surface), 0.94);
}

.login-root :deep(.login-input .v-label) {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.login-root :deep(.login-input .v-field--focused .v-label),
.login-root :deep(.login-input .v-field--active .v-label),
.login-root :deep(.login-input .v-label.v-field-label--floating) {
  color: rgb(var(--v-theme-primary));
}

.login-root :deep(.login-input .v-field__outline) {
  color: rgba(var(--v-theme-on-surface), 0.28);
}

.login-root :deep(.login-input .v-field--focused .v-field__outline) {
  color: rgb(var(--v-theme-primary));
}

.login-root :deep(.login-input input) {
  color: rgb(var(--v-theme-on-surface));
  caret-color: rgb(var(--v-theme-on-surface));
}

.login-root :deep(.login-input .v-field__input) {
  color: rgb(var(--v-theme-on-surface));
}

/* Normaliza autofill para que no rompa dark/light y evita fondo amarillo del navegador */
.login-root :deep(.login-input input:-webkit-autofill),
.login-root :deep(.login-input input:-webkit-autofill:hover),
.login-root :deep(.login-input input:-webkit-autofill:focus),
.login-root :deep(.login-input textarea:-webkit-autofill),
.login-root :deep(.login-input textarea:-webkit-autofill:hover),
.login-root :deep(.login-input textarea:-webkit-autofill:focus) {
  -webkit-text-fill-color: rgb(var(--v-theme-on-surface)) !important;
  caret-color: rgb(var(--v-theme-on-surface)) !important;
  box-shadow: 0 0 0 1000px rgba(var(--v-theme-surface), 0.96) inset !important;
  transition: background-color 9999s ease-out 0s;
}

.form-actions-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.login-btn {
  min-height: 48px;
  font-weight: 700;
  letter-spacing: 0.2px;
  box-shadow: 0 12px 24px rgba(10, 79, 211, 0.26);
}

.login-link-btn {
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.login-root.login-dark .login-page {
  background:
    radial-gradient(circle at 10% 15%, rgba(29, 78, 216, 0.26), transparent 32%),
    radial-gradient(circle at 90% 88%, rgba(34, 197, 94, 0.2), transparent 32%),
    radial-gradient(circle at 88% 12%, rgba(245, 158, 11, 0.2), transparent 30%),
    linear-gradient(135deg, #0d1424 0%, #111f37 100%);
}

.login-root.login-dark .login-shell {
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 28px 64px rgba(0, 0, 0, 0.4);
}

.login-root.login-dark .brand-chip {
  background: rgba(255, 255, 255, 0.13) !important;
  color: #ffffff !important;
}

.login-root.login-dark :deep(.login-input .v-field) {
  background-color: rgba(20, 29, 45, 0.88);
}

@media (max-width: 960px) {
  .login-shell {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .form-panel {
    padding: 28px 20px;
    max-width: 100%;
  }

  .form-title {
    font-size: 24px;
  }

  .form-logo-composite-image {
    width: 64px;
    height: 64px;
  }
}

@media (max-width: 600px) {
  .form-actions-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
