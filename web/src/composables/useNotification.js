import { ref } from 'vue'
import { humanizeAppError } from '@/utils/appErrors'

const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')

export function useNotification() {
  const showSuccess = (message) => {
    snackbarMessage.value = message
    snackbarColor.value = 'success'
    snackbar.value = true
  }

  const showError = (message) => {
    snackbarMessage.value = humanizeAppError(message)
    snackbarColor.value = 'error'
    snackbar.value = true
  }

  const showWarning = (message) => {
    snackbarMessage.value = message
    snackbarColor.value = 'warning'
    snackbar.value = true
  }

  const showInfo = (message) => {
    snackbarMessage.value = message
    snackbarColor.value = 'info'
    snackbar.value = true
  }

  const show = (message, color = 'success') => {
    snackbarMessage.value = color === 'error' ? humanizeAppError(message) : message
    snackbarColor.value = color
    snackbar.value = true
  }

  const hide = () => {
    snackbar.value = false
  }

  return {
    // State (para binding con v-snackbar)
    snackbar,
    snackbarMessage,
    snackbarColor,
    
    // Methods
    showSuccess,
    showError,
    showWarning,
    showInfo,
    show,
    hide
  }
}
