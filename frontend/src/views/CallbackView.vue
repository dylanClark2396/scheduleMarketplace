<template>
  <div class="callback-page">
    <ProgressSpinner />
    <p>Signing you in...</p>
    <p v-if="error" class="error-text">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const { handleCallback } = useAuth()
const error = ref('')

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) {
    error.value = 'No authorization code found.'
    return
  }
  try {
    await handleCallback(code)
    router.replace('/')
  } catch (e) {
    error.value = 'Authentication failed. Please try again.'
  }
})
</script>

<style scoped>
.callback-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 1rem;
}

.error-text {
  color: var(--p-red-500);
}
</style>
