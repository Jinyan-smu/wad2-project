<script setup>
import { computed, useId } from 'vue'

const props = defineProps({
  days: { type: Array, required: true },
  selectedKey: { type: String, required: true },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
const legendId = useId()
const selectedIndex = computed(() => props.days.findIndex((day) => day.key === props.selectedKey))
const selectorStyle = computed(() => ({
  '--day-count': props.days.length || 7,
  '--selected-index': Math.max(0, selectedIndex.value),
}))
function workload(day) {
  return day.count >= 5 ? 'busy' : day.count >= 3 ? 'moderate' : day.count ? 'light' : 'clear'
}
function dayDescription(day) {
  const date = day.date.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const label = date + (day.today ? ', today' : '')
  return props.loading
    ? label + ', loading plans'
    : label +
        ', ' +
        day.count +
        ' pending items, ' +
        day.deadlines +
        ' coursework deadlines, ' +
        workload(day) +
        ' day'
}
</script>

<template>
  <div class="week-selector">
    <p :id="legendId" class="visually-hidden">
      The small bar shows pending workload: light is 1–2 items, moderate is 3–4, and busy is 5 or
      more. Dots show coursework deadlines, up to three with a plus for additional deadlines.
    </p>
    <div
      class="week-selector-grid"
      :style="selectorStyle"
      role="group"
      aria-label="Choose a day"
      :aria-describedby="legendId"
      :aria-busy="loading"
    >
      <span
        class="day-selection"
        :class="{ 'has-selection': selectedIndex >= 0 }"
        aria-hidden="true"
      ></span>
      <button
        v-for="day in days"
        :key="day.key"
        type="button"
        class="week-day btn d-flex flex-column align-items-center justify-content-center"
        :class="{ selected: day.key === selectedKey, 'is-today': day.today }"
        :aria-pressed="day.key === selectedKey"
        :aria-label="dayDescription(day)"
        :title="
          loading ? 'Loading plans' : day.count + ' pending items · ' + workload(day) + ' day'
        "
        :data-date="day.key"
        @click="emit('select', day.date)"
      >
        <span class="day-label">
          <span class="day-name">{{ day.label }}</span
          ><strong>{{ day.date.getDate() }}</strong>
        </span>
        <span class="day-dots" aria-hidden="true">
          <span
            v-for="dot in loading ? 0 : Math.min(day.deadlines, 3)"
            :key="dot"
            class="day-dot"
          ></span>
          <small v-if="!loading && day.deadlines > 3">+</small>
        </span>
        <span
          class="day-workload"
          :data-workload="loading ? 'loading' : workload(day)"
          aria-hidden="true"
        >
          <span v-if="!loading && day.count" class="day-workload-fill"></span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.week-selector-grid {
  --day-gap: 4px;
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: repeat(var(--day-count), minmax(0, 1fr));
  gap: var(--day-gap);
  background: #faf8fd;
  border-radius: 12px;
}
.day-selection {
  position: absolute;
  z-index: 0;
  inset-block: 0;
  inset-inline-start: 0;
  width: calc((100% - (var(--day-count) - 1) * var(--day-gap)) / var(--day-count));
  border-radius: 12px;
  background: linear-gradient(145deg, var(--brand), #7b60ba);
  box-shadow: 0 5px 12px #6250a526;
  opacity: 0;
  transform: translateX(calc(var(--selected-index) * (100% + var(--day-gap))));
  transition:
    transform 240ms cubic-bezier(0.2, 0.75, 0.25, 1),
    opacity 160ms ease;
  pointer-events: none;
}
.day-selection.has-selection {
  opacity: 1;
}
.week-selector-grid .week-day:not(.selected),
.week-selector-grid .week-day.selected {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 84px;
  padding: 11px 2px;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--muted);
  box-shadow: none;
  transition:
    color 180ms ease,
    border-color 180ms ease,
    transform 150ms ease;
}
.week-selector-grid .week-day.is-today:not(.selected) {
  border-color: #cfc4e6;
}
.week-selector-grid .week-day.selected {
  border-color: transparent;
  color: #fff;
}
.week-selector-grid .week-day:focus-visible {
  outline: 3px solid #a99acb;
  outline-offset: 3px;
}
.week-selector-grid .week-day:active {
  transform: scale(0.97);
}
.week-selector-grid .day-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.week-selector-grid .day-name {
  font-size: 0.8rem;
  font-weight: 600;
}
.week-selector-grid .week-day strong {
  color: inherit;
  font-size: 1.1rem;
  line-height: 1.25;
  font-weight: 600;
}
.week-selector-grid .day-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 8px;
}
.week-selector-grid .day-dots .day-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  color: inherit;
}
.week-selector-grid .day-dots small {
  font-size: 0.6rem;
  line-height: 1;
}
.day-workload {
  display: block;
  width: 28px;
  height: 3px;
  border-radius: 3px;
  background: #e4dfec;
  overflow: hidden;
}
.day-workload-fill {
  display: block;
  width: 33%;
  height: 100%;
  border-radius: inherit;
  background: #a18bc7;
  transition: width 200ms ease;
}
[data-workload='moderate'] .day-workload-fill {
  width: 66%;
  background: #9c762c;
}
[data-workload='busy'] .day-workload-fill {
  width: 100%;
  background: #ab5269;
}
.selected .day-workload {
  background: #ffffff35;
}
.selected .day-workload .day-workload-fill {
  background: #fff;
}
@media (min-width: 576px) {
  .week-selector-grid {
    --day-gap: 8px;
  }
}
@media (max-width: 575.98px) {
  .week-selector-grid .day-label {
    flex-direction: column;
    gap: 2px;
  }
  .week-selector-grid .day-name {
    font-size: 0.66rem;
  }
  .week-selector-grid .week-day:not(.selected),
  .week-selector-grid .week-day.selected {
    min-height: 96px;
  }
}
@media (hover: hover) {
  .week-selector-grid .week-day:not(.selected):hover {
    border-color: #bdb0d6;
    color: var(--brand);
    transform: translateY(-2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .day-selection,
  .week-selector-grid .week-day:not(.selected),
  .week-selector-grid .week-day.selected,
  .day-workload-fill {
    transition: none;
  }
  .week-selector-grid .week-day:not(.selected):hover,
  .week-selector-grid .week-day:active {
    transform: none;
  }
}
</style>
