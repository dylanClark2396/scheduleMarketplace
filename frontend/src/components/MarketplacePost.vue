<template>
  <Card class="listing-card">
    <template #header>
      <div class="listing-header">
        <Tag
          :value="DEAL_TYPE_LABELS[listing.dealType]?.toUpperCase()"
          :severity="dealTypeSeverity"
        />
        <Tag
          :value="listing.status.toUpperCase()"
          :severity="statusSeverity"
        />
      </div>
    </template>

    <template #title>
      <div class="listing-team">
        <span class="team-name">{{ listing.teamName }}</span>
        <span class="conference">{{ listing.conference }}</span>
        <Tag v-if="listing.currentNetRanking" :value="`NET #${listing.currentNetRanking}`" severity="secondary" />
      </div>
    </template>

    <template #content>
      <div class="listing-details">

        <!-- Buy Game -->
        <template v-if="listing.dealType === 'buy-game'">
          <div class="detail-row">
            <i class="pi pi-calendar" />
            <span>{{ listing.date }}</span>
            <span v-if="listing.dateFlexibilityDays > 0" class="flexibility">
              (±{{ listing.dateFlexibilityDays }}d flex)
            </span>
          </div>
          <div class="detail-row">
            <i class="pi pi-user" />
            <span>{{ BUY_GAME_ROLE_LABELS[listing.role] }}</span>
          </div>
          <div v-if="listing.guaranteeAmount" class="detail-row">
            <i class="pi pi-dollar" />
            <span>Guarantee: ${{ listing.guaranteeAmount.toLocaleString() }}</span>
          </div>
        </template>

        <!-- Home-and-Home -->
        <template v-else-if="listing.dealType === 'home-and-home'">
          <div class="detail-row">
            <i class="pi pi-calendar" />
            <span>
              Year 1: {{ listing.year1Season }}
              <span v-if="listing.year1Date"> — {{ listing.year1Date }}</span>
            </span>
          </div>
          <div class="detail-row">
            <i class="pi pi-calendar" />
            <span>
              Year 2: {{ listing.year2Season }}
              <span v-if="listing.year2Date"> — {{ listing.year2Date }}</span>
            </span>
          </div>
          <div class="detail-row">
            <i class="pi pi-home" />
            <span>{{ HOME_AND_HOME_HOST_YEAR_LABELS[listing.hostYear] }}</span>
          </div>
          <div v-if="listing.dateFlexibilityDays > 0" class="detail-row muted">
            <i class="pi pi-clock" />
            <span>±{{ listing.dateFlexibilityDays }}d flexibility</span>
          </div>
        </template>

        <!-- Neutral Site -->
        <template v-else-if="listing.dealType === 'neutral-site'">
          <div class="detail-row">
            <i class="pi pi-calendar" />
            <span>{{ listing.date }}</span>
            <span v-if="listing.dateFlexibilityDays > 0" class="flexibility">
              (±{{ listing.dateFlexibilityDays }}d flex)
            </span>
          </div>
          <div v-if="listing.venueName || listing.venueCity" class="detail-row">
            <i class="pi pi-map-marker" />
            <span>{{ [listing.venueName, listing.venueCity].filter(Boolean).join(' — ') }}</span>
          </div>
        </template>

        <!-- Shared target fields -->
        <div v-if="listing.targetNetMin || listing.targetNetMax" class="detail-row">
          <i class="pi pi-filter" />
          <span>Target NET: {{ listing.targetNetMin ?? '1' }} – {{ listing.targetNetMax ?? '363' }}</span>
        </div>

        <div v-if="listing.targetConferences.length > 0" class="detail-row">
          <i class="pi pi-tag" />
          <span>{{ listing.targetConferences.join(', ') }}</span>
        </div>

        <p v-if="listing.notes" class="listing-notes">{{ listing.notes }}</p>
      </div>
    </template>

    <template #footer>
      <div class="listing-actions">
        <Button
          v-if="listing.status === 'open' && canRespond"
          :label="respondLabel"
          icon="pi pi-handshake"
          size="small"
          @click="emit('respond', listing)"
        />
        <Button
          v-if="isOwner && listing.status === 'open'"
          label="Close"
          icon="pi pi-times"
          severity="danger"
          text
          size="small"
          @click="emit('close', listing)"
        />
        <span class="post-date">Posted {{ formatDate(listing.createdAt) }}</span>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MarketplaceListing } from '@/models'
import { DEAL_TYPE_LABELS, BUY_GAME_ROLE_LABELS, HOME_AND_HOME_HOST_YEAR_LABELS } from '@/constants'

const props = defineProps<{
  listing: MarketplaceListing
  isOwner?: boolean
  canRespond?: boolean
}>()

const emit = defineEmits<{
  respond: [listing: MarketplaceListing]
  close: [listing: MarketplaceListing]
}>()

const dealTypeSeverity = computed(() => {
  if (props.listing.dealType === 'buy-game') return 'warn'
  if (props.listing.dealType === 'home-and-home') return 'info'
  return 'success'
})

const statusSeverity = computed(() => {
  if (props.listing.status === 'open') return 'success'
  if (props.listing.status === 'matched') return 'info'
  return 'secondary'
})

const respondLabel = computed(() => {
  if (props.listing.dealType === 'buy-game') {
    return props.listing.role === 'host' ? 'Apply as Visitor' : 'Offer as Host'
  }
  if (props.listing.dealType === 'home-and-home') return 'Propose Series'
  return 'Claim Spot'
})

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString()
}
</script>

<style scoped>
.listing-card {
  height: 100%;
}

.listing-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem 0;
}

.listing-team {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.team-name {
  font-weight: 700;
}

.conference {
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
}

.listing-details {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.detail-row.muted {
  color: var(--p-text-muted-color);
}

.detail-row i {
  color: var(--p-primary-color);
  width: 16px;
  flex-shrink: 0;
}

.flexibility {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
}

.listing-notes {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}

.listing-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.post-date {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}
</style>
