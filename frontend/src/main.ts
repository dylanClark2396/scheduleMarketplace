import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Aura from '@primeuix/themes/aura'
import 'primeicons/primeicons.css'

const app = createApp(App)

app.use(router).use(ConfirmationService).use(ToastService).use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: 'light',
      cssLayer: false,
    },
  },
})

app.mount('#app')
