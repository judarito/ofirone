<template>
  <div>
    <v-card>
      <v-card-title class="text-h4 primary white--text">
        <v-icon left color="white" size="large">mdi-cog</v-icon>
        {{ t('settings.title') }}
      </v-card-title>
      <v-card-text class="pa-6">
        <v-row>
          <v-col cols="12" md="6">
            <v-card variant="outlined">
              <v-card-title>{{ t('settings.generalPreferences') }}</v-card-title>
              <v-card-text>
                <v-switch
                  v-model="settings.notifications"
                  :label="t('settings.enableNotifications')"
                  color="primary"
                ></v-switch>

                <v-switch
                  v-model="settings.darkMode"
                  :label="t('settings.darkMode')"
                  color="primary"
                ></v-switch>

                <v-switch
                  v-model="settings.autoSave"
                  :label="t('settings.autoSave')"
                  color="primary"
                ></v-switch>

                <v-select
                  v-model="selectedLanguage"
                  :items="languages"
                  item-title="label"
                  item-value="value"
                  :label="t('settings.language')"
                  variant="outlined"
                  class="mt-4"
                ></v-select>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card variant="outlined">
              <v-card-title>{{ t('settings.userProfile') }}</v-card-title>
              <v-card-text>
                <v-text-field
                  v-model="profile.name"
                  :label="t('settings.name')"
                  variant="outlined"
                  prepend-inner-icon="mdi-account"
                ></v-text-field>

                <v-text-field
                  v-model="profile.email"
                  :label="t('settings.email')"
                  variant="outlined"
                  prepend-inner-icon="mdi-email"
                  type="email"
                ></v-text-field>

                <v-text-field
                  v-model="profile.phone"
                  :label="t('settings.phone')"
                  variant="outlined"
                  prepend-inner-icon="mdi-phone"
                ></v-text-field>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12">
            <v-card variant="outlined">
              <v-card-title>{{ t('settings.appearance') }}</v-card-title>
              <v-card-text>
                <v-slider
                  v-model="settings.fontSize"
                  :label="t('settings.fontSize')"
                  :min="12"
                  :max="24"
                  :step="1"
                  thumb-label
                  color="primary"
                ></v-slider>

                <v-radio-group v-model="settings.sidebarPosition" inline>
                  <template v-slot:label>
                    <div>{{ t('settings.sidebarPosition') }}</div>
                  </template>
                  <v-radio :label="t('settings.left')" value="left"></v-radio>
                  <v-radio :label="t('settings.right')" value="right"></v-radio>
                </v-radio-group>

                <div class="mt-4">
                  <p class="mb-2">{{ t('settings.primaryColor') }}</p>
                  <v-chip-group v-model="settings.primaryColor">
                    <v-chip
                      v-for="color in colors"
                      :key="color.value"
                      :color="color.value"
                      :value="color.value"
                      label
                    >
                      {{ color.name }}
                    </v-chip>
                  </v-chip-group>
                </div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12">
            <v-btn color="primary" size="large" class="mr-2">
              <v-icon left>mdi-content-save</v-icon>
              {{ t('common.saveChanges') }}
            </v-btn>
            <v-btn color="error" variant="outlined" size="large">
              <v-icon left>mdi-cancel</v-icon>
              {{ t('common.cancel') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from '@/i18n'

const settings = ref({
  notifications: true,
  darkMode: false,
  autoSave: true,
  fontSize: 16,
  sidebarPosition: 'left',
  primaryColor: 'blue',
})

const profile = ref({
  name: 'Usuario demo',
  email: 'usuario@ejemplo.com',
  phone: '+1234567890',
})

const { t, locale, setLocale } = useI18n()

const selectedLanguage = computed({
  get: () => locale.value,
  set: (value) => setLocale(value)
})

const languages = computed(() => [
  { label: 'Español', value: 'es' },
  { label: 'English', value: 'en' }
])

const colors = computed(() => [
  { name: t('settings.colorBlue'), value: 'blue' },
  { name: t('settings.colorGreen'), value: 'green' },
  { name: t('settings.colorRed'), value: 'red' },
  { name: t('settings.colorPurple'), value: 'purple' },
  { name: t('settings.colorOrange'), value: 'orange' }
])

watch(locale, () => {
  if (profile.value.name === 'Usuario demo' || profile.value.name === 'Demo User') {
    profile.value.name = t('settings.demoUser')
  }
}, { immediate: true })
</script>
