<template>
  <div class="navbar">
    <div class="navbar-brand">
      <i class="pi pi-chart-bar" style="font-size: 1.4rem; color: var(--p-primary-color)" />
      <span class="brand-text">Schedule Marketplace</span>
    </div>

    <div class="navbar-links">
      <router-link to="/" class="nav-link" :class="{ active: route.path === '/' }">
        <i class="pi pi-home" />
        <span>Dashboard</span>
      </router-link>
      <router-link to="/estimator" class="nav-link" :class="{ active: route.path === '/estimator' }">
        <i class="pi pi-sliders-h" />
        <span>SOS Estimator</span>
      </router-link>
      <router-link to="/marketplace" class="nav-link" :class="{ active: route.path === '/marketplace' }">
        <i class="pi pi-shopping-bag" />
        <span>Marketplace</span>
      </router-link>
      <router-link to="/schedules" class="nav-link" :class="{ active: route.path === '/schedules' }">
        <i class="pi pi-calendar" />
        <span>Schedules</span>
      </router-link>
      <router-link to="/import" class="nav-link" :class="{ active: route.path === '/import' }">
        <i class="pi pi-upload" />
        <span>Import</span>
      </router-link>
    </div>

    <div class="navbar-actions">
      <Button icon="pi pi-sign-out" text rounded @click="handleLogout" v-tooltip="'Sign out'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const router = useRouter()
const { logout } = useAuth()

function handleLogout() {
  logout()
  router.push('/login')
}
</script>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0 1.5rem;
  height: 60px;
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
  position: sticky;
  top: 0;
  z-index: 100;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: max-content;
}

.brand-text {
  font-weight: 700;
  font-size: 1.1rem;
}

.navbar-links {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  text-decoration: none;
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
  transition: background 0.15s, color 0.15s;
}

.nav-link:hover {
  background: var(--p-surface-100);
  color: var(--p-text-color);
}

.nav-link.active {
  background: var(--p-primary-50);
  color: var(--p-primary-color);
  font-weight: 600;
}

.navbar-actions {
  margin-left: auto;
}
</style>
