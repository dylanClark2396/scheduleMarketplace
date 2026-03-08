<template>
  <div class="login-page">
    <Card class="login-card">
      <template #header>
        <div class="login-logo">
          <i class="pi pi-chart-bar" style="font-size: 3rem; color: var(--p-primary-color)" />
        </div>
      </template>
      <template #title>Schedule Marketplace</template>
      <template #subtitle>Sign in to manage your program's schedule</template>
      <template #content>
        <Button
          label="Sign In"
          icon="pi pi-sign-in"
          class="w-full"
          size="large"
          @click="login"
        />
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
const { login } = useAuth()
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--p-surface-50);
}

.login-card {
  width: 380px;
  text-align: center;
}

.login-logo {
  padding: 2rem 0 0.5rem;
}
</style>
