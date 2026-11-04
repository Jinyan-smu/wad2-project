<script setup>
import { computed } from 'vue'

const props = defineProps({
  availability: { type: Object, default: null },
  selectedStart: { type: String, default: '' },
  durationMinutes: { type: Number, default: 60 },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
const timeZone = 'Asia/Singapore'
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const weekdayFormat = new Intl.DateTimeFormat('en-SG', { timeZone, weekday: 'short' })
const dayFormat = new Intl.DateTimeFormat('en-SG', { timeZone, day: 'numeric', month: 'short' })
const fullDayFormat = new Intl.DateTimeFormat('en-SG', {
  timeZone,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

function time(value) {
  return timeFormat.format(new Date(value))
}
function dayDate(value) {
  return new Date(`${value}T12:00:00+08:00`)
}
const days = computed(() =>
  (props.availability?.days || []).map((day) => ({
    ...day,
    weekday: weekdayFormat.format(dayDate(day.date)),
    label: dayFormat.format(dayDate(day.date)),
    fullLabel: fullDayFormat.format(dayDate(day.date)),
    byTime: new Map((day.cells || []).map((cell) => [time(cell.startAt), cell])),
  })),
)
// Align by Singapore time rather than array index, even if days have gaps or
// different working hours. A missing bucket never appears as an available one.
const rows = computed(() =>
  [...new Set(days.value.flatMap((day) => [...day.byTime.keys()]))].sort(),
)
const selectedStamp = computed(() => Date.parse(props.selectedStart))
const selectedEnd = computed(() => selectedStamp.value + props.durationMinutes * 60000)
const selectedLabel = computed(() => {
  if (!Number.isFinite(selectedStamp.value)) return ''
  return `${dayFormat.format(new Date(selectedStamp.value))} · ${time(selectedStamp.value)}–${time(selectedEnd.value)}`
})
const stepMinutes = computed(() => props.availability?.stepMinutes || 15)

function isSelected(cell) {
  const start = Date.parse(cell.startAt)
  return (
    Number.isFinite(selectedStamp.value) &&
    start >= selectedStamp.value &&
    start < selectedEnd.value
  )
}
function cellState(cell) {
  if (!cell.totalCount || cell.freeCount === 0) return 'busy'
  return cell.freeCount === cell.totalCount ? 'everyone' : 'some'
}
function cellLabel(day, cell) {
  const base = `${day.fullLabel}, ${time(cell.startAt)}–${time(cell.endAt)}. ${cell.freeCount} of ${cell.totalCount} members free.`
  if (isSelected(cell)) return `${base} Part of your selected meeting.`
  if (cell.canBook) return `${base} Select to start a ${props.durationMinutes}-minute meeting.`
  if (cellState(cell) === 'everyone')
    return `${base} A full ${props.durationMinutes}-minute meeting cannot start here.`
  return `${base} Unavailable for the whole team.`
}
function select(day, cell) {
  if (!cell.canBook || props.loading) return
  emit('select', {
    date: day.date,
    startAt: cell.startAt,
    endAt: new Date(Date.parse(cell.startAt) + props.durationMinutes * 60000).toISOString(),
  })
}
</script>

<template>
  <div class="ag-shell" :aria-busy="loading">
    <div class="ag-key">
      <div class="ag-legend" aria-label="Availability legend">
        <span><i class="ag-dot ag-dot-everyone" aria-hidden="true"></i>Everyone free</span>
        <span><i class="ag-dot ag-dot-some" aria-hidden="true"></i>Some busy</span>
        <span><i class="ag-dot ag-dot-busy" aria-hidden="true"></i>All busy</span>
      </div>
      <span class="ag-zone">Singapore time <span aria-hidden="true">·</span> UTC+8</span>
    </div>

    <div v-if="loading" class="ag-loading" role="status">
      <div class="ag-loading-preview" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <strong>Finding your time together…</strong>
      <p>Comparing the team's schedules.</p>
    </div>
    <div v-else-if="!days.length || !rows.length" class="ag-empty" role="status">
      <span class="ag-empty-symbol" aria-hidden="true">✦</span>
      <strong>Your next meeting starts here</strong>
      <p>Choose your dates and meeting length to see the team's availability.</p>
    </div>
    <template v-else>
      <div
        class="ag-scroll"
        tabindex="0"
        role="region"
        aria-label="Scrollable team availability calendar"
      >
        <table class="ag-table" :style="{ minWidth: `${64 + days.length * 86}px` }">
          <caption class="ag-sr-only">
            Team availability in Singapore time. Each block is
            {{
              stepMinutes
            }}
            minutes. Choose an available start time to select a
            {{
              durationMinutes
            }}-minute meeting.
          </caption>
          <thead>
            <tr>
              <th scope="col" class="ag-time-heading">TIME<span>SGT</span></th>
              <th v-for="day in days" :key="day.date" scope="col" class="ag-day-heading">
                <span>{{ day.weekday }}</span
                ><strong>{{ day.label }}</strong>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in rows"
              :key="row"
              :class="{ 'ag-hour-row': row.endsWith(':00') }"
            >
              <th scope="row" class="ag-time-label">
                <span
                  :class="{
                    'ag-sr-only': rowIndex !== 0 && !row.endsWith(':00') && !row.endsWith(':30'),
                  }"
                  >{{ row }}</span
                >
              </th>
              <td v-for="day in days" :key="day.date" class="ag-bucket">
                <button
                  v-if="day.byTime.has(row)"
                  type="button"
                  class="ag-cell"
                  :class="[
                    `ag-cell-${cellState(day.byTime.get(row))}`,
                    {
                      'ag-cell-no-fit':
                        cellState(day.byTime.get(row)) === 'everyone' &&
                        !day.byTime.get(row).canBook,
                      'ag-cell-selected': isSelected(day.byTime.get(row)),
                      'ag-selection-start':
                        isSelected(day.byTime.get(row)) &&
                        Date.parse(day.byTime.get(row).startAt) === selectedStamp,
                      'ag-selection-end':
                        isSelected(day.byTime.get(row)) &&
                        Date.parse(day.byTime.get(row).endAt) >= selectedEnd,
                    },
                  ]"
                  :disabled="!day.byTime.get(row).canBook"
                  :aria-pressed="isSelected(day.byTime.get(row))"
                  :aria-label="cellLabel(day, day.byTime.get(row))"
                  :title="cellLabel(day, day.byTime.get(row))"
                  @click="select(day, day.byTime.get(row))"
                >
                  <span class="ag-cell-count" aria-hidden="true"
                    >{{ day.byTime.get(row).freeCount }}/{{ day.byTime.get(row).totalCount }}</span
                  >
                  <span
                    v-if="Date.parse(day.byTime.get(row).startAt) === selectedStamp"
                    class="ag-selected-check"
                    aria-hidden="true"
                    >✓</span
                  >
                </button>
                <span
                  v-else
                  class="ag-cell ag-cell-missing"
                  aria-label="Outside selected hours"
                ></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="ag-footer">
        <p>
          <span class="ag-tip-dot" aria-hidden="true"></span>Pick a green start time. Each block is
          {{ stepMinutes }} minutes.
        </p>
        <span v-if="selectedLabel" class="ag-selected-label" role="status"
          >Selected <span aria-hidden="true">·</span> {{ selectedLabel }}</span
        >
        <span v-else class="ag-fit-help"
          >Striped blocks are too short, outside the meeting window, or already past.</span
        >
      </div>
    </template>
  </div>
</template>

<style scoped>
.ag-shell {
  min-width: 0;
  max-width: 100%;
  color: #302e3c;
}
.ag-key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.ag-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.ag-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  color: #625e70;
}
.ag-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  flex-shrink: 0;
}
.ag-dot-everyone {
  background: #56bb98;
}
.ag-dot-some {
  background: #c4e7db;
  border: 1px solid #a3d4c1;
}
.ag-dot-busy {
  background: #efe4df;
  border: 1px solid #e4d3ca;
}
.ag-zone {
  font-size: 0.68rem;
  font-weight: 600;
  color: #81788e;
  white-space: nowrap;
}
.ag-scroll {
  max-width: 100%;
  max-height: 500px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid #e8e7ee;
  border-radius: 15px;
  background: #fff;
  scrollbar-color: #c5bfda #f6f4fa;
  scrollbar-width: thin;
}
.ag-scroll:focus-visible {
  outline: 3px solid #a99ad1;
  outline-offset: 3px;
}
.ag-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.ag-table th,
.ag-table td {
  border: 0;
}
.ag-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 68px;
  background: #fbfaff;
  border-bottom: 1px solid #eae6f1;
  text-align: center;
}
.ag-time-heading {
  left: 0;
  width: 64px;
  z-index: 5 !important;
  color: #8a8198;
  font-size: 0.55rem;
  letter-spacing: 0.09em;
  font-weight: 650;
}
.ag-time-heading span {
  display: block;
  margin-top: 4px;
  color: #a19aab;
  font-size: 0.58rem;
  letter-spacing: 0.02em;
}
.ag-day-heading > span {
  display: block;
  color: #8a8297;
  font-size: 0.68rem;
  font-weight: 500;
}
.ag-day-heading strong {
  display: block;
  margin-top: 4px;
  color: #4b405f;
  font-size: 0.85rem;
  font-weight: 650;
}
.ag-time-label {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 64px;
  height: 21px;
  background: #fbfaff;
  text-align: center;
  font-size: 0.61rem;
  font-weight: 500;
  color: #8b8296;
  font-variant-numeric: tabular-nums;
}
.ag-bucket {
  padding: 1px 4px;
  height: 21px;
}
.ag-hour-row .ag-bucket,
.ag-hour-row .ag-time-label {
  border-top: 1px solid #eeeaf2;
}
.ag-cell {
  display: block;
  position: relative;
  width: 100%;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  line-height: 16px;
  font: inherit;
  transition:
    background 0.13s ease,
    box-shadow 0.13s ease;
}
.ag-cell-everyone {
  background: #65c4a2;
  border-color: #5dbb99;
  cursor: pointer;
  color: #164c3a;
}
.ag-cell-everyone:not(:disabled):hover {
  background: #369e79;
  border-color: #288763;
  box-shadow: 0 0 0 2px #d6eee4;
  z-index: 2;
}
.ag-cell:focus-visible {
  outline: 3px solid #7659bf;
  outline-offset: 1px;
  z-index: 4;
}
.ag-cell-some {
  background: #d3ece3;
  border-color: #c6e3d8;
  color: #507d6e;
}
.ag-cell-busy {
  background: #f0e5e0;
  border-color: #e9dcd6;
  color: #a38e82;
}
.ag-cell-no-fit {
  background: repeating-linear-gradient(135deg, #d6ece3 0, #d6ece3 4px, #c8e4d8 4px, #c8e4d8 6px);
  border-color: #c4dfd2;
  color: #688e7d;
}
.ag-cell:disabled {
  cursor: default;
  opacity: 1;
}
.ag-cell-missing {
  background: #f7f5f9;
  border-color: #f0edf4;
}
.ag-cell-count {
  display: block;
  opacity: 0;
  font-size: 0.57rem;
  text-align: center;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.ag-cell:hover .ag-cell-count,
.ag-cell:focus-visible .ag-cell-count {
  opacity: 1;
}
.ag-cell-selected {
  background: #7961bd;
  border-color: #7961bd;
  border-radius: 0;
  color: #fff;
  box-shadow: 0 1px 0 1px #7961bd;
}
.ag-cell-selected:not(:disabled):hover {
  background: #6b50af;
  border-color: #6b50af;
}
.ag-selection-start {
  border-top-left-radius: 5px;
  border-top-right-radius: 5px;
  box-shadow: 0 1px 0 1px #7961bd;
}
.ag-selection-end {
  border-bottom-left-radius: 5px;
  border-bottom-right-radius: 5px;
  box-shadow: none;
}
.ag-selected-check {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 0.7rem;
  line-height: 16px;
}
.ag-selection-start:hover .ag-cell-count,
.ag-selection-start:focus-visible .ag-cell-count {
  opacity: 0;
}
.ag-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 1px 0;
}
.ag-footer p {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 0.7rem;
  color: #746b83;
}
.ag-tip-dot {
  width: 6px;
  height: 6px;
  background: #5eb698;
  border-radius: 50%;
  flex-shrink: 0;
}
.ag-fit-help {
  font-size: 0.66rem;
  color: #93899f;
}
.ag-selected-label {
  padding: 6px 10px;
  border-radius: 7px;
  background: #f0eafb;
  color: #6a4da3;
  font-size: 0.68rem;
  font-weight: 600;
}
.ag-empty,
.ag-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  padding: 28px;
  border: 1px dashed #ded5ed;
  border-radius: 16px;
  text-align: center;
  background: radial-gradient(ellipse at top, #f4efff, #fcfbff 65%);
}
.ag-empty-symbol {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  border-radius: 15px;
  background: #e9dff7;
  color: #8a6cbb;
  font-size: 1.65rem;
}
.ag-empty strong,
.ag-loading strong {
  color: #5a476f;
  font-size: 0.93rem;
  font-weight: 650;
}
.ag-empty p,
.ag-loading p {
  max-width: 310px;
  margin: 9px 0 0;
  color: #8a7d99;
  font-size: 0.77rem;
  line-height: 1.7;
}
.ag-loading-preview {
  display: flex;
  gap: 5px;
  height: 70px;
  align-items: end;
  margin-bottom: 22px;
}
.ag-loading-preview span {
  width: 18px;
  height: 42px;
  border-radius: 5px;
  background: #bddfcf;
  animation: ag-pulse 1.4s ease-in-out infinite;
}
.ag-loading-preview span:nth-child(2),
.ag-loading-preview span:nth-child(4) {
  height: 62px;
  animation-delay: 0.15s;
  background: #b4a1d5;
}
.ag-loading-preview span:nth-child(3) {
  height: 52px;
  animation-delay: 0.3s;
  background: #8ecbb1;
}
.ag-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@keyframes ag-pulse {
  50% {
    opacity: 0.4;
    transform: scaleY(0.82);
    transform-origin: bottom;
  }
}
@media (max-width: 575.98px) {
  .ag-key {
    gap: 9px;
  }
  .ag-legend {
    gap: 10px;
  }
  .ag-legend > span {
    font-size: 0.65rem;
  }
  .ag-zone {
    font-size: 0.62rem;
  }
  .ag-scroll {
    max-height: 440px;
  }
  .ag-footer {
    align-items: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ag-cell {
    transition: none;
  }
  .ag-loading-preview span {
    animation: none;
  }
}
</style>
