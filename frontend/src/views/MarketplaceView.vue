<template>
  <div class="layout">
    <NavBar />

    <div class="page-content">
      <div class="page-header">
        <h1>Schedule Marketplace</h1>
        <Button label="Post Listing" icon="pi pi-plus" @click="showPostDialog = true" />
      </div>

      <!-- Filters -->
      <Card class="filters-card">
        <template #content>
          <div class="filters-row">
            <div class="filter-group">
              <label>Type</label>
              <SelectButton
                v-model="filterType"
                :options="typeOptions"
                option-label="label"
                option-value="value"
              />
            </div>
            <div class="filter-group">
              <label>Conference</label>
              <Select v-model="filterConference" :options="['All', ...D1_CONFERENCES]" />
            </div>
            <div class="filter-group">
              <label>Date From</label>
              <DatePicker v-model="filterDateFrom" date-format="yy-mm-dd" :min-date="filterDateMin" :max-date="filterDateMax" />
            </div>
            <div class="filter-group">
              <label>NET Range</label>
              <div class="range-inputs">
                <InputNumber v-model="filterNetMin" placeholder="Min" :min="1" :max="363" />
                <span>–</span>
                <InputNumber v-model="filterNetMax" placeholder="Max" :min="1" :max="363" />
              </div>
            </div>
            <Button icon="pi pi-filter-slash" text label="Clear" @click="clearFilters" />
          </div>
        </template>
      </Card>

      <!-- Listings Grid -->
      <div v-if="loading" class="loading-center">
        <ProgressSpinner />
      </div>

      <div v-else-if="filteredListings.length === 0" class="empty-state">
        <i class="pi pi-shopping-bag" />
        <p>No open listings match your filters</p>
        <Button label="Post First Listing" icon="pi pi-plus" @click="showPostDialog = true" />
      </div>

      <div v-else class="listings-grid">
        <MarketplacePost
          v-for="listing in filteredListings"
          :key="listing.id"
          :listing="listing"
          :can-respond="true"
          @respond="onRespond"
          @close="onClose"
        />
      </div>
    </div>

    <!-- Post Listing Dialog -->
    <Dialog
      v-model:visible="showPostDialog"
      header="Post Listing"
      :style="{ width: 'min(540px, 92vw)' }"
      modal
    >
      <div class="post-form">
        <div class="field">
          <label>Type *</label>
          <SelectButton
            v-model="form.type"
            :options="[{ label: 'Request (Need Opponent)', value: 'request' }, { label: 'Offer (Available to Play)', value: 'offer' }]"
            option-label="label"
            option-value="value"
          />
        </div>

        <div class="field">
          <label>Your Team *</label>
          <TeamSearch :teams="allTeams" @select="onFormTeamSelect" />
        </div>

        <div class="field">
          <label>Season *</label>
          <Select v-model="formSeason" :options="SEASONS" />
        </div>

        <div class="field">
          <label>Date *</label>
          <DatePicker v-model="formDate" date-format="yy-mm-dd" :min-date="formSeasonDateRange.minDate" :max-date="formSeasonDateRange.maxDate" />
        </div>

        <div class="field">
          <label>Date Flexibility (days ±)</label>
          <InputNumber v-model="form.dateFlexibilityDays" :min="0" :max="14" />
        </div>

        <div class="field">
          <label>Preferred Location</label>
          <Select v-model="form.preferredLocation" :options="locationOptions" option-label="label" option-value="value" />
        </div>

        <div class="field">
          <label>Target NET Range</label>
          <div class="range-inputs">
            <InputNumber v-model="form.targetNetMin" placeholder="Min (1)" :min="1" :max="363" />
            <span>–</span>
            <InputNumber v-model="form.targetNetMax" placeholder="Max (363)" :min="1" :max="363" />
          </div>
        </div>

        <div class="field">
          <label>Target Conferences (leave empty for any)</label>
          <MultiSelect
            v-model="form.targetConferences"
            :options="D1_CONFERENCES"
            placeholder="Any conference"
            filter
            :max-selected-labels="3"
          />
        </div>

        <div class="field">
          <label>Compensation / Game Fee Notes</label>
          <InputText v-model="form.compensationNotes" placeholder="e.g., $15,000 guarantee" />
        </div>

        <div class="field">
          <label>Additional Notes</label>
          <Textarea v-model="form.notes" rows="3" placeholder="Any special requirements..." />
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" text @click="showPostDialog = false" />
        <Button
          label="Post Listing"
          icon="pi pi-check"
          :loading="posting"
          :disabled="!form.teamId || !form.date"
          @click="submitListing"
        />
      </template>
    </Dialog>

    <!-- Respond Dialog -->
    <Dialog
      v-model:visible="showRespondDialog"
      header="Respond to Listing"
      :style="{ width: 'min(400px, 92vw)' }"
      modal
    >
      <p>Contact {{ respondTarget?.teamName }} about the {{ respondTarget?.date }} opening.</p>
      <p class="respond-note">
        In a production app this would send a notification to both parties and create a match.
      </p>
      <template #footer>
        <Button label="Cancel" text @click="showRespondDialog = false" />
        <Button label="Confirm Interest" icon="pi pi-handshake" @click="confirmRespond" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import NavBar from '@/components/NavBar.vue'
import MarketplacePost from '@/components/MarketplacePost.vue'
import TeamSearch from '@/components/TeamSearch.vue'
import { useApi } from '@/composables/useApi'
import { D1_CONFERENCES, SEASONS, CURRENT_SEASON, getSeasonDateRange } from '@/constants'
import type { MarketplaceListing, Team } from '@/models'

const api = useApi()

const listings = ref<MarketplaceListing[]>([])
const allTeams = ref<Team[]>([])
const loading = ref(false)
const posting = ref(false)

const showPostDialog = ref(false)
const showRespondDialog = ref(false)
const respondTarget = ref<MarketplaceListing | null>(null)

const filterType = ref<string | null>(null)
const filterConference = ref('All')
const filterDateFrom = ref<Date | null>(null)
const filterNetMin = ref<number | null>(null)
const filterNetMax = ref<number | null>(null)

const typeOptions = [
  { label: 'All', value: null },
  { label: 'Requests', value: 'request' },
  { label: 'Offers', value: 'offer' },
]

const locationOptions = [
  { label: 'Any', value: 'any' },
  { label: 'Home', value: 'home' },
  { label: 'Away', value: 'away' },
  { label: 'Neutral', value: 'neutral' },
]

const form = ref<Partial<MarketplaceListing>>({
  type: 'request',
  dateFlexibilityDays: 0,
  preferredLocation: 'any',
  targetConferences: [],
  compensationNotes: '',
  notes: '',
})

const formSeason = ref<string>(CURRENT_SEASON)
const formSeasonDateRange = computed(() => getSeasonDateRange(formSeason.value))

// Filter date picker spans the full range of all listed seasons
const filterDateMin = computed(() => getSeasonDateRange(SEASONS[0] ?? CURRENT_SEASON).minDate)
const filterDateMax = computed(() => getSeasonDateRange(SEASONS[SEASONS.length - 1] ?? CURRENT_SEASON).maxDate)

const formDate = computed<Date | null>({
  get: () => form.value.date ? new Date(form.value.date + 'T00:00:00') : null,
  set: (d) => { form.value.date = d ? d.toISOString().slice(0, 10) : undefined },
})

function onFormTeamSelect(t: Team) {
  form.value.teamId = t.id
  form.value.teamName = t.name
  form.value.conference = t.conference
  form.value.currentNetRanking = t.netRanking
}

const filteredListings = computed(() => {
  return listings.value.filter(l => {
    if (filterType.value && l.type !== filterType.value) return false
    if (filterConference.value !== 'All' && l.conference !== filterConference.value) return false
    if (filterNetMin.value && (l.currentNetRanking == null || l.currentNetRanking < filterNetMin.value)) return false
    if (filterNetMax.value && (l.currentNetRanking == null || l.currentNetRanking > filterNetMax.value)) return false
    return true
  })
})

onMounted(async () => {
  loading.value = true
  try {
    const [ls, ts] = await Promise.all([
      api.getListings({ status: 'open' }),
      api.getTeams(),
    ])
    listings.value = ls
    allTeams.value = ts
  } finally {
    loading.value = false
  }
})

function clearFilters() {
  filterType.value = null
  filterConference.value = 'All'
  filterDateFrom.value = null
  filterNetMin.value = null
  filterNetMax.value = null
}

async function submitListing() {
  posting.value = true
  try {
    const listing = await api.createListing({
      ...form.value,
      status: 'open',
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
    listings.value.unshift(listing)
    showPostDialog.value = false
    form.value = {
      type: 'request',
      dateFlexibilityDays: 0,
      preferredLocation: 'any',
      targetConferences: [],
      compensationNotes: '',
      notes: '',
    }
  } finally {
    posting.value = false
  }
}

function onRespond(listing: MarketplaceListing) {
  respondTarget.value = listing
  showRespondDialog.value = true
}

async function confirmRespond() {
  if (!respondTarget.value) return
  await api.matchListings(respondTarget.value.id, respondTarget.value.id)
  showRespondDialog.value = false
}

async function onClose(listing: MarketplaceListing) {
  await api.updateListing(listing.id, { status: 'closed' })
  listing.status = 'closed'
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
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.range-inputs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

@media (max-width: 640px) {
  .page-header {
    flex-wrap: wrap;
  }

  .range-inputs {
    flex-wrap: wrap;
  }

  .range-inputs .p-inputnumber {
    width: 100%;
  }
}

.listings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
  gap: 1rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem;
  color: var(--p-text-muted-color);
}

.empty-state i { font-size: 3rem; }

.loading-center {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.post-form {
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

.respond-note {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}
</style>
