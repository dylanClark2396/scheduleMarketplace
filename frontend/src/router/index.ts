import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Dashboard',
      component: DashboardView,
    },
    {
      path: '/estimator',
      name: 'ScheduleEstimator',
      component: () => import('@/views/ScheduleEstimatorView.vue'),
    },
    {
      path: '/marketplace',
      name: 'Marketplace',
      component: () => import('@/views/MarketplaceView.vue'),
    },
    {
      path: '/schedules',
      name: 'MasterSchedule',
      component: () => import('@/views/MasterScheduleView.vue'),
    },
    {
      path: '/import',
      name: 'Import',
      component: () => import('@/views/ImportView.vue'),
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/callback',
      name: 'Callback',
      component: () => import('@/views/CallbackView.vue'),
    },
  ],
})

const PUBLIC_ROUTES = ['/login', '/callback']

router.beforeEach((to) => {
  const token = localStorage.getItem('access_token')
  if (!PUBLIC_ROUTES.includes(to.path) && !token) {
    return '/login'
  }
})

export default router
