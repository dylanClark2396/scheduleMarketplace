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
              <label>Deal Type</label>
              <SelectButton
                v-model="filterDealType"
                :options="dealTypeFilterOptions"
                option-label="label"
                option-value="value"
              />
            </div>
            <div class="filter-group">
              <label>Conference</label>
              <Select v-model="filterConference" :options="['All', ...D1_CONFERENCES]" />
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
      :style="{ width: 'min(560px, 92vw)' }"
      modal
    >
      <div class="post-form">

        <!-- Deal Type -->
        <div class="field">
          <label>Deal Type *</label>
          <SelectButton
            v-model="form.dealType"
            :options="dealTypeOptions"
            option-label="label"
            option-value="value"
          />
        </div>

        <!-- Team -->
        <div class="field">
          <label>Your Team *</label>
          <TeamSearch :teams="allTeams" @select="onFormTeamSelect" />
        </div>

        <!-- Buy Game specific fields -->
        <template v-if="form.dealType === 'buy-game'">
          <div class="field">
            <label>Your Role *</label>
            <SelectButton
              v-model="form.role"
              :options="[
                { label: 'Host (paying guarantee)', value: 'host' },
                { label: 'Visitor (receiving guarantee)', value: 'visitor' },
              ]"
              option-label="label"
              option-value="value"
            />
          </div>
          <div class="field-row">
            <div class="field">
              <label>Season *</label>
              <Select v-model="form.season" :options="SEASONS" />
            </div>
            <div class="field">
              <label>Date *</label>
              <DatePicker
                v-model="form.date"
                date-format="yy-mm-dd"
                :min-date="formSeasonDateRange.minDate"
                :max-date="formSeasonDateRange.maxDate"
              />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Date Flexibility (±days)</label>
              <InputNumber v-model="form.dateFlexibilityDays" :min="0" :max="14" />
            </div>
            <div class="field">
              <label>Guarantee Amount ($)</label>
              <InputNumber v-model="form.guaranteeAmount" :min="0" placeholder="e.g. 15000" />
            </div>
          </div>
        </template>

        <!-- Home-and-Home specific fields -->
        <template v-else-if="form.dealType === 'home-and-home'">
          <div class="field">
            <label>Who Hosts Year 1?</label>
            <SelectButton
              v-model="form.hostYear"
              :options="[
                { label: 'We host Year 1', value: 'year1' },
                { label: 'We host Year 2', value: 'year2' },
                { label: 'Open to either', value: 'either' },
              ]"
              option-label="label"
              option-value="value"
            />
          </div>
          <div class="field-row">
            <div class="field">
              <label>Year 1 Season *</label>
              <Select v-model="form.year1Season" :options="SEASONS" />
            </div>
            <div class="field">
              <label>Year 1 Date (optional)</label>
              <DatePicker
                v-model="form.year1Date"
                date-format="yy-mm-dd"
                :min-date="year1SeasonRange.minDate"
                :max-date="year1SeasonRange.maxDate"
              />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Year 2 Season *</label>
              <Select v-model="form.year2Season" :options="SEASONS" />
            </div>
            <div class="field">
              <label>Year 2 Date (optional)</label>
              <DatePicker
                v-model="form.year2Date"
                date-format="yy-mm-dd"
                :min-date="year2SeasonRange.minDate"
                :max-date="year2SeasonRange.maxDate"
              />
            </div>
          </div>
          <div class="field">
            <label>Date Flexibility (±days)</label>
            <InputNumber v-model="form.dateFlexibilityDays" :min="0" :max="14" />
          </div>
        </template>

        <!-- Neutral Site specific fields -->
        <template v-else-if="form.dealType === 'neutral-site'">
          <div class="field-row">
            <div class="field">
              <label>Season *</label>
              <Select v-model="form.season" :options="SEASONS" />
            </div>
            <div class="field">
              <label>Date *</label>
              <DatePicker
                v-model="form.date"
                date-format="yy-mm-dd"
                :min-date="formSeasonDateRange.minDate"
                :max-date="formSeasonDateRange.maxDate"
              />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Venue Name</label>
              <InputText v-model="form.venueName" placeholder="e.g. Madison Square Garden" />
            </div>
            <div class="field">
              <label>Venue City</label>
              <InputText v-model="form.venueCity" placeholder="e.g. New York, NY" />
            </div>
          </div>
          <div class="field">
            <label>Date Flexibility (±days)</label>
            <InputNumber v-model="form.dateFlexibilityDays" :min="0" :max="14" />
          </div>
        </template>

        <Divider />

        <!-- Common targeting fields -->
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
          <label>Notes</label>
          <Textarea v-model="form.notes" rows="2" placeholder="Any special requirements..." />
        </div>

      </div>

      <template #footer>
        <Button label="Cancel" text @click="showPostDialog = false" />
        <Button
          label="Post Listing"
          icon="pi pi-check"
          :loading="posting"
          :disabled="!canSubmit"
          @click="submitListing"
        />
      </template>
    </Dialog>

    <!-- Respond Dialog -->
    <Dialog
      v-model:visible="showRespondDialog"
      header="Express Interest"
      :style="{ width: 'min(400px, 92vw)' }"
      modal
    >
      <p>
        Send interest to <strong>{{ respondTarget?.teamName }}</strong> about their
        {{ respondTarget ? DEAL_TYPE_LABELS[respondTarget.dealType] : '' }} listing.
      </p>
      <p class="respond-note">
        In a production app this would notify both parties and create a match record.
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
import { D1_CONFERENCES, SEASONS, CURRENT_SEASON, getSeasonDateRange, DEAL_TYPE_LABELS } from '@/constants'
import type { MarketplaceListing, DealType, BuyGameRole, HomeAndHomeHostYear, Team } from '@/models'

const api = useApi()

const listings = ref<MarketplaceListing[]>([])
const allTeams = ref<Team[]>([])
const loading = ref(false)
const posting = ref(false)

const showPostDialog = ref(false)
const showRespondDialog = ref(false)
const respondTarget = ref<MarketplaceListing | null>(null)

const filterDealType = ref<DealType | null>(null)
const filterConference = ref('All')
const filterNetMin = ref<number | null>(null)
const filterNetMax = ref<number | null>(null)

const dealTypeFilterOptions = [
  { label: 'All', value: null },
  { label: 'Buy Game', value: 'buy-game' },
  { label: 'Home-and-Home', value: 'home-and-home' },
  { label: 'Neutral Site', value: 'neutral-site' },
]

const dealTypeOptions = [
  { label: 'Buy Game', value: 'buy-game' },
  { label: 'Home-and-Home', value: 'home-and-home' },
  { label: 'Neutral Site', value: 'neutral-site' },
]

const form = ref({
  dealType: 'buy-game' as DealType,
  teamId: '',
  teamName: '',
  conference: '',
  currentNetRanking: null as number | null,
  targetNetMin: null as number | null,
  targetNetMax: null as number | null,
  targetConferences: [] as string[],
  notes: '',
  // Buy Game + Neutral Site
  date: null as Date | null,
  season: CURRENT_SEASON,
  dateFlexibilityDays: 0,
  // Buy Game specific
  role: 'host' as BuyGameRole,
  guaranteeAmount: null as number | null,
  // Home-and-Home specific
  hostYear: 'either' as HomeAndHomeHostYear,
  year1Season: CURRENT_SEASON,
  year2Season: SEASONS[2] ?? CURRENT_SEASON,
  year1Date: null as Date | null,
  year2Date: null as Date | null,
  // Neutral Site specific
  venueName: '',
  venueCity: '',
})

const formSeasonDateRange = computed(() => getSeasonDateRange(form.value.season))
const year1SeasonRange = computed(() => getSeasonDateRange(form.value.year1Season))
const year2SeasonRange = computed(() => getSeasonDateRange(form.value.year2Season))

const canSubmit = computed(() => {
  if (!form.value.teamId) return false
  if (form.value.dealType === 'buy-game' || form.value.dealType === 'neutral-site') {
    if (!form.value.date) return false
  }
  return true
})

const filteredListings = computed(() => {
  return listings.value.filter(l => {
    if (filterDealType.value && l.dealType !== filterDealType.value) return false
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

function onFormTeamSelect(t: Team) {
  form.value.teamId = t.id
  form.value.teamName = t.name
  form.value.conference = t.conference
  form.value.currentNetRanking = t.netRanking
}

function clearFilters() {
  filterDealType.value = null
  filterConference.value = 'All'
  filterNetMin.value = null
  filterNetMax.value = null
}

function resetForm() {
  form.value = {
    dealType: 'buy-game',
    teamId: '',
    teamName: '',
    conference: '',
    currentNetRanking: null,
    targetNetMin: null,
    targetNetMax: null,
    targetConferences: [],
    notes: '',
    date: null,
    season: CURRENT_SEASON,
    dateFlexibilityDays: 0,
    role: 'host',
    guaranteeAmount: null,
    hostYear: 'either',
    year1Season: CURRENT_SEASON,
    year2Season: SEASONS[2] ?? CURRENT_SEASON,
    year1Date: null,
    year2Date: null,
    venueName: '',
    venueCity: '',
  }
}

async function submitListing() {
  posting.value = true
  try {
    const base = {
      teamId: form.value.teamId,
      teamName: form.value.teamName,
      conference: form.value.conference,
      currentNetRanking: form.value.currentNetRanking,
      targetNetMin: form.value.targetNetMin,
      targetNetMax: form.value.targetNetMax,
      targetConferences: form.value.targetConferences,
      notes: form.value.notes,
      status: 'open' as const,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }

    let payload: Partial<MarketplaceListing>

    if (form.value.dealType === 'buy-game') {
      payload = {
        ...base,
        dealType: 'buy-game',
        role: form.value.role,
        date: form.value.date!.toISOString().slice(0, 10),
        dateFlexibilityDays: form.value.dateFlexibilityDays,
        season: form.value.season,
        guaranteeAmount: form.value.guaranteeAmount,
      }
    } else if (form.value.dealType === 'home-and-home') {
      payload = {
        ...base,
        dealType: 'home-and-home',
        hostYear: form.value.hostYear,
        year1Season: form.value.year1Season,
        year2Season: form.value.year2Season,
        year1Date: form.value.year1Date?.toISOString().slice(0, 10) ?? null,
        year2Date: form.value.year2Date?.toISOString().slice(0, 10) ?? null,
        dateFlexibilityDays: form.value.dateFlexibilityDays,
      }
    } else {
      payload = {
        ...base,
        dealType: 'neutral-site',
        date: form.value.date!.toISOString().slice(0, 10),
        dateFlexibilityDays: form.value.dateFlexibilityDays,
        season: form.value.season,
        venueName: form.value.venueName || null,
        venueCity: form.value.venueCity || null,
      }
    }

    const listing = await api.createListing(payload)
    listings.value.unshift(listing)
    showPostDialog.value = false
    resetForm()
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

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

@media (max-width: 480px) {
  .field-row {
    grid-template-columns: 1fr;
  }
}

.respond-note {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}
</style>
