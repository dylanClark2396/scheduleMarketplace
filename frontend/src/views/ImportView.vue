<template>
  <div class="layout">
    <NavBar />

    <div class="page-content">
      <div class="page-header">
        <h1>Import Schedule</h1>
        <p class="page-subtitle">
          Import schedules from PDFs, spreadsheets, photos, or enter manually
        </p>
      </div>

      <div class="import-grid">

        <!-- Upload Panel -->
        <Card>
          <template #title>Upload File</template>
          <template #content>
            <div class="upload-area" @dragover.prevent @drop.prevent="onDrop">
              <FileUpload
                mode="basic"
                :auto="false"
                :multiple="false"
                accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
                @select="onFileSelect"
                choose-label="Choose File"
                class="upload-btn"
              />
              <p class="upload-hint">or drag and drop here</p>
              <div class="supported-formats">
                <Tag value="PDF" severity="info" />
                <Tag value="CSV" severity="info" />
                <Tag value="Excel" severity="info" />
                <Tag value="Photo (OCR)" severity="success" />
              </div>
            </div>

            <div v-if="selectedFile" class="selected-file">
              <i class="pi pi-file" />
              <span>{{ selectedFile.name }}</span>
              <Tag :value="inferSource(selectedFile)" severity="secondary" />
            </div>

            <div class="field mt-3">
              <label>Associate with Team</label>
              <TeamSearch :teams="allTeams" @select="t => importTeamId = t.id" />
            </div>

            <Button
              label="Process File"
              icon="pi pi-cog"
              :loading="processing"
              :disabled="!selectedFile"
              class="mt-3 w-full"
              @click="processFile"
            />
          </template>
        </Card>

        <!-- Manual Entry Panel -->
        <Card>
          <template #title>Manual Entry</template>
          <template #content>
            <div class="manual-entry">
              <div class="field">
                <label>Team</label>
                <TeamSearch :teams="allTeams" @select="t => manualTeamId = t.id" />
              </div>
              <div class="field">
                <label>Season</label>
                <Select v-model="manualSeason" :options="SEASONS" />
              </div>

              <Divider />

              <div v-for="(game, i) in manualGames" :key="i" class="manual-game-row">
                <DatePicker v-model="game.date" date-format="yy-mm-dd" placeholder="Date" />
                <InputText v-model="game.opponentName" placeholder="Opponent" />
                <Select v-model="game.location" :options="['home', 'away', 'neutral']" />
                <Button icon="pi pi-trash" text severity="danger" @click="manualGames.splice(i, 1)" />
              </div>

              <Button
                label="Add Game Row"
                icon="pi pi-plus"
                text
                @click="addManualRow"
                class="mt-2"
              />

              <Button
                label="Save Schedule"
                icon="pi pi-save"
                :disabled="!manualTeamId || manualGames.length === 0"
                class="mt-3 w-full"
                @click="saveManual"
              />
            </div>
          </template>
        </Card>
      </div>

      <!-- Parsed Results Review -->
      <Card v-if="parsedGames.length > 0" class="mt-4">
        <template #title>Review Parsed Games</template>
        <template #subtitle>Review and edit before confirming import</template>
        <template #content>
          <div class="parsed-info">
            <Tag :value="`${parsedGames.length} games found`" severity="success" />
            <Tag v-if="parseErrors.length > 0" :value="`${parseErrors.length} warnings`" severity="warn" />
          </div>

          <Message v-for="err in parseErrors" :key="err" severity="warn" class="mt-2">{{ err }}</Message>

          <DataTable :value="parsedGames" class="mt-3" editMode="cell" @cell-edit-complete="onCellEdit">
            <Column field="date" header="Date">
              <template #editor="{ data, field }">
                <InputText v-model="data[field]" />
              </template>
            </Column>
            <Column field="opponentName" header="Opponent">
              <template #editor="{ data, field }">
                <InputText v-model="data[field]" />
              </template>
            </Column>
            <Column field="location" header="Location">
              <template #editor="{ data, field }">
                <Select v-model="data[field]" :options="['home', 'away', 'neutral']" />
              </template>
            </Column>
            <Column field="isConference" header="Conf?">
              <template #body="{ data }">
                <ToggleSwitch v-model="data.isConference" />
              </template>
            </Column>
            <Column header="">
              <template #body="{ index }">
                <Button icon="pi pi-trash" text severity="danger" @click="parsedGames.splice(index, 1)" />
              </template>
            </Column>
          </DataTable>

          <div class="confirm-actions mt-3">
            <Button label="Discard" text severity="danger" @click="parsedGames = []; parseErrors = []" />
            <Button
              label="Confirm Import"
              icon="pi pi-check"
              :loading="confirming"
              @click="confirmImport"
            />
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import NavBar from '@/components/NavBar.vue'
import TeamSearch from '@/components/TeamSearch.vue'
import { useApi } from '@/composables/useApi'
import { SEASONS } from '@/constants'
import type { Team, Game } from '@/models'
import type { ImportSource } from '@/models'

const api = useApi()
const allTeams = ref<Team[]>([])
const selectedFile = ref<File | null>(null)
const importTeamId = ref<string | null>(null)
const processing = ref(false)
const confirming = ref(false)
const currentJobId = ref<string | null>(null)

const parsedGames = ref<Partial<Game>[]>([])
const parseErrors = ref<string[]>([])

const manualTeamId = ref<string | null>(null)
const manualSeason = ref(SEASONS[1])
const manualGames = ref<Array<{ date: string; opponentName: string; location: string; isConference: boolean }>>([])

onMounted(async () => {
  allTeams.value = await api.getTeams()
})

function onFileSelect(event: { files: File[] }) {
  selectedFile.value = event.files[0] ?? null
}

function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files[0]
  if (file) selectedFile.value = file
}

function inferSource(file: File): ImportSource {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'excel'
  if (name.match(/\.(png|jpg|jpeg)$/)) return 'photo'
  return 'pdf'
}

async function processFile() {
  if (!selectedFile.value) return
  processing.value = true
  try {
    const source = inferSource(selectedFile.value)
    const { uploadUrl, fileUrl } = await api.getImportUploadUrl(
      selectedFile.value.name,
      selectedFile.value.type
    )

    await fetch(uploadUrl, { method: 'PUT', body: selectedFile.value })

    const job = await api.createImportJob({
      teamId: importTeamId.value,
      source,
      fileUrl,
    })

    currentJobId.value = job.id
    await pollJobUntilDone(job.id)
  } finally {
    processing.value = false
  }
}

async function pollJobUntilDone(jobId: string) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const job = await api.getImportJob(jobId)
    if (job.status === 'completed') {
      parsedGames.value = job.parsedGames
      parseErrors.value = job.errors
      return
    }
    if (job.status === 'failed') {
      parseErrors.value = job.errors
      return
    }
  }
  parseErrors.value = ['Processing timed out. Please try again.']
}

function onCellEdit(event: { data: Partial<Game>; field: string; newValue: unknown }) {
  event.data[event.field as keyof Game] = event.newValue as never
}

async function confirmImport() {
  if (!currentJobId.value) return
  confirming.value = true
  try {
    await api.confirmImport(currentJobId.value, parsedGames.value)
    parsedGames.value = []
    parseErrors.value = []
    currentJobId.value = null
  } finally {
    confirming.value = false
  }
}

function addManualRow() {
  manualGames.value.push({ date: '', opponentName: '', location: 'home', isConference: false })
}

async function saveManual() {
  if (!manualTeamId.value) return
  const schedule = await api.createSchedule({
    teamId: manualTeamId.value,
    season: manualSeason.value,
    games: manualGames.value.map((g, i) => ({
      id: String(i),
      date: g.date,
      opponentId: '',
      opponentName: g.opponentName,
      opponentNetRanking: null,
      location: g.location as Game['location'],
      isConference: g.isConference,
      status: 'scheduled' as const,
      homeScore: null,
      awayScore: null,
      result: null,
    })),
    openDates: [],
  })
  manualGames.value = []
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
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 1.5rem;
}

.page-header h1 { margin: 0 0 0.25rem; }

.page-subtitle {
  margin: 0;
  color: var(--p-text-muted-color);
}

.import-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem;
  border: 2px dashed var(--p-surface-300);
  border-radius: 8px;
  background: var(--p-surface-50);
}

.upload-hint {
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  margin: 0;
}

.supported-formats {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: center;
}

.selected-file {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.5rem;
  background: var(--p-surface-100);
  border-radius: 6px;
}

.manual-entry {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.manual-game-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: 0.5rem;
  align-items: center;
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

.parsed-info {
  display: flex;
  gap: 0.5rem;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-4 { margin-top: 1rem; }
.w-full { width: 100%; }
</style>
