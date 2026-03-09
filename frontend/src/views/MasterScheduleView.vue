<template>
  <div class="layout">
    <NavBar />

    <div class="page-content">
      <div class="page-header">
        <h1>Master Schedule</h1>
      </div>

      <Card class="filters-card">
        <template #content>
          <div class="filters-row">
            <div class="filter-group">
              <label>Conference</label>
              <Select v-model="filterConference" :options="['All', ...D1_CONFERENCES]" />
            </div>
            <div class="filter-group">
              <label>Season</label>
              <Select v-model="filterSeason" :options="SEASONS" />
            </div>
            <div class="filter-group">
              <label>Search Team</label>
              <InputText v-model="searchQuery" placeholder="Team name..." />
            </div>
          </div>
        </template>
      </Card>

      <div v-if="loading" class="loading-center"><ProgressSpinner /></div>

      <DataTable
        v-else
        :value="filteredSchedules"
        v-model:expandedRows="expandedRows"
        :loading="loading"
        :rows="25"
        paginator
        sort-field="teamName"
        :sort-order="1"
        @row-expand="onRowExpand"
      >
        <Column expander style="width: 3rem" />
        <Column field="teamName" header="Team" sortable>
          <template #body="{ data }">
            <span class="team-name">{{ data.teamName }}</span>
          </template>
        </Column>
        <Column header="Record">
          <template #body="{ data }">
            {{ data.wins !== undefined ? `${data.wins}-${data.losses}` : gameRecord(data.games) }}
          </template>
        </Column>
        <Column field="strengthOfSchedule" header="SOS" sortable>
          <template #body="{ data }">
            <span v-if="data.strengthOfSchedule" class="sos-number">{{ data.strengthOfSchedule.toFixed(1) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </Column>

        <!-- Desktop-only columns — on mobile these live inside the expansion row -->
        <template v-if="!isMobile">
          <Column v-for="q in [1,2,3,4]" :key="q" :header="`Q${q} W-L`">
            <template #body="{ data }">
              <span v-if="data.sosQuadrantBreakdown">
                {{ data.sosQuadrantBreakdown[`q${q}Wins`] }}-{{ data.sosQuadrantBreakdown[`q${q}Losses`] }}
              </span>
            </template>
          </Column>
          <Column header="Open Dates">
            <template #body="{ data }">
              <Tag :value="(data.openDates?.length ?? 0).toString()" severity="warn" />
            </template>
          </Column>
        </template>

        <Column header="Games" style="width: 4rem">
          <template #body="{ data }">{{ data.gameCount ?? data.games?.length ?? 0 }}</template>
        </Column>

        <template #expansion="{ data }">
          <div class="schedule-expansion">

            <!-- Mobile summary: Q1-Q4 + Open Dates shown here since they're not in the row -->
            <div v-if="isMobile && data.sosQuadrantBreakdown" class="mobile-summary">
              <div class="mobile-quadrants">
                <div
                  v-for="q in [1,2,3,4]"
                  :key="q"
                  class="mobile-quad-box"
                  :style="{ borderLeft: `3px solid ${QUADRANT_COLORS[q]}` }"
                >
                  <span class="mobile-quad-label" :style="{ color: QUADRANT_COLORS[q] }">Q{{ q }}</span>
                  <span class="mobile-quad-record">
                    {{ data.sosQuadrantBreakdown[`q${q}Wins`] }}-{{ data.sosQuadrantBreakdown[`q${q}Losses`] }}
                  </span>
                </div>
              </div>
              <div class="mobile-open-dates">
                <span class="mobile-open-label">Open Dates</span>
                <Tag :value="(data.openDates?.length ?? 0).toString()" severity="warn" />
              </div>
            </div>

            <!-- Games table -->
            <DataTable :value="data.games" :rows="10" paginator size="small">
              <Column field="date" header="Date" sortable />
              <Column field="opponentName" header="Opponent">
                <template #body="{ data: g }">
                  {{ g.opponentName }}
                  <Tag v-if="g.opponentNetRanking" :value="`#${g.opponentNetRanking}`" severity="secondary" class="ml-1" />
                </template>
              </Column>
              <Column field="location" header="Loc">
                <template #body="{ data: g }">{{ LOCATION_LABELS[g.location] }}</template>
              </Column>
              <template v-if="!isMobile">
                <Column header="Q">
                  <template #body="{ data: g }">
                    <Tag
                      v-if="g.opponentNetRanking"
                      :value="`Q${getQuadrant(g.opponentNetRanking, g.location)}`"
                      :style="{ background: QUADRANT_COLORS[getQuadrant(g.opponentNetRanking, g.location)] }"
                    />
                  </template>
                </Column>
                <Column field="isConference" header="Conf">
                  <template #body="{ data: g }">
                    <i v-if="g.isConference" class="pi pi-check" style="color: var(--p-green-500)" />
                  </template>
                </Column>
              </template>
              <Column field="result" header="Result">
                <template #body="{ data: g }">
                  <Tag v-if="g.result" :value="g.result" :severity="g.result === 'W' ? 'success' : 'danger'" />
                </template>
              </Column>
            </DataTable>
          </div>
        </template>
      </DataTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import NavBar from '@/components/NavBar.vue'
import { useApi } from '@/composables/useApi'
import { getQuadrant } from '@/utils/sosCalculator'
import { D1_CONFERENCES, SEASONS, QUADRANT_COLORS, LOCATION_LABELS } from '@/constants'
import type { TeamSchedule, Game } from '@/models'

const api = useApi()
const schedules = ref<TeamSchedule[]>([])
const expandedRows = ref<TeamSchedule[]>([])
const loading = ref(false)

const filterConference = ref('All')
const filterSeason = ref<string>(SEASONS[1] ?? '')
const searchQuery = ref('')

const isMobile = ref(window.innerWidth <= 640)
function onResize() { isMobile.value = window.innerWidth <= 640 }
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

const filteredSchedules = computed(() => {
  return schedules.value.filter(s => {
    if (filterSeason.value && s.season !== filterSeason.value) return false
    if (filterConference.value !== 'All' && s.conference !== filterConference.value) return false
    if (searchQuery.value && !s.teamName?.toLowerCase().includes(searchQuery.value.toLowerCase())) return false
    return true
  })
})

function gameRecord(games: Game[]): string {
  const completed = games.filter(g => g.status === 'completed')
  const wins = completed.filter(g => g.result === 'W').length
  return `${wins}-${completed.length - wins}`
}

onMounted(async () => {
  loading.value = true
  try {
    schedules.value = await api.getPublicSchedules()
  } finally {
    loading.value = false
  }
})

async function onRowExpand(event: { data: TeamSchedule }) {
  if (event.data.games?.length) return
  try {
    const full = await api.getPublicSchedule(event.data.id)
    const idx = schedules.value.findIndex(s => s.id === event.data.id)
    if (idx !== -1) schedules.value[idx] = full
  } catch (err) {
    console.error('Failed to load games for', event.data.teamName, err)
  }
}
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
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 1.5rem;
}

.page-header h1 { margin: 0; }

.filters-card { margin-bottom: 1.5rem; }

.filters-row {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.filter-group label {
  font-size: 0.85rem;
  font-weight: 600;
}

.team-name { font-weight: 600; }
.sos-number { font-weight: 700; }
.muted { color: var(--p-text-muted-color); }

.schedule-expansion {
  padding: 1rem 2rem;
  background: var(--p-surface-50);
}

@media (max-width: 640px) {
  .schedule-expansion {
    padding: 0.75rem 0.25rem;
  }
}

/* Mobile summary strip — Q1-Q4 + Open Dates above the games table */
.mobile-summary {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0 0.25rem;
}

.mobile-quadrants {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
}

.mobile-quad-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.3rem 0.25rem;
  background: var(--p-surface-0);
  border-radius: 4px;
  gap: 0.15rem;
}

.mobile-quad-label {
  font-size: 0.7rem;
  font-weight: 800;
}

.mobile-quad-record {
  font-size: 0.8rem;
  font-weight: 600;
}

.mobile-open-dates {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.mobile-open-label {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
}

.loading-center {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.ml-1 { margin-left: 0.25rem; }
</style>
