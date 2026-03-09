<template>
  <div class="layout">
    <NavBar />

    <div class="page-content">
      <div class="page-header">
        <h1>Dashboard</h1>
        <span class="season-badge">Season: {{ CURRENT_SEASON }}</span>
      </div>

      <div class="stats-grid">
        <Card>
          <template #content>
            <div class="stat-card">
              <i class="pi pi-sliders-h stat-icon" style="color: var(--p-blue-500)" />
              <div>
                <div class="stat-value">{{ mySchedule?.games.length ?? '—' }}</div>
                <div class="stat-label">Games Scheduled</div>
              </div>
            </div>
          </template>
        </Card>

        <Card>
          <template #content>
            <div class="stat-card">
              <i class="pi pi-calendar-times stat-icon" style="color: var(--p-orange-500)" />
              <div>
                <div class="stat-value">{{ mySchedule?.openDates.length ?? '—' }}</div>
                <div class="stat-label">Open Dates</div>
              </div>
            </div>
          </template>
        </Card>

        <Card>
          <template #content>
            <div class="stat-card">
              <i class="pi pi-chart-bar stat-icon" style="color: var(--p-green-500)" />
              <div>
                <div class="stat-value">
                  {{ mySchedule?.strengthOfSchedule?.toFixed(1) ?? '—' }}
                </div>
                <div class="stat-label">Current SOS</div>
              </div>
            </div>
          </template>
        </Card>

        <Card>
          <template #content>
            <div class="stat-card">
              <i class="pi pi-shopping-bag stat-icon" style="color: var(--p-purple-500)" />
              <div>
                <div class="stat-value">{{ openListingsCount }}</div>
                <div class="stat-label">Open Marketplace Listings</div>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <div class="dashboard-grid">
        <Card>
          <template #title>Quick Actions</template>
          <template #content>
            <div class="quick-actions">
              <Button
                label="Estimate SOS"
                icon="pi pi-sliders-h"
                @click="$router.push('/estimator')"
              />
              <Button
                label="Post to Marketplace"
                icon="pi pi-plus"
                severity="success"
                @click="$router.push('/marketplace')"
              />
              <Button
                label="Import Schedule"
                icon="pi pi-upload"
                severity="secondary"
                @click="$router.push('/import')"
              />
              <Button
                label="Browse Schedules"
                icon="pi pi-calendar"
                severity="secondary"
                @click="$router.push('/schedules')"
              />
            </div>
          </template>
        </Card>

        <Card>
          <template #title>Recent Marketplace Activity</template>
          <template #content>
            <div v-if="recentListings.length === 0" class="empty-state">
              <i class="pi pi-inbox" />
              <p>No recent listings</p>
            </div>
            <div v-else class="recent-listings">
              <div v-for="l in recentListings" :key="l.id" class="recent-listing-row">
                <Tag :value="l.type.toUpperCase()" :severity="l.type === 'request' ? 'warn' : 'success'" />
                <span class="listing-team">{{ l.teamName }}</span>
                <span class="listing-date">{{ l.date }}</span>
              </div>
            </div>
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import NavBar from '@/components/NavBar.vue'
import { useApi } from '@/composables/useApi'
import { CURRENT_SEASON } from '@/constants'
import type { TeamSchedule, MarketplaceListing } from '@/models'

const api = useApi()

const mySchedule = ref<TeamSchedule | null>(null)
const recentListings = ref<MarketplaceListing[]>([])

const openListingsCount = computed(() =>
  recentListings.value.filter(l => l.status === 'open').length
)

onMounted(async () => {
  try {
    const [schedules, listings] = await Promise.all([
      api.getSchedules(),
      api.getListings({ status: 'open' }),
    ])
    mySchedule.value = schedules[0] ?? null
    recentListings.value = listings.slice(0, 5)
  } catch {
    // handled gracefully — UI shows dashes
  }
})
</script>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.page-content {
  flex: 1;
  padding: 1.5rem 2rem;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.page-header h1 {
  margin: 0;
  font-size: 1.6rem;
}

.season-badge {
  background: var(--p-primary-100);
  color: var(--p-primary-700);
  padding: 0.2rem 0.8rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
}

:deep(.p-card) {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-icon {
  font-size: 2rem;
  flex-shrink: 0;
}

.stat-value {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  margin-top: 0.25rem;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .quick-actions {
    grid-template-columns: 1fr;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--p-text-muted-color);
  padding: 1rem;
}

.empty-state i {
  font-size: 2rem;
}

.recent-listings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recent-listing-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--p-surface-100);
}

.listing-team {
  font-weight: 600;
  flex: 1;
}

.listing-date {
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
}
</style>
