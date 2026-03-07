<template>
  <Card class="listing-card">
    <template #header>
      <div class="listing-header">
        <Tag
          :value="listing.type === 'request' ? 'REQUEST' : 'OFFER'"
          :severity="listing.type === 'request' ? 'warn' : 'success'"
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
        <div class="detail-row">
          <i class="pi pi-calendar" />
          <span>{{ listing.date }}</span>
          <span v-if="listing.dateFlexibilityDays > 0" class="flexibility">
            (±{{ listing.dateFlexibilityDays }}d flex)
          </span>
        </div>

        <div class="detail-row">
          <i class="pi pi-map-marker" />
          <span>{{ LOCATION_LABELS[listing.preferredLocation] }}</span>
        </div>

        <div v-if="listing.targetNetMin || listing.targetNetMax" class="detail-row">
          <i class="pi pi-filter" />
          <span>
            Target NET:
            {{ listing.targetNetMin ?? '1' }} – {{ listing.targetNetMax ?? '363' }}
          </span>
        </div>

        <div v-if="listing.targetConferences.length > 0" class="detail-row">
          <i class="pi pi-tag" />
          <span>{{ listing.targetConferences.join(', ') }}</span>
        </div>

        <div v-if="listing.compensationNotes" class="detail-row">
          <i class="pi pi-dollar" />
          <span>{{ listing.compensationNotes }}</span>
        </div>

        <p v-if="listing.notes" class="listing-notes">{{ listing.notes }}</p>
      </div>
    </template>

    <template #footer>
      <div class="listing-actions">
        <Button
          v-if="listing.status === 'open' && canRespond"
          :label="listing.type === 'request' ? 'Make Offer' : 'Accept'"
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
import { LOCATION_LABELS } from '@/constants'

const props = defineProps<{
  listing: MarketplaceListing
  isOwner?: boolean
  canRespond?: boolean
}>()

const emit = defineEmits<{
  respond: [listing: MarketplaceListing]
  close: [listing: MarketplaceListing]
}>()

const statusSeverity = computed(() => {
  if (props.listing.status === 'open') return 'success'
  if (props.listing.status === 'matched') return 'info'
  return 'secondary'
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

.detail-row i {
  color: var(--p-primary-color);
  width: 16px;
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
