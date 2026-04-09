import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import 'vuetify/styles'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#0A4FD3',
          secondary: '#12A84B',
          accent: '#FFAE1A',
          error: '#E53935',
          info: '#1E88E5',
          success: '#16A34A',
          warning: '#F59E0B',
        },
      },
      dark: {
        colors: {
          primary: '#3D7DFF',
          secondary: '#3BCB72',
          accent: '#FFBF47',
          error: '#F87171',
          info: '#60A5FA',
          success: '#4ADE80',
          warning: '#FBBF24',
        },
      },
    },
  },
})

export default vuetify
