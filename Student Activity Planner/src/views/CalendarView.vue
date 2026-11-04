<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import axios from 'axios'
import PlannerNavigation from '@/components/PlannerNavigation.vue'
import PlannerCompanion from '@/components/PlannerCompanion.vue'
import PlannerIcon from '@/components/icons/PlannerIcon.vue'
import {
  buildCalendarEvents,
  calendarDateKey,
  calendarWeekStart,
  eventsForCalendarDay,
  formatCalendarDate,
  formatCalendarTime,
  isCalendarDate,
  layoutCalendarDay,
  shiftCalendarDate,
} from '@/utils/calendarEvents'

const route = useRoute()
const anchor = ref(calendarDateKey())
const view = ref('month')
const events = ref([])
const unscheduled = ref(0)
const classesConnected = ref(false)
const loading = ref(true)
const loadError = ref('')
const linkNotice = ref('')
const selectedKey = ref('')
const selectedDetails = ref(null)
const categories = [
  { id: 'classes', label: 'Classes', icon: 'book' },
  { id: 'deadlines', label: 'Deadlines', icon: 'check' },
  { id: 'activities', label: 'Activities', icon: 'pin' },
  { id: 'meetings', label: 'Meetings', icon: 'users' },
]
const enabled = ref(categories.map((category) => category.id))
const filtered = computed(() =>
  events.value.filter((event) => enabled.value.includes(event.category)),
)
const selected = computed(
  () => events.value.find((event) => event.key === selectedKey.value) || null,
)
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
let request = 0
let disposed = false

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => shiftCalendarDate(calendarWeekStart(anchor.value), i)),
)
const monthDays = computed(() => {
  const first = `${anchor.value.slice(0, 7)}-01`
  const start = calendarWeekStart(first)
  return Array.from({ length: 42 }, (_, i) => shiftCalendarDate(start, i))
})
const monthRows = computed(() =>
  Array.from({ length: 6 }, (_, i) => monthDays.value.slice(i * 7, i * 7 + 7)),
)
const visibleDays = computed(() => (view.value === 'week' ? weekDays.value : [anchor.value]))
const dayEvents = (day) => eventsForCalendarDay(filtered.value, day)
const dayDeadlines = (day) => dayEvents(day).filter((event) => event.point)
const dayTimed = (day) => layoutCalendarDay(dayEvents(day))
const timedInView = computed(() => visibleDays.value.flatMap(dayTimed))
const startHour = computed(() =>
  Math.max(0, Math.min(8, ...timedInView.value.map((event) => Math.floor(event.startMinute / 60)))),
)
const endHour = computed(() =>
  Math.min(24, Math.max(21, ...timedInView.value.map((event) => Math.ceil(event.endMinute / 60)))),
)
const hours = computed(() =>
  Array.from({ length: endHour.value - startHour.value + 1 }, (_, i) => startHour.value + i),
)
const scheduleHeight = computed(() => (endHour.value - startHour.value) * 42)
const periodTitle = computed(() => {
  if (view.value === 'month')
    return formatCalendarDate(anchor.value, { month: 'long', year: 'numeric' })
  if (view.value === 'day')
    return formatCalendarDate(anchor.value, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  const first = weekDays.value[0],
    last = weekDays.value[6]
  return `${formatCalendarDate(first, { day: 'numeric', month: 'short' })} – ${formatCalendarDate(last, { day: 'numeric', month: 'short', year: 'numeric' })}`
})
const visibleCount = computed(() => {
  if (view.value !== 'month')
    return new Set(visibleDays.value.flatMap(dayEvents).map((event) => event.key)).size
  return filtered.value.filter((event) => {
    const first = `${anchor.value.slice(0, 7)}-01`
    const date = new Date(`${first}T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + 1)
    const next = date.toISOString().slice(0, 10)
    return (
      Date.parse(event.startAt) < Date.parse(`${next}T00:00:00+08:00`) &&
      (event.point
        ? Date.parse(event.startAt) >= Date.parse(`${first}T00:00:00+08:00`)
        : Date.parse(event.endAt) > Date.parse(`${first}T00:00:00+08:00`))
    )
  }).length
})

function toggleCategory(id) {
  enabled.value = enabled.value.includes(id)
    ? enabled.value.filter((category) => category !== id)
    : [...enabled.value, id]
  if (selected.value && !enabled.value.includes(selected.value.category)) selectedKey.value = ''
}
function selectDay(day) {
  anchor.value = day
  selectedKey.value = dayEvents(day)[0]?.key || ''
}
async function selectEvent(event, focusDetails = false) {
  selectedKey.value = event.key
  anchor.value = calendarDateKey(new Date(event.segmentStart ?? event.startAt))
  if (focusDetails) {
    await nextTick()
    selectedDetails.value?.focus({ preventScroll: true })
    selectedDetails.value?.scrollIntoView?.({ block: 'nearest' })
  }
}
function navigate(direction) {
  if (view.value === 'month') {
    const date = new Date(`${anchor.value.slice(0, 7)}-01T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + direction)
    anchor.value = date.toISOString().slice(0, 10)
  } else anchor.value = shiftCalendarDate(anchor.value, direction * (view.value === 'week' ? 7 : 1))
  selectedKey.value = ''
}
function today() {
  anchor.value = calendarDateKey()
  selectedKey.value = ''
}
function hourLabel(hour) {
  return hour === 24 ? '12 AM' : `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`
}
function eventTime(event) {
  if (event.point) return `${event.pointLabel} ${formatCalendarTime(event.startAt)}`
  const startDay = calendarDateKey(event.startAt),
    endDay = calendarDateKey(event.endAt)
  return `${formatCalendarTime(event.startAt)} – ${startDay === endDay ? '' : formatCalendarDate(endDay) + ', '}${formatCalendarTime(event.endAt)}`
}
function eventLabel(event) {
  return `${event.title}, ${formatCalendarDate(calendarDateKey(event.startAt))}, ${eventTime(event)}${event.done ? ', completed' : ''}`
}
function timedStyle(event) {
  const height = Math.max(22, ((event.endMinute - event.startMinute) / 60) * 42 - 3)
  return {
    top: `${(event.startMinute / 60 - startHour.value) * 42}px`,
    height: `${height}px`,
    left: `calc(${(event.lane / event.lanes) * 100}% + 3px)`,
    width: `calc(${100 / event.lanes}% - 6px)`,
  }
}
function applyRoute() {
  linkNotice.value = ''
  const date = route.query.date
  if (typeof date === 'string' && isCalendarDate(date)) anchor.value = date
  const key = route.query.event
  if (typeof key === 'string') {
    const event = events.value.find((item) => item.key === key)
    if (event) {
      if (!enabled.value.includes(event.category)) enabled.value.push(event.category)
      selectedKey.value = event.key
      anchor.value = calendarDateKey(event.startAt)
    } else if (!loading.value && !loadError.value)
      linkNotice.value =
        'This item is not on your calendar. It may have been removed or does not have a valid date.'
  }
}
async function loadCalendar() {
  const current = ++request
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get('http://localhost:8000/api/planner-data', {
      withCredentials: true,
    })
    if (disposed || current !== request) return
    const result = buildCalendarEvents(data)
    events.value = result.events
    unscheduled.value = result.unscheduled
    classesConnected.value = Array.isArray(data.classSessions) && data.classSessions.length > 0
    if (selectedKey.value && !events.value.some((event) => event.key === selectedKey.value))
      selectedKey.value = ''
  } catch (error) {
    if (!disposed && current === request) {
      const message = error?.response?.data?.message
      loadError.value =
        typeof message === 'string' && message.trim()
          ? message
          : 'Could not load your calendar. Please try again.'
    }
  } finally {
    if (!disposed && current === request) {
      loading.value = false
      applyRoute()
    }
  }
}
watch(() => [route.query.event, route.query.date], applyRoute)
onMounted(() => {
  if (window.matchMedia?.('(max-width: 620px)')?.matches) view.value = 'day'
  applyRoute()
  loadCalendar()
})
onBeforeUnmount(() => {
  disposed = true
  request++
})
</script>

<template>
  <div class="app calendar-app">
    <PlannerNavigation active="/calendar" />
    <main class="main calendar-main">
      <div class="container-xxl calendar-container">
        <PlannerNavigation active="/calendar" mobile />
        <header class="header calendar-heading">
          <div>
            <p class="eyebrow">THE WHOLE PICTURE</p>
            <h1>Your calendar</h1>
            <p>Classes, deadlines, and good plans. All together.</p>
          </div>
          <button
            type="button"
            class="btn btn-light btn-sm calendar-refresh"
            :disabled="loading"
            @click="loadCalendar"
          >
            {{ loading ? 'Refreshing…' : 'Refresh calendar' }}
          </button>
        </header>
        <PlannerCompanion character="purple" message="A little room for everything that matters." />
        <div v-if="loadError" class="alert alert-danger" role="alert">
          {{ loadError }}
          <button type="button" class="btn btn-sm btn-outline-danger" @click="loadCalendar">
            Try again
          </button>
        </div>
        <p v-if="linkNotice" class="calendar-notice" role="status">{{ linkNotice }}</p>
        <div class="calendar-toolbar">
          <div class="calendar-filters" role="group" aria-label="Visible event types">
            <button
              v-for="category in categories"
              :key="category.id"
              type="button"
              class="calendar-filter"
              :class="`category-${category.id}`"
              :aria-pressed="enabled.includes(category.id)"
              @click="toggleCategory(category.id)"
            >
              <span></span>{{ category.label }}
            </button>
          </div>
          <div class="calendar-views" role="group" aria-label="Calendar view">
            <button
              v-for="mode in ['month', 'week', 'day']"
              :key="mode"
              type="button"
              :aria-pressed="view === mode"
              @click="view = mode"
            >
              {{ mode.charAt(0).toUpperCase() + mode.slice(1) }}
            </button>
          </div>
        </div>
        <p
          v-if="!loading && !loadError && !classesConnected && enabled.includes('classes')"
          class="calendar-source-note"
        >
          No class timetable connected. Your saved coursework, activities, and group meetings are
          still shown.
        </p>
        <p v-if="!loading && !loadError && unscheduled" class="calendar-source-note">
          {{ unscheduled }} {{ unscheduled === 1 ? 'item has' : 'items have' }} no valid date or
          time range and cannot be placed on the calendar. Check the original page to update
          {{ unscheduled === 1 ? 'it' : 'them' }}.
        </p>
        <div v-if="loading" class="calendar-loading" role="status">Gathering your plans…</div>
        <template v-else-if="!loadError">
          <section class="calendar-board" :aria-label="periodTitle">
            <header class="calendar-period">
              <h2>{{ periodTitle }}</h2>
              <div class="calendar-period-actions">
                <button
                  type="button"
                  class="calendar-arrow"
                  :aria-label="`Previous ${view}`"
                  @click="navigate(-1)"
                >
                  <PlannerIcon name="left" /></button
                ><button
                  type="button"
                  class="calendar-arrow"
                  :aria-label="`Next ${view}`"
                  @click="navigate(1)"
                >
                  <PlannerIcon name="right" /></button
                ><button type="button" class="calendar-today" @click="today">Today</button>
              </div>
              <span class="calendar-time-zone">Singapore · UTC+8</span>
            </header>
            <p v-if="!enabled.length" class="calendar-empty" role="status">
              Choose an event type above to see your plans.
            </p>
            <p v-else-if="!visibleCount" class="calendar-empty" role="status">
              No events in this {{ view }} for the selected event types.
            </p>
            <table v-if="view === 'month'" class="calendar-month" :aria-label="periodTitle">
              <thead>
                <tr>
                  <th v-for="day in weekdayNames" :key="day" scope="col">{{ day }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(week, index) in monthRows" :key="index">
                  <td
                    v-for="day in week"
                    :key="day"
                    :class="{
                      'outside-month': day.slice(0, 7) !== anchor.slice(0, 7),
                      'selected-day': day === anchor,
                    }"
                  >
                    <button
                      type="button"
                      class="calendar-date"
                      :class="{ 'is-today': day === calendarDateKey() }"
                      :aria-label="
                        formatCalendarDate(day, {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })
                      "
                      :aria-pressed="day === anchor"
                      @click="selectDay(day)"
                    >
                      {{ Number(day.slice(-2)) }}
                    </button>
                    <ul v-if="dayEvents(day).length" class="calendar-month-events">
                      <li v-for="event in dayEvents(day).slice(0, 3)" :key="event.key">
                        <button
                          type="button"
                          :class="[`category-${event.category}`, { 'event-completed': event.done }]"
                          :aria-label="eventLabel(event)"
                          @click="selectEvent(event, true)"
                        >
                          <span class="event-dot"></span
                          ><span class="month-event-text"
                            >{{ event.point ? event.pointLabel + ': ' : '' }}{{ event.title }}</span
                          >
                        </button>
                      </li>
                    </ul>
                    <button
                      v-if="dayEvents(day).length > 3"
                      type="button"
                      class="calendar-more"
                      :aria-label="`View all ${dayEvents(day).length} events on ${formatCalendarDate(day)}`"
                      @click="selectDay(day)"
                    >
                      +{{ dayEvents(day).length - 3 }} more
                    </button>
                    <span
                      v-if="dayEvents(day).length"
                      class="calendar-mobile-count"
                      aria-hidden="true"
                      >{{ dayEvents(day).length }}
                      {{ dayEvents(day).length === 1 ? 'plan' : 'plans' }}</span
                    >
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              v-else
              class="calendar-schedule"
              :class="{ 'calendar-schedule-week': view === 'week' }"
            >
              <div
                class="calendar-schedule-labels"
                :style="{
                  gridTemplateColumns: `42px repeat(${visibleDays.length}, minmax(0, 1fr))`,
                }"
              >
                <span></span>
                <div
                  v-for="day in visibleDays"
                  :key="day"
                  :class="{ 'is-today-label': day === calendarDateKey() }"
                >
                  <span>{{ formatCalendarDate(day, { weekday: 'short' }) }}</span
                  ><strong>{{ Number(day.slice(-2)) }}</strong>
                </div>
              </div>
              <div
                v-if="visibleDays.some((day) => dayDeadlines(day).length)"
                class="calendar-deadline-row"
                :style="{
                  gridTemplateColumns: `42px repeat(${visibleDays.length}, minmax(0, 1fr))`,
                }"
              >
                <span class="calendar-deadline-label">Dates</span>
                <div v-for="day in visibleDays" :key="day">
                  <button
                    v-for="event in dayDeadlines(day)"
                    :key="event.key"
                    type="button"
                    class="calendar-point category-deadlines"
                    :aria-label="eventLabel(event)"
                    @click="selectEvent(event, true)"
                  >
                    <strong>{{ event.pointLabel }} {{ formatCalendarTime(event.startAt) }}</strong
                    ><span>{{ event.title }}</span>
                  </button>
                </div>
              </div>
              <div
                class="calendar-timeline"
                :style="{
                  gridTemplateColumns: `42px repeat(${visibleDays.length}, minmax(0, 1fr))`,
                  height: `${scheduleHeight}px`,
                }"
              >
                <div class="calendar-hours">
                  <span
                    v-for="hour in hours"
                    :key="hour"
                    :style="{ top: `${(hour - startHour) * 42}px` }"
                    >{{ hourLabel(hour) }}</span
                  >
                </div>
                <div v-for="day in visibleDays" :key="day" class="calendar-day-track">
                  <span
                    v-for="hour in hours"
                    :key="hour"
                    class="calendar-hour-rule"
                    :style="{ top: `${(hour - startHour) * 42}px` }"
                  ></span
                  ><button
                    v-for="event in dayTimed(day)"
                    :key="event.key"
                    type="button"
                    class="calendar-block"
                    :class="[`category-${event.category}`, { 'event-completed': event.done }]"
                    :style="timedStyle(event)"
                    :aria-label="eventLabel(event)"
                    @click="selectEvent(event, true)"
                  >
                    <strong>{{ event.title }}</strong
                    ><span>{{ event.location || event.course }}</span
                    ><small v-if="event.continuesBefore || event.continuesAfter">{{
                      event.continuesBefore ? 'Continues from previous day' : 'Continues next day'
                    }}</small>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="view === 'month' || view === 'week'"
            class="calendar-agenda"
            :class="{ 'calendar-week-agenda': view === 'week' }"
            :aria-label="view === 'week' ? 'Week agenda' : 'Selected day agenda'"
          >
            <template v-for="day in view === 'week' ? weekDays : [anchor]" :key="day"
              ><h2>
                {{ formatCalendarDate(day, { weekday: 'long', day: 'numeric', month: 'short' }) }}
              </h2>
              <p v-if="!dayEvents(day).length" class="calendar-agenda-empty">
                No events for the selected types.
              </p>
              <div v-for="event in dayEvents(day)" :key="event.key" class="calendar-agenda-row">
                <span :class="`category-${event.category}`" class="event-dot"></span
                ><button
                  type="button"
                  :aria-label="eventLabel(event)"
                  @click="selectEvent(event, true)"
                >
                  <strong>{{ event.title }}</strong
                  ><small>{{ eventTime(event) }}{{ event.done ? ' · Completed' : '' }}</small>
                </button>
              </div></template
            >
          </section>

          <section
            v-if="selected"
            ref="selectedDetails"
            tabindex="-1"
            class="calendar-details"
            aria-labelledby="calendar-selected-title"
          >
            <span class="calendar-detail-icon"
              ><PlannerIcon
                :name="
                  categories.find((category) => category.id === selected.category)?.icon ||
                  'calendar'
                "
            /></span>
            <div>
              <p class="calendar-detail-type">
                {{ formatCalendarDate(calendarDateKey(selected.startAt)) }} ·
                {{ selected.type === 'meeting' ? 'Group meeting' : selected.type }}
              </p>
              <h2 id="calendar-selected-title">{{ selected.title }}</h2>
              <p>
                {{ eventTime(selected)
                }}<template v-if="selected.course"> · {{ selected.course }}</template
                ><template v-if="selected.location"> · {{ selected.location }}</template
                ><span v-if="selected.done"> · Completed</span>
              </p>
              <p>{{ selected.description }}</p>
              <RouterLink v-if="selected.to" :to="selected.to" class="calendar-source-link"
                >{{ selected.action }} <PlannerIcon name="arrow"
              /></RouterLink>
            </div>
          </section>
          <p v-else class="calendar-selection-hint">Select an event to see its details.</p>
          <p class="calendar-footnote">
            Coursework dates are reminders, not blocked study time. Timed plans use Singapore time.
          </p>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.calendar-container {
  max-width: 1440px;
}
.calendar-heading {
  align-items: flex-start;
}
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin: 0 0 16px;
}
.calendar-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.calendar-filter {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--ink);
  font-size: 0.75rem;
}
.calendar-filter[aria-pressed='false'] {
  opacity: 0.48;
}
.calendar-filter > span,
.event-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--event-color);
}
.category-classes {
  --event-color: #4779be;
  --event-soft: #e9f0fd;
  --event-ink: #315e9c;
}
.category-deadlines {
  --event-color: #c05e79;
  --event-soft: #fbeaf0;
  --event-ink: #a4415e;
}
.category-activities {
  --event-color: #4c9474;
  --event-soft: #e8f4ed;
  --event-ink: #356e53;
}
.category-meetings {
  --event-color: #8a67c2;
  --event-soft: #f0e9fa;
  --event-ink: #6a4b9a;
}
.calendar-views {
  display: flex;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  gap: 3px;
}
.calendar-views button {
  border: 0;
  border-radius: 6px;
  padding: 7px 12px;
  background: transparent;
  color: var(--muted);
  font-size: 0.75rem;
}
.calendar-views button[aria-pressed='true'] {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}
.calendar-source-note,
.calendar-notice {
  color: var(--muted);
  font-size: 0.73rem;
  line-height: 1.7;
  margin: 0 0 12px;
}
.calendar-board {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 19px 17px 17px;
}
.calendar-period {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 22px;
}
.calendar-period h2 {
  margin: 0;
  font-size: 1.05rem;
}
.calendar-period-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.calendar-arrow {
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
}
.calendar-arrow:hover {
  background: var(--brand-soft);
}
.calendar-arrow .planner-icon {
  width: 17px;
  height: 17px;
}
.calendar-today {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  padding: 5px 10px;
  margin-left: 5px;
  color: var(--brand);
  font-size: 0.7rem;
}
.calendar-time-zone {
  margin-left: auto;
  font-size: 0.68rem;
  color: var(--muted);
}
.calendar-month {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.calendar-month th {
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--muted);
  padding: 0 7px 10px;
}
.calendar-month td {
  height: 103px;
  vertical-align: top;
  border: 1px solid #efebf3;
  padding: 7px 5px;
}
.calendar-month td.outside-month {
  background: #fbfafd;
}
.calendar-month td.selected-day {
  background: #f9f7fd;
}
.calendar-date {
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  width: 25px;
  height: 25px;
  padding: 0;
  margin-bottom: 4px;
  background: transparent;
  color: var(--ink);
  font-size: 0.7rem;
}
.outside-month .calendar-date {
  color: #aaa1b4;
}
.calendar-date.is-today {
  color: #fff;
  background: var(--brand);
  font-weight: 600;
}
.calendar-date[aria-pressed='true']:not(.is-today) {
  background: #e9e1f5;
  color: var(--brand);
}
.calendar-month-events {
  list-style: none;
  margin: 0;
  padding: 0;
}
.calendar-month-events button {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  min-width: 0;
  width: 100%;
  padding: 3px 1px;
  text-align: left;
  color: var(--ink);
  font-size: 0.63rem;
}
.calendar-month-events .event-dot {
  width: 5px;
  height: 5px;
  flex-basis: 5px;
}
.month-event-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calendar-more {
  border: 0;
  background: transparent;
  color: var(--brand);
  font-size: 0.61rem;
  padding: 3px 0;
}
.calendar-mobile-count {
  display: none;
}
.calendar-empty,
.calendar-loading {
  color: var(--muted);
  font-size: 0.8rem;
  padding: 18px 8px;
  line-height: 1.8;
}
.calendar-loading {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 13px;
}
.calendar-schedule-labels,
.calendar-deadline-row,
.calendar-timeline {
  display: grid;
}
.calendar-schedule-labels > div {
  text-align: center;
  padding: 0 2px 12px;
}
.calendar-schedule-labels span {
  display: block;
  font-size: 0.66rem;
  color: var(--muted);
}
.calendar-schedule-labels strong {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  font-weight: 600;
  font-size: 0.9rem;
  margin-top: 4px;
  border-radius: 50%;
}
.calendar-schedule-labels .is-today-label strong {
  background: var(--brand);
  color: #fff;
}
.calendar-deadline-row {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  gap: 3px;
}
.calendar-deadline-label {
  color: var(--muted);
  font-size: 0.6rem;
  padding-top: 6px;
}
.calendar-point {
  display: block;
  text-align: left;
  width: 100%;
  min-width: 0;
  padding: 7px 6px;
  margin-bottom: 4px;
  border: 0;
  border-radius: 6px;
  color: var(--event-ink);
  background: var(--event-soft);
  font-size: 0.65rem;
  overflow-wrap: anywhere;
}
.calendar-point strong,
.calendar-point span {
  display: block;
  font-size: inherit;
}
.calendar-point strong {
  font-weight: 600;
  margin-bottom: 3px;
}
.calendar-timeline {
  position: relative;
  margin: 8px 0 14px;
}
.calendar-hours {
  position: relative;
}
.calendar-hours > span {
  position: absolute;
  right: 6px;
  transform: translateY(-50%);
  color: var(--muted);
  font-size: 0.57rem;
  white-space: nowrap;
}
.calendar-day-track {
  position: relative;
  min-width: 0;
  border-left: 1px solid #eeeaf3;
}
.calendar-hour-rule {
  display: block;
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: #eeeaf3;
}
.calendar-block {
  position: absolute;
  z-index: 1;
  display: block;
  text-align: left;
  padding: 7px 6px;
  border: 0;
  border-left: 2px solid var(--event-color);
  border-radius: 6px;
  color: var(--event-ink);
  background: var(--event-soft);
  overflow: hidden;
  min-width: 0;
}
.calendar-block strong {
  display: block;
  font-size: 0.67rem;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.calendar-block > span,
.calendar-block small {
  display: block;
  margin-top: 5px;
  font-size: 0.6rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.event-completed {
  opacity: 0.6;
}
.calendar-details {
  display: flex;
  gap: 13px;
  margin-top: 18px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 20px;
}
.calendar-details h2 {
  margin: 0 0 7px;
  font-size: 1rem;
}
.calendar-details p {
  margin: 0 0 5px;
  font-size: 0.77rem;
  line-height: 1.7;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.calendar-details .calendar-detail-type {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
.calendar-detail-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 11px;
  background: var(--brand-soft);
}
.calendar-source-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 11px;
  color: var(--brand);
  font-size: 0.75rem;
  text-decoration: none;
  font-weight: 600;
}
.calendar-source-link .planner-icon {
  width: 15px;
  height: 15px;
}
.calendar-agenda {
  margin-top: 17px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 18px;
}
.calendar-agenda h2 {
  font-size: 0.86rem;
  margin: 0 0 10px;
}
.calendar-agenda-empty {
  margin: 0 0 15px;
  color: var(--muted);
  font-size: 0.76rem;
}
.calendar-agenda-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding: 9px 0;
}
.calendar-agenda-row button {
  text-align: left;
  display: block;
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
}
.calendar-agenda-row strong,
.calendar-agenda-row small {
  display: block;
  overflow-wrap: anywhere;
}
.calendar-agenda-row strong {
  font-size: 0.77rem;
  font-weight: 600;
}
.calendar-agenda-row small {
  font-size: 0.68rem;
  color: var(--muted);
  line-height: 1.7;
  margin-top: 4px;
}
.calendar-week-agenda {
  display: none;
}
.calendar-selection-hint,
.calendar-footnote {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 0.69rem;
  line-height: 1.7;
}
@media (max-width: 700px) {
  .calendar-details {
    scroll-margin-top: calc(var(--mobile-nav-height, 68px) + 20px);
  }
  .calendar-board {
    padding: 16px 10px;
  }
  .calendar-period {
    gap: 9px;
  }
  .calendar-time-zone {
    margin-left: 0;
    flex-basis: 100%;
  }
  .calendar-period h2 {
    font-size: 0.94rem;
  }
  .calendar-month td {
    height: 76px;
    padding: 5px 2px;
  }
  .calendar-month th {
    text-align: center;
    font-size: 0.62rem;
  }
  .calendar-month-events {
    display: none;
  }
  .calendar-more {
    display: none;
  }
  .calendar-mobile-count {
    display: block;
    text-align: center;
    color: var(--brand);
    font-size: 0.57rem;
    margin-top: 5px;
  }
  .calendar-date {
    margin-left: auto;
    margin-right: auto;
  }
  .calendar-schedule-week {
    display: none;
  }
  .calendar-week-agenda {
    display: block;
  }
  .calendar-details {
    padding: 16px 13px;
  }
  .calendar-detail-icon {
    display: none;
  }
  .calendar-filter {
    padding: 9px 11px;
  }
  .calendar-views button {
    padding: 9px 15px;
  }
}
</style>
