<template>
  <div class="layout">
    <NavBar />

    <div class="page-content">
      <div class="page-header">
        <h1>SOS Estimator</h1>
        <p class="page-subtitle">
          Analyze your schedule strength and get suggestions to hit your SOS target
        </p>
      </div>

      <!-- Controls -->
      <Card class="controls-card">
        <template #content>
          <div class="controls-row">
            <div class="control-group">
              <label>Team</label>
              <TeamSearch :teams="allTeams" @select="onTeamSelect" />
            </div>
            <div class="control-group">
              <label>Season</label>
              <Select v-model="selectedSeason" :options="SEASONS" />
            </div>
            <Button
              label="Load Schedule"
              icon="pi pi-refresh"
              :loading="loadingSchedule"
              :disabled="!selectedTeam"
              @click="loadSchedule"
            />
          </div>
        </template>
      </Card>

      <div v-if="schedule" class="estimator-body">
        <div class="estimator-main">

          <!-- SOS Summary -->
          <Card>
            <template #title>Strength of Schedule</template>
            <template #content>
              <div class="sos-summary">
                <StrengthGauge :sos="estimate?.currentSos ?? null" />

                <div class="quadrant-grid">
                  <div
                    v-for="q in [1,2,3,4]"
                    :key="q"
                    class="quadrant-box"
                    :style="{ borderLeft: `4px solid ${QUADRANT_COLORS[q]}` }"
                  >
                    <span class="q-label" :style="{ color: QUADRANT_COLORS[q] }">Q{{ q }}</span>
                    <span class="q-record">
                      {{ estimate?.quadrantBreakdown[`q${q}Wins` as keyof SosQuadrantBreakdown] }}-{{
                        estimate?.quadrantBreakdown[`q${q}Losses` as keyof SosQuadrantBreakdown]
                      }}
                    </span>
                  </div>
                </div>

                <div class="breakdown-tags">
                  <Tag :value="`${estimate?.confGames} Conf`" severity="info" />
                  <Tag :value="`${estimate?.nonConGames} Non-Conf`" severity="secondary" />
                  <Tag :value="`${estimate?.homeGames}H / ${estimate?.awayGames}A / ${estimate?.neutralGames}N`" severity="secondary" />
                </div>
              </div>
            </template>
          </Card>

          <!-- SOS Target Tool -->
          <Card>
            <template #title>Set SOS Target</template>
            <template #content>
              <div class="target-tool">
                <div class="target-row">
                  <label>Target SOS (Avg Opponent NET Rank)</label>
                  <InputNumber v-model="targetSos" :min="1" :max="363" show-buttons />
                </div>

                <Slider
                  v-model="targetSos"
                  :min="1"
                  :max="363"
                  class="target-slider"
                />

                <div class="slider-labels">
                  <span>1 (Hardest)</span>
                  <span>{{ targetSos }}</span>
                  <span>363 (Easiest)</span>
                </div>

                <div class="target-delta" v-if="estimate?.currentSos !== null">
                  <Tag
                    :value="sosDeltaLabel"
                    :severity="sosDeltaSeverity"
                  />
                </div>

                <Button
                  label="Get Suggestions"
                  icon="pi pi-lightbulb"
                  :loading="loadingSuggestions"
                  :disabled="!openDates.length"
                  @click="getSuggestions"
                  class="mt-3"
                />
              </div>
            </template>
          </Card>

          <!-- Suggestions -->
          <Card v-if="suggestions.length > 0">
            <template #title>Suggested Opponents</template>
            <template #subtitle>Teams that would move your SOS closest to {{ targetSos }}</template>
            <template #content>
              <DataTable :value="suggestions" class="suggestions-table">
                <Column field="team.name" header="Team">
                  <template #body="{ data }">
                    <span class="team-name">{{ data.team.name }}</span>
                    <span class="conference-label">{{ data.team.conference }}</span>
                  </template>
                </Column>
                <Column field="team.netRanking" header="NET Rank">
                  <template #body="{ data }">
                    <Tag :value="`#${data.team.netRanking}`" severity="secondary" />
                  </template>
                </Column>
                <Column field="quadrantIfAdded" header="Quadrant">
                  <template #body="{ data }">
                    <Tag
                      :value="`Q${data.quadrantIfAdded}`"
                      :style="{ background: QUADRANT_COLORS[data.quadrantIfAdded] }"
                    />
                  </template>
                </Column>
                <Column field="suggestedDate" header="Date" />
                <Column field="suggestedLocation" header="Location">
                  <template #body="{ data }">
                    {{ LOCATION_LABELS[data.suggestedLocation] }}
                  </template>
                </Column>
                <Column field="projectedSosIfAdded" header="Projected SOS">
                  <template #body="{ data }">
                    {{ data.projectedSosIfAdded.toFixed(1) }}
                  </template>
                </Column>
                <Column header="">
                  <template #body="{ data }">
                    <Button
                      icon="pi pi-plus"
                      label="Add"
                      size="small"
                      @click="addSuggestedGame(data)"
                    />
                  </template>
                </Column>
              </DataTable>
            </template>
          </Card>
        </div>

        <!-- Schedule Table -->
        <Card class="schedule-card">
          <template #title>
            <div class="schedule-title-row">
              <span>{{ schedule.teamName }} — {{ schedule.season }}</span>
              <Button icon="pi pi-plus" label="Add Game" size="small" @click="showAddGame = true" />
            </div>
          </template>
          <template #content>
            <DataTable
              :value="schedule.games"
              sortField="date"
              :sortOrder="1"
              class="schedule-table"
              size="small"
            >
              <Column field="date" header="Date" sortable />
              <Column field="opponentName" header="Opponent">
                <template #body="{ data }">
                  <div>
                    <span>{{ data.opponentName }}</span>
                    <Tag
                      v-if="data.opponentNetRanking"
                      :value="`#${data.opponentNetRanking}`"
                      severity="secondary"
                      class="ml-2"
                    />
                  </div>
                </template>
              </Column>
              <Column field="location" header="Loc">
                <template #body="{ data }">{{ LOCATION_LABELS[data.location] }}</template>
              </Column>
              <Column header="Q">
                <template #body="{ data }">
                  <Tag
                    v-if="data.opponentNetRanking"
                    :value="`Q${getQuadrant(data.opponentNetRanking, data.location)}`"
                    :style="{ background: QUADRANT_COLORS[getQuadrant(data.opponentNetRanking, data.location)] }"
                  />
                </template>
              </Column>
              <Column field="result" header="Result">
                <template #body="{ data }">
                  <Tag
                    v-if="data.result"
                    :value="data.result"
                    :severity="data.result === 'W' ? 'success' : 'danger'"
                  />
                </template>
              </Column>
              <Column field="isConference" header="Conf">
                <template #body="{ data }">
                  <i v-if="data.isConference" class="pi pi-check" style="color: var(--p-green-500)" />
                </template>
              </Column>
              <Column header="">
                <template #body="{ data }">
                  <Button
                    icon="pi pi-trash"
                    text
                    rounded
                    severity="danger"
                    size="small"
                    @click="removeGame(data.id)"
                  />
                </template>
              </Column>
            </DataTable>
          </template>
        </Card>
      </div>

      <!-- Empty state -->
      <div v-else-if="!loadingSchedule" class="empty-state">
        <i class="pi pi-calendar" />
        <p>Select a team and season to view and analyze their schedule</p>
      </div>

      <ProgressSpinner v-if="loadingSchedule" />
    </div>

    <!-- Add Game Dialog -->
    <Dialog v-model:visible="showAddGame" header="Add Game" :style="{ width: '480px' }" modal>
      <div class="add-game-form">
        <div class="field">
          <label>Date</label>
          <DatePicker v-model="newGame.date" date-format="yy-mm-dd" />
        </div>
        <div class="field">
          <label>Opponent</label>
          <TeamSearch :teams="allTeams" @select="onOpponentSelect" />
        </div>
        <div class="field">
          <label>Location</label>
          <Select v-model="newGame.location" :options="['home', 'away', 'neutral']" />
        </div>
        <div class="field">
          <label>Conference game?</label>
          <ToggleSwitch v-model="newGame.isConference" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" text @click="showAddGame = false" />
        <Button label="Add Game" icon="pi pi-plus" @click="submitAddGame" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import NavBar from '@/components/NavBar.vue'
import StrengthGauge from '@/components/StrengthGauge.vue'
import TeamSearch from '@/components/TeamSearch.vue'
import { useApi } from '@/composables/useApi'
import {
  estimateSos,
  suggestTeamsForTarget,
  getQuadrant,
} from '@/utils/sosCalculator'
import { SEASONS, QUADRANT_COLORS, LOCATION_LABELS } from '@/constants'
import type {
  Team, TeamSchedule, SosEstimate, SosTargetSuggestion,
  SosQuadrantBreakdown, Game,
} from '@/models'

const api = useApi()

const allTeams = ref<Team[]>([])
const selectedTeam = ref<Team | null>(null)
const selectedSeason = ref(SEASONS[1])
const schedule = ref<TeamSchedule | null>(null)
const loadingSchedule = ref(false)
const loadingSuggestions = ref(false)
const showAddGame = ref(false)

const estimate = computed<SosEstimate | null>(() =>
  schedule.value ? estimateSos(schedule.value.games) : null
)

const openDates = computed(() => schedule.value?.openDates ?? [])

const targetSos = ref(120)
const suggestions = ref<SosTargetSuggestion[]>([])

const sosDeltaLabel = computed(() => {
  const current = estimate.value?.currentSos
  if (current === null || current === undefined) return ''
  const diff = targetSos.value - current
  if (Math.abs(diff) < 1) return 'Already at target!'
  return diff > 0
    ? `Need to add ${diff.toFixed(0)} pts easier games`
    : `Need to add ${Math.abs(diff).toFixed(0)} pts harder games`
})

const sosDeltaSeverity = computed(() => {
  const current = estimate.value?.currentSos
  if (!current) return 'info'
  return Math.abs(targetSos.value - current) < 5 ? 'success' : 'warn'
})

const newGame = ref<Partial<Game>>({
  location: 'home',
  isConference: false,
})

onMounted(async () => {
  allTeams.value = await api.getTeams()
})

function onTeamSelect(team: Team) {
  selectedTeam.value = team
}

async function loadSchedule() {
  if (!selectedTeam.value) return
  loadingSchedule.value = true
  try {
    schedule.value = await api.getTeamSchedule(selectedTeam.value.id, selectedSeason.value)
  } finally {
    loadingSchedule.value = false
  }
}

async function getSuggestions() {
  if (!schedule.value) return
  loadingSuggestions.value = true
  try {
    suggestions.value = suggestTeamsForTarget(
      schedule.value.games,
      openDates.value,
      allTeams.value,
      targetSos.value,
    )
  } finally {
    loadingSuggestions.value = false
  }
}

async function addSuggestedGame(suggestion: SosTargetSuggestion) {
  if (!schedule.value) return
  await api.addGame(schedule.value.id, {
    opponentId: suggestion.team.id,
    opponentName: suggestion.team.name,
    opponentNetRanking: suggestion.team.netRanking,
    date: suggestion.suggestedDate ?? '',
    location: suggestion.suggestedLocation,
    isConference: false,
    status: 'scheduled',
    result: null,
    homeScore: null,
    awayScore: null,
  })
  await loadSchedule()
  suggestions.value = []
}

function onOpponentSelect(team: Team) {
  newGame.value.opponentId = team.id
  newGame.value.opponentName = team.name
  newGame.value.opponentNetRanking = team.netRanking
}

async function submitAddGame() {
  if (!schedule.value || !newGame.value.opponentId) return
  await api.addGame(schedule.value.id, {
    ...newGame.value,
    status: 'scheduled',
    result: null,
    homeScore: null,
    awayScore: null,
  })
  showAddGame.value = false
  newGame.value = { location: 'home', isConference: false }
  await loadSchedule()
}

async function removeGame(gameId: string) {
  if (!schedule.value) return
  await api.deleteGame(schedule.value.id, gameId)
  await loadSchedule()
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

.page-header h1 { margin: 0 0 0.25rem; }

.page-subtitle {
  color: var(--p-text-muted-color);
  margin: 0;
}

.controls-card {
  margin-bottom: 1.5rem;
}

.controls-row {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 200px;
}

.control-group label {
  font-size: 0.85rem;
  font-weight: 600;
}

.estimator-body {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 1.5rem;
  align-items: start;
}

.estimator-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sos-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.quadrant-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
}

.quadrant-box {
  padding: 0.5rem 0.75rem;
  background: var(--p-surface-50);
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.q-label {
  font-weight: 800;
  font-size: 1rem;
}

.q-record {
  font-weight: 600;
  font-size: 1.1rem;
}

.breakdown-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}

.target-tool {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.target-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.target-slider {
  width: 100%;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.target-delta {
  text-align: center;
}

.schedule-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.team-name {
  font-weight: 600;
}

.conference-label {
  margin-left: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 4rem;
  color: var(--p-text-muted-color);
}

.empty-state i {
  font-size: 3rem;
}

.add-game-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field label {
  font-weight: 600;
  font-size: 0.85rem;
}

.mt-3 { margin-top: 0.75rem; }
.ml-2 { margin-left: 0.5rem; }
</style>
