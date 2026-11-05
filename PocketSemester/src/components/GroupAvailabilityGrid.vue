<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'

const props = defineProps({
  availability: { type: Object, default: null },
  selectedStart: { type: String, default: '' },
  durationMinutes: { type: Number, default: 60 },
  loading: { type: Boolean, default: false },
  members: { type: Array, default: () => [] },
})
const emit = defineEmits(['select'])
const detailId = useId()
const activeSlot = shallowRef(null)
const detailElement = ref(null)
const detailPosition = ref({ left: '12px', top: '12px', visibility: 'hidden' })
let hideTimer
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
const slotMembers = computed(() => {
  if (!activeSlot.value) return { available: [], busy: [], known: false }
  const cell = activeSlot.value.cell
  const busyIds = new Set(cell.busyMemberIds || [])
  const available = props.members.filter((member) => !busyIds.has(member.id))
  const busy = props.members.filter((member) => busyIds.has(member.id))
  return {
    available,
    busy,
    known: props.members.length === cell.totalCount && available.length === cell.freeCount,
  }
})

function isActive(cell) {
  return activeSlot.value?.cell.startAt === cell.startAt
}
function hideDetails() {
  clearTimeout(hideTimer)
  activeSlot.value = null
}
function keepDetails() {
  clearTimeout(hideTimer)
}
function scheduleHide() {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hideDetails, 150)
}
async function showDetails(day, cell, event) {
  if (props.loading) return
  keepDetails()
  const anchor = event.currentTarget.getBoundingClientRect()
  const slot = { day, cell }
  activeSlot.value = slot
  detailPosition.value = { left: '12px', top: '12px', visibility: 'hidden' }
  await nextTick()
  if (activeSlot.value !== slot || !detailElement.value) return
  const { width, height } = detailElement.value.getBoundingClientRect()
  const padding = 12,
    gap = 8
  const rightFits = anchor.right + gap + width <= window.innerWidth - padding
  const leftFits = anchor.left - width - gap >= padding
  let left = rightFits ? anchor.right + gap : anchor.left - width - gap
  let top = Math.max(padding, Math.min(anchor.top, window.innerHeight - height - padding))
  let maxHeight
  if (!rightFits && !leftFits) {
    // On narrow screens, keep the detail card above or below its cell so a tap
    // can still select a bookable start without the card intercepting it.
    left = anchor.left
    const below = window.innerHeight - anchor.bottom - gap - padding
    const above = anchor.top - gap - padding
    const useBelow = below >= height || below >= above
    const room = Math.max(80, useBelow ? below : above)
    maxHeight = `${room}px`
    top = useBelow ? anchor.bottom + gap : anchor.top - Math.min(height, room) - gap
  }
  left = Math.max(padding, Math.min(left, window.innerWidth - width - padding))
  detailPosition.value = {
    left: `${left}px`,
    top: `${Math.max(padding, top)}px`,
    maxHeight,
    visibility: 'visible',
  }
}
function inspectAndSelect(day, cell, event) {
  showDetails(day, cell, event)
  select(day, cell)
}
function onPageScroll(event) {
  if (!(event.target instanceof Node && detailElement.value?.contains(event.target))) hideDetails()
}
watch(() => [props.availability, props.members, props.loading, props.durationMinutes], hideDetails)
onMounted(() => {
  window.addEventListener('scroll', onPageScroll, true)
  window.addEventListener('resize', hideDetails)
})
onBeforeUnmount(() => {
  hideDetails()
  window.removeEventListener('scroll', onPageScroll, true)
  window.removeEventListener('resize', hideDetails)
})

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
    return `${base} A full ${props.durationMinutes}-minute meeting cannot start here. Inspect for member availability.`
  return `${base} Inspect to see who is free and busy.`
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
        <span><i class="ag-dot ag-dot-some" aria-hidden="true"></i>Some free</span>
        <span><i class="ag-dot ag-dot-busy" aria-hidden="true"></i>Nobody free</span>
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
                      'ag-cell-inspected': isActive(day.byTime.get(row)),
                      'ag-cell-selected': isSelected(day.byTime.get(row)),
                      'ag-selection-start':
                        isSelected(day.byTime.get(row)) &&
                        Date.parse(day.byTime.get(row).startAt) === selectedStamp,
                      'ag-selection-end':
                        isSelected(day.byTime.get(row)) &&
                        Date.parse(day.byTime.get(row).endAt) >= selectedEnd,
                    },
                  ]"
                  :aria-disabled="!day.byTime.get(row).canBook"
                  :aria-pressed="isSelected(day.byTime.get(row))"
                  :aria-label="cellLabel(day, day.byTime.get(row))"
                  :aria-describedby="isActive(day.byTime.get(row)) ? detailId : undefined"
                  @mouseenter="showDetails(day, day.byTime.get(row), $event)"
                  @mouseleave="scheduleHide"
                  @focus="showDetails(day, day.byTime.get(row), $event)"
                  @blur="scheduleHide"
                  @keydown.esc.stop.prevent="hideDetails"
                  @click="inspectAndSelect(day, day.byTime.get(row), $event)"
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
          <span class="ag-tip-dot" aria-hidden="true"></span>Counts and colors show each
          {{ stepMinutes }}-minute slot. Hover, focus or tap for names.
        </p>
        <span v-if="selectedLabel" class="ag-selected-label" role="status"
          >Selected <span aria-hidden="true">·</span> {{ selectedLabel }}</span
        >
        <span v-else class="ag-fit-help"
          >Booking needs {{ durationMinutes }} continuous free minutes for everyone.</span
        >
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="activeSlot"
        :id="detailId"
        ref="detailElement"
        class="ag-slot-detail"
        role="tooltip"
        :style="detailPosition"
        @mouseenter="keepDetails"
        @mouseleave="scheduleHide"
      >
        <p class="ag-detail-date">{{ activeSlot.day.fullLabel }} · SGT</p>
        <h3>{{ time(activeSlot.cell.startAt) }}–{{ time(activeSlot.cell.endAt) }}</h3>
        <p class="ag-detail-summary">
          <strong>{{ activeSlot.cell.freeCount }}/{{ activeSlot.cell.totalCount }} free</strong> in
          this slot
        </p>
        <div v-if="slotMembers.known" class="ag-detail-people">
          <section class="ag-detail-free">
            <h4>
              Available <span>{{ slotMembers.available.length }}</span>
            </h4>
            <ul v-if="slotMembers.available.length">
              <li v-for="member in slotMembers.available" :key="member.id">{{ member.name }}</li>
            </ul>
            <p v-else>No one is free.</p>
          </section>
          <section class="ag-detail-busy">
            <h4>
              Unavailable <span>{{ slotMembers.busy.length }}</span>
            </h4>
            <ul v-if="slotMembers.busy.length">
              <li v-for="member in slotMembers.busy" :key="member.id">{{ member.name }}</li>
            </ul>
            <p v-else>No one is busy.</p>
          </section>
        </div>
        <p v-else class="ag-detail-unknown">Member names aren't available for this slot.</p>
        <p class="ag-detail-booking">
          {{
            activeSlot.cell.canBook
              ? `You can start a ${durationMinutes}-minute meeting here.`
              : `A full ${durationMinutes}-minute meeting cannot start here.`
          }}
        </p>
      </div>
    </Teleport>
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
  height: 25px;
  background: #fbfaff;
  text-align: center;
  font-size: 0.61rem;
  font-weight: 500;
  color: #8b8296;
  font-variant-numeric: tabular-nums;
}
.ag-bucket {
  padding: 1px 4px;
  height: 25px;
}
.ag-hour-row .ag-bucket,
.ag-hour-row .ag-time-label {
  border-top: 1px solid #eeeaf2;
}
.ag-cell {
  display: block;
  position: relative;
  width: 100%;
  height: 22px;
  min-height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  line-height: 20px;
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
.ag-cell-everyone[aria-disabled='false']:hover {
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
  color: #365f50;
}
.ag-cell-busy {
  background: #f0e5e0;
  border-color: #e9dcd6;
  color: #805f4e;
}
.ag-cell[aria-disabled='true'] {
  cursor: help;
}
.ag-cell-inspected {
  outline: 2px solid #9279bd;
  outline-offset: 1px;
  z-index: 2;
}
.ag-cell-missing {
  background: #f7f5f9;
  border-color: #f0edf4;
}
.ag-cell-count {
  display: block;
  font-size: 0.65rem;
  font-weight: 600;
  text-align: center;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}
.ag-cell-selected {
  background: #7961bd;
  border-color: #7961bd;
  border-radius: 0;
  color: #fff;
  box-shadow: 0 1px 0 1px #7961bd;
}
.ag-cell-selected[aria-disabled='false']:hover {
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
  right: 5px;
  color: #fff;
  font-size: 0.7rem;
  line-height: 20px;
}
.ag-slot-detail {
  position: fixed;
  z-index: 1080;
  width: 300px;
  max-width: calc(100vw - 24px);
  max-height: min(440px, calc(100dvh - 24px));
  overflow-y: auto;
  box-sizing: border-box;
  padding: 18px;
  border: 1px solid #ded6eb;
  border-radius: 16px;
  background: #fff;
  color: #393145;
  box-shadow: 0 14px 44px #2e23432b;
}
.ag-detail-date {
  margin: 0 0 6px;
  color: #8a7b9c;
  font-size: 0.65rem;
}
.ag-slot-detail h3 {
  margin: 0 0 12px;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.025em;
}
.ag-detail-summary {
  margin: 0 0 15px;
  color: #7b7186;
  font-size: 0.72rem;
}
.ag-detail-summary strong {
  color: #37755a;
}
.ag-detail-people {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.ag-detail-people h4 {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 9px;
  font-size: 0.67rem;
  font-weight: 650;
}
.ag-detail-people h4 span {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f2f2f4;
  color: #7c7385;
  font-size: 0.6rem;
}
.ag-detail-free h4 {
  color: #37755a;
}
.ag-detail-busy h4 {
  color: #966752;
}
.ag-detail-people ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ag-detail-people li {
  margin-bottom: 7px;
  font-size: 0.76rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.ag-detail-people p,
.ag-detail-unknown {
  color: #958a9f;
  font-size: 0.7rem;
  line-height: 1.6;
}
.ag-detail-booking {
  border-top: 1px solid #eee9f3;
  padding-top: 12px;
  margin: 12px 0 0;
  font-size: 0.67rem;
  line-height: 1.6;
  color: #8a7c99;
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
