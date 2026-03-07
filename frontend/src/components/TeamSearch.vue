<template>
  <AutoComplete
    v-model="selected"
    :suggestions="filtered"
    :field="displayField"
    :placeholder="placeholder"
    :loading="loading"
    force-selection
    @complete="onSearch"
    @item-select="onSelect"
  >
    <template #option="{ option }">
      <div class="team-option">
        <span class="team-name">{{ option.name }}</span>
        <span class="team-meta">
          {{ option.conference }}
          <Tag v-if="option.netRanking" :value="`#${option.netRanking}`" severity="secondary" />
        </span>
      </div>
    </template>
  </AutoComplete>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Team } from '@/models'

const props = withDefaults(defineProps<{
  teams: Team[]
  placeholder?: string
  displayField?: string
}>(), {
  placeholder: 'Search team...',
  displayField: 'name',
})

const emit = defineEmits<{
  select: [team: Team]
}>()

const selected = ref<Team | string | null>(null)
const filtered = ref<Team[]>([])
const loading = ref(false)

function onSearch(event: { query: string }) {
  const q = event.query.toLowerCase()
  filtered.value = props.teams.filter(
    t => t.name.toLowerCase().includes(q) || t.shortName?.toLowerCase().includes(q)
  ).slice(0, 20)
}

function onSelect(event: { value: Team }) {
  emit('select', event.value)
}

defineExpose({ clear: () => { selected.value = null } })
</script>

<style scoped>
.team-option {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.team-name {
  font-weight: 600;
}

.team-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}
</style>
