<template>
  <div>
    <v-card>
      <v-card-title class="text-h4 primary white--text">
        <v-icon left color="white" size="large">mdi-login</v-icon>
        {{ t('auth.title') }}
      </v-card-title>
      <v-card-text class="pa-6">
        <v-row>
          <v-col cols="12" md="6">
            <v-card variant="outlined">
              <v-card-title>{{ t('auth.signIn') }}</v-card-title>
              <v-card-text>
                <v-form @submit.prevent="handleSignIn">
                  <v-text-field
                    v-model="signInForm.email"
                    :label="t('settings.email')"
                    variant="outlined"
                    prepend-inner-icon="mdi-email"
                    type="email"
                    required
                  ></v-text-field>

                  <v-text-field
                    v-model="signInForm.password"
                    :label="t('login.password')"
                    variant="outlined"
                    prepend-inner-icon="mdi-lock"
                    type="password"
                    required
                  ></v-text-field>

                  <v-btn
                    type="submit"
                    color="primary"
                    size="large"
                    block
                    :loading="loading"
                  >
                    <v-icon left>mdi-login</v-icon>
                    {{ t('auth.signIn') }}
                  </v-btn>
                </v-form>

                <v-alert
                  v-if="signInMessage"
                  :type="signInSuccess ? 'success' : 'error'"
                  class="mt-4"
                  closable
                  @click:close="signInMessage = ''"
                >
                  {{ signInMessage }}
                </v-alert>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card variant="outlined">
              <v-card-title>{{ t('auth.signUp') }}</v-card-title>
              <v-card-text>
                <v-form @submit.prevent="handleSignUp">
                  <v-text-field
                    v-model="signUpForm.email"
                    :label="t('settings.email')"
                    variant="outlined"
                    prepend-inner-icon="mdi-email"
                    type="email"
                    required
                  ></v-text-field>

                  <v-text-field
                    v-model="signUpForm.password"
                    :label="t('login.password')"
                    variant="outlined"
                    prepend-inner-icon="mdi-lock"
                    type="password"
                    required
                  ></v-text-field>

                  <v-btn
                    type="submit"
                    color="success"
                    size="large"
                    block
                    :loading="loading"
                  >
                    <v-icon left>mdi-account-plus</v-icon>
                    {{ t('auth.createAccount') }}
                  </v-btn>
                </v-form>

                <v-alert
                  v-if="signUpMessage"
                  :type="signUpSuccess ? 'success' : 'error'"
                  class="mt-4"
                  closable
                  @click:close="signUpMessage = ''"
                >
                  {{ signUpMessage }}
                </v-alert>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" v-if="user">
            <v-card color="success" dark>
              <v-card-title>
                <v-icon left>mdi-account-check</v-icon>
                {{ t('auth.authenticatedUser') }}
              </v-card-title>
              <v-card-text>
                <p><strong>{{ t('settings.email') }}:</strong> {{ user.email }}</p>
                <p><strong>ID:</strong> {{ user.id }}</p>
                <p><strong>{{ t('auth.createdAt') }}:</strong> {{ new Date(user.created_at).toLocaleString() }}</p>
                
                <v-btn
                  color="white"
                  variant="outlined"
                  class="mt-4"
                  @click="handleSignOut"
                >
                  <v-icon left>mdi-logout</v-icon>
                  {{ t('app.logout') }}
                </v-btn>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12">
            <v-card variant="outlined">
              <v-card-title>
                <v-icon left>mdi-database</v-icon>
                {{ t('auth.connectionStatus') }}
              </v-card-title>
              <v-card-text>
                <v-list>
                  <v-list-item>
                    <template v-slot:prepend>
                      <v-icon :color="supabaseConnected ? 'success' : 'error'">
                        {{ supabaseConnected ? 'mdi-check-circle' : 'mdi-close-circle' }}
                      </v-icon>
                    </template>
                    <v-list-item-title>
                      {{ supabaseConnected ? t('auth.connected') : t('auth.notConnected') }}
                    </v-list-item-title>
                    <v-list-item-subtitle>
                      URL: {{ supabaseUrl }}
                    </v-list-item-subtitle>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSupabase } from '@/plugins/supabase'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const { supabase, auth } = useSupabase()

const loading = ref(false)
const user = ref(null)
const supabaseConnected = ref(false)
const supabaseUrl = ref(import.meta.env.VITE_SUPABASE_URL)

const signInForm = ref({
  email: '',
  password: ''
})

const signUpForm = ref({
  email: '',
  password: ''
})

const signInMessage = ref('')
const signInSuccess = ref(false)
const signUpMessage = ref('')
const signUpSuccess = ref(false)

const handleSignIn = async () => {
  loading.value = true
  signInMessage.value = ''
  
  try {
    const { data, error } = await auth.signIn(signInForm.value.email, signInForm.value.password)
    
    if (error) throw error
    
    signInSuccess.value = true
    signInMessage.value = t('auth.signInSuccess')
    user.value = data.user
    signInForm.value.email = ''
    signInForm.value.password = ''
  } catch (error) {
    signInSuccess.value = false
    signInMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const handleSignUp = async () => {
  loading.value = true
  signUpMessage.value = ''
  
  try {
    const { data, error } = await auth.signUp(signUpForm.value.email, signUpForm.value.password)
    
    if (error) throw error
    
    signUpSuccess.value = true
    signUpMessage.value = t('auth.signUpSuccess')
    signUpForm.value.email = ''
    signUpForm.value.password = ''
  } catch (error) {
    signUpSuccess.value = false
    signUpMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const handleSignOut = async () => {
  try {
    await auth.signOut()
    user.value = null
    signInMessage.value = t('auth.signOutSuccess')
    signInSuccess.value = true
  } catch (error) {
    signInMessage.value = error.message
    signInSuccess.value = false
  }
}

const checkUser = async () => {
  try {
    const { data } = await auth.getUser()
    if (data.user) {
      user.value = data.user
    }
    supabaseConnected.value = true
  } catch (error) {
    console.error('Error al verificar usuario:', error)
    supabaseConnected.value = false
  }
}

onMounted(() => {
  checkUser()
  
  // Escuchar cambios en el estado de autenticación
  auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      user.value = session.user
    } else {
      user.value = null
    }
  })
})
</script>
