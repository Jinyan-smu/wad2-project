<script setup>
import { ref, computed, onMounted, onUnmounted, watch, toRef, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import axios from 'axios'
import PlannerNavigation from './PlannerNavigation.vue'
import PlannerIcon from './PlannerIcon.vue'
import TaskUrgencyBadge from './TaskUrgencyBadge.vue'
import DashboardTools from './DashboardTools.vue'
import { createDashboardPersonalization } from '../utils/dashboardPersonalization'
import { getTaskUrgency } from '../utils/taskUrgency'

const API_URL = 'http://localhost:8000/api'
const personal = createDashboardPersonalization()
const userName = ref('there')
const plannerLoading = ref(true)
const plannerError = ref('')
const actionError = ref('')
const savingItems = ref([])
const assignments = ref([])
const quizzes = ref([])
const activities = ref([])
const announcements = ref([])
const announcementsOpen = toRef(personal.state.preferences, 'announcementsOpen')
const conflictsOpen = toRef(personal.state.preferences, 'conflictsOpen')
const progressOpen = toRef(personal.state.preferences, 'progressOpen')
async function reviewConflicts() {
  conflictsOpen.value = true
  await nextTick()
  document.getElementById('dashboard-conflict-details')?.scrollIntoView?.({ block: 'nearest' })
  document.getElementById('conflict-toggle')?.focus()
}
const now = ref(new Date())
const selectedDate = ref(startOfDay(now.value))
const weekStart = ref(startOfWeek(now.value))
const filter = toRef(personal.state.preferences, 'filter')
const agendaMode = toRef(personal.state.preferences, 'agendaMode')
const timelinePage = ref(0)
const PAGE_SIZE = 6
let clockInterval

const filters = [
  { value: 'all', label: 'All' },
  { value: 'assignment', label: 'Assignments' },
  { value: 'quiz', label: 'Quizzes' },
  { value: 'activity', label: 'Activities' },
]

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}
function addDays(date, amount) {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}
function startOfWeek(date) {
  return addDays(startOfDay(date), -((date.getDay() + 6) % 7))
}
function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
function dateText(date, options) {
  return date.toLocaleDateString('en-SG', options)
}
function time(date) {
  return date.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
}
function dayLabel(date) {
  if (dateKey(date) === dateKey(now.value)) return 'Today'
  if (dateKey(date) === dateKey(addDays(now.value, 1))) return 'Tomorrow'
  return dateText(date, { day: 'numeric', month: 'short' })
}
function isOverdue(item) {
  return !item.done && item.type === 'assignment' && item.when && item.when < now.value
}
function itemUrgency(item) {
  return getTaskUrgency(item.type === 'activity' ? item.when : item.dueAt, {
    done: item.done,
    now: now.value,
    prefix: item.type === 'activity' ? 'Starts' : 'Due',
    end: item.type === 'activity' ? item.end : null,
  })
}
function itemType(item) {
  return item.source === 'group-meeting'
    ? 'Group meeting'
    : { assignment: 'Assignment', quiz: 'Quiz', activity: 'Activity' }[item.type]
}
function itemIcon(item) {
  return item.source === 'group-meeting'
    ? 'users'
    : { assignment: 'check', quiz: 'book', activity: 'pin' }[item.type]
}
function itemContext(item) {
  return item.type === 'activity' ? item.place || 'No location added' : item.courseName
}
function pageRange(page, length) {
  return length
    ? page * PAGE_SIZE + 1 + '–' + Math.min((page + 1) * PAGE_SIZE, length) + ' of ' + length
    : '0 items'
}

async function fetchUserData() {
  try {
    const { data } = await axios.get(API_URL + '/me', { withCredentials: true })
    userName.value = data.user.username
    personal.loadAccount(data.user.id)
  } catch {
    personal.loadAccount(null)
  }
}
async function fetchPlannerData() {
  plannerLoading.value = true
  plannerError.value = ''
  try {
    const { data } = await axios.get(API_URL + '/planner-data', { withCredentials: true })
    const toItem = (item, type) => ({
      id: item.Id,
      courseId: item.CourseId,
      key: [type, item.CourseId, item.Id].join(':'),
      title: item.Name,
      courseName: item.CourseName,
      dueAt: item.DueDate ? new Date(item.DueDate) : null,
      when:
        item.EventDate || item.DueDate || item.StartDate
          ? new Date(item.EventDate || item.DueDate || item.StartDate)
          : null,
      done: Boolean(item.Done),
      type,
    })
    assignments.value = (data.assignments || []).map((item) => toItem(item, 'assignment'))
    quizzes.value = (data.quizzes || []).map((item) => toItem(item, 'quiz'))
    announcements.value = data.announcements || []
    activities.value = (data.activities || []).map((item) => ({
      ...item,
      key: 'activity:' + item.id,
      when: new Date(item.when),
      end: new Date(item.end),
      done: Boolean(item.done),
      type: 'activity',
    }))
  } catch (error) {
    plannerError.value =
      error.response?.data?.message || 'We couldn’t load your planner. Please try again.'
  } finally {
    plannerLoading.value = false
  }
}
async function toggle(item, event) {
  if (savingItems.value.includes(item.key) || item.source === 'group-meeting') return
  actionError.value = ''
  savingItems.value.push(item.key)
  const done = !item.done
  try {
    if (item.type === 'activity') {
      await axios.post(
        API_URL + '/activities/' + encodeURIComponent(item.id),
        { done },
        { withCredentials: true },
      )
    } else {
      await axios.patch(
        API_URL +
          '/coursework/' +
          item.type +
          '/' +
          encodeURIComponent(item.courseId) +
          '/' +
          encodeURIComponent(item.id),
        { done },
        { withCredentials: true },
      )
    }
    item.done = done
    if (item.type !== 'activity') personal.recordCompletion(item, done)
  } catch (error) {
    actionError.value =
      error.response?.data?.message || 'Couldn’t save that change. Please try again.'
  } finally {
    savingItems.value = savingItems.value.filter((key) => key !== item.key)
    // Restore the native checkbox too when a failed save leaves the model unchanged.
    if (event?.target) event.target.checked = item.done
  }
}

const greeting = computed(() =>
  now.value.getHours() < 12
    ? 'Good morning'
    : now.value.getHours() < 18
      ? 'Good afternoon'
      : 'Good evening',
)
const todayText = computed(() =>
  dateText(now.value, { weekday: 'long', day: 'numeric', month: 'long' }),
)
const allItems = computed(() =>
  [...assignments.value, ...quizzes.value, ...activities.value].sort(
    (a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity),
  ),
)
const pending = computed(() => assignments.value.filter((item) => !item.done))
const doneCount = computed(() => assignments.value.filter((item) => item.done).length)
const progress = computed(() => Math.round((doneCount.value / assignments.value.length) * 100) || 0)
const overdueCount = computed(() => pending.value.filter(isOverdue).length)
function itemsOnDay(date) {
  const start = startOfDay(date)
  const end = addDays(start, 1)
  return allItems.value.filter(
    (item) =>
      item.when &&
      (item.type === 'activity'
        ? item.when < end && item.end > start
        : item.when >= start && item.when < end),
  )
}
const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart.value, index)
    return {
      date,
      key: dateKey(date),
      label: dateText(date, { weekday: 'short' }),
      count: itemsOnDay(date).filter((item) => !item.done).length,
      deadlines: itemsOnDay(date).filter((item) => !item.done && item.type !== 'activity').length,
      today: dateKey(date) === dateKey(now.value),
    }
  }),
)
const weekLabel = computed(
  () =>
    dateText(weekStart.value, { day: 'numeric', month: 'short' }) +
    ' – ' +
    dateText(addDays(weekStart.value, 6), { day: 'numeric', month: 'short', year: 'numeric' }),
)
function moveWeek(direction) {
  weekStart.value = addDays(weekStart.value, direction * 7)
  selectedDate.value = addDays(selectedDate.value, direction * 7)
}
function selectDay(date) {
  selectedDate.value = date
  agendaMode.value = 'day'
}
function goToToday() {
  weekStart.value = startOfWeek(now.value)
  selectedDate.value = startOfDay(now.value)
  agendaMode.value = 'day'
}
const agendaTitle = computed(() =>
  agendaMode.value === 'upcoming'
    ? 'Coming up next'
    : dateKey(selectedDate.value) === dateKey(now.value)
      ? 'Today’s plan'
      : dateText(selectedDate.value, { weekday: 'long' }) + '’s plan',
)
const timeline = computed(() =>
  (agendaMode.value === 'day'
    ? itemsOnDay(selectedDate.value)
    : allItems.value.filter((item) => item.when && (item.end || item.when) >= startOfDay(now.value))
  ).filter((item) => filter.value === 'all' || item.type === filter.value),
)
const pagedTimeline = computed(() =>
  timeline.value.slice(timelinePage.value * PAGE_SIZE, (timelinePage.value + 1) * PAGE_SIZE),
)
const timelinePageCount = computed(() => Math.ceil(timeline.value.length / PAGE_SIZE))
watch([filter, selectedDate, agendaMode], () => {
  timelinePage.value = 0
})
watch(timelinePageCount, (count) => {
  timelinePage.value = Math.min(timelinePage.value, Math.max(0, count - 1))
})

function activityAction(item) {
  return item.source === 'group-meeting'
    ? {
        label: 'View ' + item.title,
        to:
          '/groupwork?group=' +
          encodeURIComponent(item.groupId || '') +
          '&meeting=' +
          encodeURIComponent(item.meetingId || '') +
          '#gm-meetings-title',
      }
    : { label: 'Edit ' + item.title, to: '/activities?edit=' + encodeURIComponent(item.id) }
}
const conflicts = computed(() => {
  const found = []
  const active = activities.value.filter((item) => !item.done && item.end > now.value)
  active.forEach((activity, index) => {
    pending.value.forEach((item) => {
      if (item.when && item.when >= activity.when && item.when <= activity.end)
        found.push({
          id: 'deadline:' + activity.key + ':' + item.key,
          message:
            '“' +
            activity.title +
            '” overlaps the deadline for “' +
            item.title +
            '” (' +
            dayLabel(item.when) +
            ').',
          actions: [
            activityAction(activity),
            {
              label: 'View ' + item.title,
              to:
                '/assignments?course=' +
                encodeURIComponent(item.courseId) +
                '&search=' +
                encodeURIComponent(item.title),
            },
          ],
        })
    })
    active.slice(index + 1).forEach((other) => {
      if (activity.when < other.end && other.when < activity.end)
        found.push({
          id: activity.key + ':' + other.key,
          message: '“' + activity.title + '” clashes with “' + other.title + '”.',
          actions: [activityAction(activity), activityAction(other)],
        })
    })
  })
  return found
})

const forecast = ref([])
const weatherError = ref(false)
function weatherDescription(code) {
  if (code === 0) return { icon: '☀️', label: 'Clear skies' }
  if (code <= 3) return { icon: '⛅', label: 'Partly cloudy' }
  if (code <= 48) return { icon: '🌫️', label: 'Foggy' }
  if (code <= 67) return { icon: '🌧️', label: 'Rain expected' }
  if (code <= 77) return { icon: '🌨️', label: 'Snow expected' }
  if (code <= 82) return { icon: '🌦️', label: 'Showers expected' }
  return { icon: '⛈️', label: 'Thunderstorms' }
}
async function fetchWeather() {
  weatherError.value = false
  try {
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=1.2963&longitude=103.8502&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Asia%2FSingapore&forecast_days=7',
    )
    if (!response.ok) throw new Error('Forecast unavailable')
    const { daily } = await response.json()
    forecast.value = daily.time.map((date, index) => ({
      date,
      ...weatherDescription(daily.weather_code[index]),
      dow: dateText(new Date(date + 'T00:00:00'), { weekday: 'short' }),
      max: Math.round(daily.temperature_2m_max[index]),
      storm: daily.weather_code[index] >= 95,
      rain: daily.precipitation_probability_max[index] ?? 0,
    }))
  } catch {
    weatherError.value = true
  }
}
const selectedForecast = computed(() =>
  forecast.value.find((day) => day.date === dateKey(selectedDate.value)),
)
const outdoorChecks = computed(() =>
  activities.value
    .filter((item) => item.outdoor && !item.done && item.end > now.value)
    .sort((a, b) => a.when - b.when)
    .map((item) => {
      const day = forecast.value.find((day) => day.date === dateKey(item.when))
      return {
        ...item,
        verdict: !day
          ? 'No forecast yet'
          : day.rain >= 60 || day.storm
            ? 'Move indoors'
            : day.rain >= 40
              ? 'Bring backup'
              : 'Good to go',
        state: !day
          ? 'neutral'
          : day.rain >= 60 || day.storm
            ? 'warning'
            : day.rain >= 40
              ? 'caution'
              : 'good',
      }
    }),
)

const weatherAlerts = computed(() =>
  outdoorChecks.value.filter((item) => ['warning', 'caution'].includes(item.state)),
)
const weatherExpanded = computed(() => personal.state.preferences.weatherMode === 'expanded')
function toggleWeather() {
  personal.state.preferences.weatherMode = weatherExpanded.value ? 'compact' : 'expanded'
}
const briefing = computed(() => {
  const tomorrowEnd = addDays(startOfDay(now.value), 2)
  const due = [...pending.value, ...quizzes.value.filter((item) => !item.done)].filter(
    (item) => item.when && item.when >= now.value && item.when < tomorrowEnd,
  ).length
  const meetings = activities.value.filter(
    (item) =>
      item.source === 'group-meeting' &&
      !item.done &&
      item.end > now.value &&
      item.when < addDays(startOfDay(now.value), 1),
  ).length
  const parts = []
  if (overdueCount.value) parts.push(overdueCount.value + ' overdue')
  parts.push(
    due
      ? due + (due === 1 ? ' deadline' : ' deadlines') + ' by tomorrow'
      : 'No deadlines by tomorrow',
  )
  if (meetings) parts.push(meetings + (meetings === 1 ? ' meeting' : ' meetings') + ' today')
  return parts.join(' · ')
})
const weatherWarning = computed(() => {
  const activity = weatherAlerts.value[0]
  if (!activity) return ''
  return (
    (activity.state === 'warning' ? 'Plan an indoor backup for ' : 'Bring a backup for ') +
    activity.title +
    '.'
  )
})
const completionDays = computed(() =>
  weekDays.value.map((day) => {
    const complete = Object.values(personal.state.completions).filter(
      (entry) => dateKey(new Date(entry.at)) === day.key,
    ).length
    return {
      ...day,
      complete,
    }
  }),
)
const maximumCompletions = computed(() =>
  Math.max(1, ...completionDays.value.map((day) => day.complete)),
)
const weeklyCompleted = computed(() =>
  completionDays.value.reduce((sum, day) => sum + day.complete, 0),
)
watch([allItems, plannerLoading, () => personal.state.hydrated], () => {
  if (!plannerLoading.value && !plannerError.value && personal.state.hydrated)
    personal.reconcile(allItems.value)
})

onMounted(() => {
  fetchUserData()
  fetchPlannerData()
  fetchWeather()
  clockInterval = window.setInterval(() => {
    now.value = new Date()
  }, 60_000)
})
onUnmounted(() => {
  window.clearInterval(clockInterval)
  personal.dispose()
})
</script>
<template>
  <div class="app dashboard-app">
    <PlannerNavigation active="/dashboard" />
    <main class="dashboard-main flex-grow-1">
      <div class="container-xxl px-0">
        <PlannerNavigation active="/dashboard" mobile />
        <header class="row g-3 align-items-center mb-4 dashboard-heading">
          <div class="col-12 col-md">
            <p class="dashboard-greeting mb-2">{{ greeting }}, {{ userName }}</p>
            <h1>Your week, a little clearer.</h1>
            <p class="dashboard-subtitle mb-0" aria-label="Daily briefing">
              {{ todayText }}<span v-if="!plannerLoading && !plannerError"> · {{ briefing }}</span>
            </p>
          </div>
          <div class="col-12 col-md-auto d-flex flex-wrap gap-2 align-items-center">
            <RouterLink
              class="btn btn-primary d-inline-flex align-items-center gap-2"
              to="/assignments?new=1"
              ><PlannerIcon name="plus" />Assignment</RouterLink
            >
          </div>
        </header>
        <div
          v-if="plannerError"
          class="alert alert-danger d-flex flex-wrap gap-2 align-items-center justify-content-between"
          role="alert"
        >
          <span>{{ plannerError }}</span
          ><button class="btn btn-sm btn-outline-danger" type="button" @click="fetchPlannerData">
            Try again
          </button>
        </div>
        <div v-if="actionError" class="alert alert-danger" role="alert">{{ actionError }}</div>

        <section class="week-panel mb-4" aria-labelledby="week-heading">
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
            <h2 id="week-heading">{{ weekLabel }}</h2>
            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn btn-sm btn-light" @click="goToToday">Today</button>
              <div class="btn-group">
                <button
                  type="button"
                  class="btn btn-sm btn-light icon-button"
                  aria-label="Previous week"
                  @click="moveWeek(-1)"
                >
                  <PlannerIcon name="left" /></button
                ><button
                  type="button"
                  class="btn btn-sm btn-light icon-button"
                  aria-label="Next week"
                  @click="moveWeek(1)"
                >
                  <PlannerIcon name="right" />
                </button>
              </div>
            </div>
          </div>
          <div class="row g-1 g-sm-2 flex-nowrap" role="group" aria-label="Choose a day">
            <div v-for="day in weekDays" :key="day.key" class="col day-column">
              <button
                type="button"
                class="week-day btn w-100 d-flex flex-column align-items-center justify-content-center"
                :class="{ selected: day.key === dateKey(selectedDate), 'is-today': day.today }"
                :aria-pressed="day.key === dateKey(selectedDate)"
                :aria-label="
                  dateText(day.date, { weekday: 'long', day: 'numeric', month: 'long' }) +
                  (day.today ? ', today' : '') +
                  ', ' +
                  (plannerLoading || plannerError
                    ? 'loading'
                    : day.count + ' pending items, ' + day.deadlines + ' coursework deadlines')
                "
                :title="day.deadlines + ' pending coursework deadlines'"
                :data-date="day.key"
                @click="selectDay(day.date)"
              >
                <span class="day-label"
                  ><span class="day-name">{{ day.label }}</span
                  ><strong>{{ day.date.getDate() }}</strong></span
                >
                <span class="day-dots" aria-hidden="true"
                  ><span
                    v-for="dot in plannerLoading || plannerError ? 0 : Math.min(day.deadlines, 3)"
                    :key="dot"
                    class="day-dot"
                  ></span
                  ><small v-if="day.deadlines > 3 && !plannerLoading && !plannerError"
                    >+</small
                  ></span
                >
              </button>
            </div>
          </div>
        </section>

        <div
          v-if="conflicts.length && !plannerLoading && !plannerError"
          class="conflict-nudge d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"
          role="status"
        >
          <span class="d-flex align-items-center gap-2"
            ><PlannerIcon name="alert" />{{ conflicts.length }} schedule
            {{ conflicts.length === 1 ? 'overlap needs' : 'overlaps need' }} attention.</span
          ><button type="button" class="btn btn-sm btn-light" @click="reviewConflicts">
            Review overlaps
          </button>
        </div>

        <div class="row g-4 dashboard-primary mb-4">
          <div class="col-12 col-xl-8 dashboard-agenda-column">
            <section
              class="dashboard-panel agenda-panel"
              aria-labelledby="agenda-heading"
              :aria-busy="plannerLoading"
            >
              <div
                class="panel-heading d-flex flex-wrap align-items-center justify-content-between gap-3"
              >
                <div>
                  <h2 id="agenda-heading">{{ agendaTitle }}</h2>
                </div>
                <div class="view-switch d-flex" role="group" aria-label="Agenda view">
                  <button
                    class="btn btn-sm"
                    :class="{ 'is-active': agendaMode === 'day' }"
                    type="button"
                    :aria-pressed="agendaMode === 'day'"
                    @click="agendaMode = 'day'"
                  >
                    Day</button
                  ><button
                    class="btn btn-sm"
                    :class="{ 'is-active': agendaMode === 'upcoming' }"
                    type="button"
                    :aria-pressed="agendaMode === 'upcoming'"
                    @click="agendaMode = 'upcoming'"
                  >
                    Upcoming
                  </button>
                </div>
              </div>
              <div
                class="agenda-filters d-flex flex-wrap gap-2 px-3 px-sm-4 pb-3"
                role="group"
                aria-label="Filter timeline"
              >
                <button
                  v-for="option in filters"
                  :key="option.value"
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'is-active': filter === option.value }"
                  :aria-pressed="filter === option.value"
                  @click="filter = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
              <div v-if="plannerLoading" class="dashboard-empty" role="status">
                <span class="spinner-border spinner-border-sm mb-3" aria-hidden="true"></span>
                <p>Getting your week together…</p>
              </div>
              <div v-else-if="plannerError" class="dashboard-empty">
                <p>Your schedule will appear here when your planner loads.</p>
              </div>
              <template v-else>
                <div v-if="!timeline.length" class="dashboard-empty">
                  <span class="empty-icon"
                    ><PlannerIcon :name="filter === 'all' ? 'calendar' : 'check'"
                  /></span>
                  <h3>
                    {{
                      filter === 'all' ? 'A little breathing room.' : 'Nothing in this category.'
                    }}
                  </h3>
                  <p>
                    {{
                      filter === 'all'
                        ? 'No plans here yet. Add an activity or get a head start on your coursework.'
                        : 'Try another filter to see the rest of your plans.'
                    }}
                  </p>
                  <RouterLink v-if="filter === 'all'" to="/activities?new=1" class="text-link"
                    >Plan an activity <PlannerIcon name="arrow"
                  /></RouterLink>
                </div>
                <ul v-else class="list-unstyled mb-0">
                  <li
                    v-for="item in pagedTimeline"
                    :key="item.key"
                    class="agenda-row d-flex gap-2 gap-sm-3"
                    :class="[
                      { 'is-complete': item.done },
                      'agenda-urgency-' + (itemUrgency(item)?.level || 'none'),
                    ]"
                  >
                    <div class="agenda-time">
                      <strong>{{ time(item.when) }}</strong
                      ><span>{{
                        agendaMode === 'upcoming'
                          ? dayLabel(item.when)
                          : item.type === 'activity'
                            ? 'to ' + time(item.end)
                            : item.type === 'assignment'
                              ? 'Due'
                              : 'Starts'
                      }}</span>
                    </div>
                    <div class="agenda-body flex-grow-1">
                      <span class="agenda-type-icon"><PlannerIcon :name="itemIcon(item)" /></span>
                      <div class="agenda-copy min-width-0">
                        <span class="visually-hidden">{{ itemType(item) }}</span>
                        <h3>{{ item.title }}</h3>
                        <p>{{ itemContext(item) }}</p>
                        <TaskUrgencyBadge :urgency="itemUrgency(item)" />
                        <RouterLink
                          v-if="item.source === 'group-meeting'"
                          class="text-link small mt-2"
                          :to="activityAction(item).to"
                          >View meeting <PlannerIcon name="arrow"
                        /></RouterLink>
                      </div>
                    </div>
                    <input
                      v-if="item.source !== 'group-meeting'"
                      type="checkbox"
                      class="form-check-input mt-2"
                      :aria-label="
                        'Mark ' + item.title + ' as ' + (item.done ? 'incomplete' : 'complete')
                      "
                      :checked="item.done"
                      :disabled="savingItems.includes(item.key)"
                      @change="toggle(item, $event)"
                    />
                  </li>
                </ul>
                <div
                  v-if="timelinePageCount > 1"
                  class="pagination-footer d-flex align-items-center justify-content-between gap-2"
                >
                  <small aria-live="polite">{{ pageRange(timelinePage, timeline.length) }}</small>
                  <div class="btn-group">
                    <button
                      class="btn btn-sm btn-light icon-button"
                      type="button"
                      aria-label="Previous six timeline items"
                      :disabled="timelinePage === 0"
                      @click="timelinePage--"
                    >
                      <PlannerIcon name="left" /></button
                    ><button
                      class="btn btn-sm btn-light icon-button"
                      type="button"
                      aria-label="Next six timeline items"
                      :disabled="timelinePage >= timelinePageCount - 1"
                      @click="timelinePage++"
                    >
                      <PlannerIcon name="right" />
                    </button>
                  </div>
                </div>
              </template>
              <div
                class="agenda-footer px-3 px-sm-4 py-3 d-flex flex-wrap justify-content-between align-items-center gap-2"
              >
                <RouterLink class="text-link" to="/assignments"
                  >All coursework <PlannerIcon name="arrow" /></RouterLink
                ><RouterLink class="text-link small" to="/activities?new=1"
                  >Plan an activity</RouterLink
                >
              </div>
            </section>
          </div>
          <aside class="col-12 col-xl-4 dashboard-side" aria-label="Priorities and weather">
            <DashboardTools
              v-if="!plannerLoading && !plannerError && personal.state.hydrated"
              :items="allItems"
              :personal="personal"
              :saving-items="savingItems"
              @complete="toggle($event.item, $event.event)"
            />
            <section v-else class="dashboard-panel p-3 p-sm-4" aria-labelledby="priorities-heading">
              <h2 id="priorities-heading">Your top three</h2>
              <p class="small dashboard-muted mb-0 mt-2">
                {{
                  plannerLoading
                    ? 'Getting your priorities ready…'
                    : 'Your priorities will appear when the planner loads.'
                }}
              </p>
            </section>

            <section
              id="dashboard-weather"
              class="dashboard-panel weather-panel p-3 p-sm-4"
              aria-labelledby="weather-heading"
            >
              <div class="d-flex gap-3 align-items-start">
                <PlannerIcon name="cloud" class="weather-heading-icon" />
                <div class="min-width-0 flex-grow-1">
                  <h2 id="weather-heading">Weather & your plans</h2>
                  <p class="weather-inline mb-0 mt-1">
                    {{
                      selectedForecast
                        ? selectedForecast.max + '°C · ' + selectedForecast.label
                        : weatherError
                          ? 'Forecast unavailable'
                          : forecast.length
                            ? 'No forecast for this date'
                            : 'Checking the skies…'
                    }}
                  </p>
                  <span class="weather-location">Singapore · {{ dayLabel(selectedDate) }}</span>
                </div>
              </div>
              <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
                <span
                  v-if="weatherWarning && !plannerLoading && !plannerError"
                  class="weather-warning"
                  >{{ weatherWarning }}</span
                >
                <span v-else class="small dashboard-muted">{{
                  plannerLoading || plannerError
                    ? 'Your outdoor plans are not available yet.'
                    : outdoorChecks.length
                      ? weatherError || outdoorChecks.some((item) => item.state === 'neutral')
                        ? 'Forecast pending for outdoor plans.'
                        : 'No weather warnings for outdoor plans.'
                      : 'No upcoming outdoor plans.'
                }}</span>
                <button
                  type="button"
                  class="weather-details-toggle"
                  :aria-expanded="weatherExpanded"
                  aria-controls="dashboard-weather-details"
                  @click="toggleWeather"
                >
                  {{ weatherExpanded ? 'Less' : 'Details' }}
                </button>
              </div>
              <div
                id="dashboard-weather-details"
                v-show="weatherExpanded"
                class="weather-extra mt-3 pt-3"
              >
                <template v-if="forecast.length && !weatherError">
                  <p class="small dashboard-muted">
                    {{
                      selectedForecast
                        ? selectedForecast.rain + '% chance of rain for the selected day.'
                        : 'The forecast covers the next seven days. Check back closer to this date.'
                    }}
                  </p>
                  <div
                    v-for="activity in outdoorChecks.slice(0, 3)"
                    :key="activity.key"
                    class="weather-activity"
                  >
                    <strong>{{ activity.title }}</strong>
                    <div
                      class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-2"
                    >
                      <small>{{ dayLabel(activity.when) }}</small
                      ><span class="weather-verdict" :class="activity.state">{{
                        activity.verdict
                      }}</span>
                    </div>
                  </div>
                  <RouterLink
                    v-if="outdoorChecks.length > 3"
                    class="text-link small mt-2"
                    to="/activities"
                    >All outdoor plans <PlannerIcon name="arrow"
                  /></RouterLink>
                </template>
              </div>
              <section
                class="forecast-details weather-extra mt-3 pt-3"
                aria-labelledby="forecast-heading"
              >
                <h3 id="forecast-heading" class="small mb-2">7-day outlook</h3>
                <div v-if="weatherError">
                  <p class="small dashboard-muted">The forecast is taking a rain check.</p>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    @click="fetchWeather"
                  >
                    Try again
                  </button>
                </div>
                <p v-else-if="!forecast.length" class="small dashboard-muted" role="status">
                  Checking the skies…
                </p>
                <div v-else class="row g-1 mt-2 flex-nowrap">
                  <div v-for="day in forecast" :key="day.date" class="col text-center forecast-day">
                    <small>{{ day.dow }}</small
                    ><span role="img" :aria-label="day.label">{{ day.icon }}</span
                    ><strong>{{ day.max }}°</strong>
                  </div>
                </div>
              </section>
            </section>
          </aside>
        </div>

        <section class="dashboard-panel dashboard-extras" aria-label="More dashboard details">
          <div class="row g-0 extras-toggles">
            <div class="col-12 col-md-4">
              <button
                id="progress-toggle"
                type="button"
                class="extras-toggle"
                :aria-expanded="progressOpen"
                aria-controls="dashboard-progress-details"
                @click="progressOpen = !progressOpen"
              >
                <span id="progress-heading">Weekly progress</span
                ><span class="extras-meta">{{
                  plannerLoading || plannerError ? '—' : weeklyCompleted + ' done'
                }}</span
                ><PlannerIcon :name="progressOpen ? 'left' : 'right'" />
              </button>
            </div>
            <div class="col-12 col-md-4">
              <button
                id="conflict-toggle"
                type="button"
                class="extras-toggle"
                :aria-expanded="conflictsOpen"
                aria-controls="dashboard-conflict-details"
                @click="conflictsOpen = !conflictsOpen"
              >
                <span id="conflict-heading">Schedule check</span
                ><span
                  class="extras-meta"
                  :class="{
                    'status-clear': !plannerLoading && !plannerError && !conflicts.length,
                    'status-warning': !plannerLoading && !plannerError && conflicts.length,
                  }"
                  >{{
                    plannerLoading
                      ? 'Checking'
                      : plannerError
                        ? 'Unavailable'
                        : conflicts.length
                          ? conflicts.length + ' overlaps'
                          : 'All clear'
                  }}</span
                ><PlannerIcon :name="conflictsOpen ? 'left' : 'right'" />
              </button>
            </div>
            <div class="col-12 col-md-4">
              <button
                type="button"
                class="extras-toggle"
                :aria-expanded="announcementsOpen"
                aria-controls="dashboard-course-announcements"
                @click="announcementsOpen = !announcementsOpen"
              >
                <span id="announcements-heading">Course notices</span
                ><span class="notice-count">{{
                  plannerLoading || plannerError ? '—' : announcements.length
                }}</span
                ><PlannerIcon :name="announcementsOpen ? 'left' : 'right'" />
              </button>
            </div>
          </div>
          <section
            id="dashboard-progress-details"
            v-show="progressOpen"
            class="extras-content p-3 p-sm-4"
            aria-labelledby="progress-heading"
          >
            <div class="weekly-wins mb-3">
              <p class="small dashboard-muted mb-2">{{ weekLabel }}</p>
              <div class="d-flex flex-wrap gap-4 mb-3">
                <div>
                  <strong>{{ plannerLoading || plannerError ? '—' : weeklyCompleted }}</strong
                  ><span>coursework completed</span>
                </div>
              </div>
              <div
                class="row g-1 flex-nowrap completion-history"
                aria-label="Coursework completions by day"
              >
                <div
                  v-for="day in completionDays"
                  :key="day.key"
                  class="col text-center"
                  :aria-label="day.label + ': ' + day.complete + ' completions'"
                  :title="day.complete + ' completions'"
                >
                  <span class="win-count">{{ day.complete }}</span>
                  <div class="win-track">
                    <span
                      :style="{ height: (day.complete / maximumCompletions) * 100 + '%' }"
                    ></span>
                  </div>
                  <small>{{ day.label }}</small>
                </div>
              </div>
              <p class="small dashboard-muted mt-2 mb-3">
                History starts when you complete coursework on this browser.
              </p>
              <p class="small dashboard-muted mb-2">All assignments</p>
            </div>
            <div
              class="progress dashboard-progress"
              role="progressbar"
              aria-label="Assignments completed"
              :aria-valuenow="progress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div class="progress-bar" :style="{ width: progress + '%' }"></div>
            </div>
            <p class="small dashboard-muted mt-2 mb-0">
              {{
                plannerLoading
                  ? 'Loading your progress…'
                  : plannerError
                    ? 'Progress is currently unavailable.'
                    : doneCount + ' of ' + assignments.length + ' assignments complete'
              }}
            </p>

            <p class="small dashboard-muted mb-0 mt-3">{{ personal.storageMessage.value }}</p>
          </section>
          <section
            id="dashboard-conflict-details"
            v-show="conflictsOpen"
            class="extras-content p-3 p-sm-4"
            aria-labelledby="conflict-heading"
          >
            <p v-if="plannerLoading || plannerError" class="small dashboard-muted mb-0">
              {{
                plannerLoading ? 'Checking your schedule…' : 'Your schedule couldn’t be checked.'
              }}
            </p>
            <p v-else-if="!conflicts.length" class="small dashboard-muted mb-0">
              No clashes ahead. Looking good.
            </p>
            <template v-else
              ><article
                v-for="conflict in conflicts"
                :key="conflict.id"
                class="conflict-message small"
              >
                <p class="mb-2">{{ conflict.message }}</p>
                <div class="d-flex flex-wrap gap-2">
                  <RouterLink
                    v-for="action in conflict.actions"
                    :key="action.to"
                    :to="action.to"
                    class="btn btn-sm btn-light conflict-action"
                    >{{ action.label }}</RouterLink
                  >
                </div>
              </article></template
            >
          </section>
          <section
            v-if="announcementsOpen"
            class="extras-content p-3 p-sm-4"
            aria-labelledby="announcements-heading"
          >
            <div id="dashboard-course-announcements">
              <p v-if="plannerLoading || plannerError" class="small dashboard-muted mb-0">
                {{
                  plannerLoading
                    ? 'Loading course notices…'
                    : 'Course notices are currently unavailable.'
                }}
              </p>
              <p v-else-if="!announcements.length" class="small dashboard-muted mb-0">
                You’re all caught up. No course notices yet.
              </p>
              <article
                v-for="announcement in announcements.slice(0, 5)"
                :key="announcement.Id"
                class="announcement"
              >
                <h3>{{ announcement.Title }}</h3>
                <small
                  >{{ announcement.CourseName }} ·
                  {{
                    dateText(new Date(announcement.PostedAt), {
                      day: 'numeric',
                      month: 'short',
                    })
                  }}</small
                >
                <p class="small mb-0 mt-2">{{ announcement.Body }}</p>
              </article>
            </div>
          </section>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped src="../assets/dashboard.css"></style>
