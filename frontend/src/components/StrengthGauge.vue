<template>
  <div class="sos-gauge">
    <div class="gauge-value" :style="{ color: gaugeColor }">
      {{ sos !== null ? sos.toFixed(1) : '—' }}
    </div>
    <div class="gauge-label">Avg Opponent NET</div>
    <div class="gauge-bar-wrap">
      <div class="gauge-bar" :style="{ width: barPercent + '%', background: gaugeColor }" />
    </div>
    <div class="gauge-extremes">
      <span>Hardest (1)</span>
      <span>Easiest (363)</span>
    </div>
    <div v-if="displayScore !== null" class="gauge-score-badge" :style="{ background: gaugeColor }">
      Schedule Strength: {{ displayScore }}/100
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sosToDisplayScore } from '@/utils/sosCalculator'

const props = defineProps<{
  sos: number | null
  totalTeams?: number
}>()

const total = computed(() => props.totalTeams ?? 363)

const displayScore = computed(() =>
  props.sos !== null ? sosToDisplayScore(props.sos, total.value) : null
)

// Position on bar: SOS 1 = 100% left, SOS 363 = 100% right
// So barPercent = ((total - sos) / total) * 100 means 100% = hardest
const barPercent = computed(() =>
  props.sos !== null ? ((total.value - props.sos) / total.value) * 100 : 0
)

const gaugeColor = computed(() => {
  if (props.sos === null) return '#6b7280'
  const score = displayScore.value!
  if (score >= 70) return '#22c55e'
  if (score >= 50) return '#3b82f6'
  if (score >= 30) return '#f59e0b'
  return '#ef4444'
})
</script>

<style scoped>
.sos-gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}

.gauge-value {
  font-size: 3rem;
  font-weight: 800;
  line-height: 1;
}

.gauge-label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.gauge-bar-wrap {
  width: 100%;
  height: 8px;
  background: var(--p-surface-200);
  border-radius: 4px;
  overflow: hidden;
}

.gauge-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.gauge-extremes {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.gauge-score-badge {
  margin-top: 0.5rem;
  padding: 0.3rem 1rem;
  border-radius: 20px;
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
}
</style>
