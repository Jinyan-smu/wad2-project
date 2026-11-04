<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import axios from 'axios'
import PlannerNavigation from './PlannerNavigation.vue'
import PlannerIcon from './PlannerIcon.vue'

const API_URL = 'http://localhost:8000/api'
const userName = ref('there')
const plannerLoading = ref(true)
const plannerError = ref('')
const actionError = ref('')
const savingItems = ref([])
const assignments = ref([])
const quizzes = ref([])
const activities = ref([])
const announcements = ref([])
const announcementsOpen = ref(false)
const now = ref(new Date())
const selectedDate = ref(startOfDay(now.value))
const weekStart = ref(startOfWeek(now.value))
const filter = ref('all')
const agendaMode = ref('day')
const timelinePage = ref(0)
const assignmentPage = ref(0)
const sortBy = ref('deadline')
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
  } catch {
    /* Keep the neutral greeting when the session request fails. */
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
const nextAssignment = computed(
  () => pending.value.filter((item) => item.when).sort((a, b) => a.when - b.when)[0],
)
const stats = computed(() => [
  { label: 'Pending assignments', value: pending.value.length, icon: 'check' },
  {
    label: 'Due within 3 days',
    value: pending.value.filter(
      (item) => item.when && item.when >= now.value && item.when < addDays(now.value, 3),
    ).length,
    icon: 'clock',
  },
  {
    label: 'Upcoming quizzes',
    value: quizzes.value.filter((item) => !item.done && item.when && item.when >= now.value).length,
    icon: 'book',
  },
  { label: 'Assignments done', value: doneCount.value, icon: 'sparkles' },
])
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
const isCurrentWeek = computed(() => dateKey(weekStart.value) === dateKey(startOfWeek(now.value)))
const weekCount = computed(
  () =>
    allItems.value.filter(
      (item) =>
        !item.done &&
        item.when &&
        item.when >= weekStart.value &&
        item.when < addDays(weekStart.value, 7),
    ).length,
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
const sortedAssignments = computed(() =>
  [...assignments.value].sort((a, b) =>
    sortBy.value === 'course'
      ? (a.courseName || '').localeCompare(b.courseName || '')
      : (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity),
  ),
)
const pagedAssignments = computed(() =>
  sortedAssignments.value.slice(
    assignmentPage.value * PAGE_SIZE,
    (assignmentPage.value + 1) * PAGE_SIZE,
  ),
)
const assignmentPageCount = computed(() => Math.ceil(sortedAssignments.value.length / PAGE_SIZE))
watch([filter, selectedDate, agendaMode], () => {
  timelinePage.value = 0
})
watch(sortBy, () => {
  assignmentPage.value = 0
})
watch(timelinePageCount, (count) => {
  timelinePage.value = Math.min(timelinePage.value, Math.max(0, count - 1))
})
watch(assignmentPageCount, (count) => {
  assignmentPage.value = Math.min(assignmentPage.value, Math.max(0, count - 1))
})

const conflicts = computed(() => {
  const found = []
  const active = activities.value.filter((item) => !item.done && item.end > now.value)
  active.forEach((activity, index) => {
    pending.value.forEach((item) => {
      if (item.when && item.when >= activity.when && item.when <= activity.end)
        found.push(
          '“' +
            activity.title +
            '” overlaps the deadline for “' +
            item.title +
            '” (' +
            dayLabel(item.when) +
            ').',
        )
    })
    active.slice(index + 1).forEach((other) => {
      if (activity.when < other.end && other.when < activity.end)
        found.push('“' + activity.title + '” clashes with “' + other.title + '”.')
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
          : day.rain >= 60
            ? 'Move indoors'
            : day.rain >= 40
              ? 'Bring backup'
              : 'Good to go',
        state: !day ? 'neutral' : day.rain >= 60 ? 'warning' : day.rain >= 40 ? 'caution' : 'good',
      }
    }),
)
onMounted(() => {
  fetchUserData()
  fetchPlannerData()
  fetchWeather()
  clockInterval = window.setInterval(() => {
    now.value = new Date()
  }, 60000)
})
onUnmounted(() => window.clearInterval(clockInterval))
</script>

<template>
  <div class="app dashboard-app">
    <PlannerNavigation active="/dashboard" />

    <main class="dashboard-main flex-grow-1">
      <div class="container-xxl px-0">
        <PlannerNavigation active="/dashboard" mobile />
        <header class="row g-3 align-items-center mb-4 mb-lg-5">
          <div class="col-12 col-md">
            <p class="eyebrow mb-2">{{ greeting }}, {{ userName }}</p>
            <h1>Your week, a little clearer.</h1>
            <p class="dashboard-subtitle mb-0">
              {{ todayText }} <span class="mx-1" aria-hidden="true">·</span> Make space for what
              matters.
            </p>
          </div>
          <div class="col-12 col-md-auto d-flex flex-wrap gap-2">
            <RouterLink
              class="btn btn-outline-secondary d-inline-flex align-items-center gap-2"
              to="/activities?new=1"
              ><PlannerIcon name="plus" />Activity</RouterLink
            >
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
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
            <div>
              <p class="eyebrow mb-1">{{ isCurrentWeek ? 'THIS WEEK' : 'YOUR WEEK' }}</p>
              <h2 id="week-heading">{{ weekLabel }}</h2>
            </div>
            <div class="d-flex align-items-center gap-2">
              <span
                v-if="!plannerLoading && !plannerError"
                class="small dashboard-muted d-none d-sm-inline me-2"
                >{{ weekCount }} scheduled {{ weekCount === 1 ? 'item' : 'items' }}</span
              >
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
                class="week-day btn w-100 d-flex flex-column align-items-center"
                :class="{ selected: day.key === dateKey(selectedDate), 'is-today': day.today }"
                :aria-pressed="day.key === dateKey(selectedDate)"
                :aria-label="
                  dateText(day.date, { weekday: 'long', day: 'numeric', month: 'long' }) +
                  (day.today ? ', today' : '') +
                  ', ' +
                  day.count +
                  ' pending items'
                "
                :data-date="day.key"
                @click="selectDay(day.date)"
              >
                <span class="day-name">{{ day.label }}</span
                ><strong>{{ day.date.getDate() }}</strong
                ><span class="day-detail"
                  ><span
                    v-if="day.count && !plannerLoading"
                    class="day-dot"
                    aria-hidden="true"
                  ></span
                  >{{
                    plannerLoading || plannerError
                      ? '–'
                      : day.count
                        ? day.count
                        : day.today
                          ? 'Today'
                          : '—'
                  }}</span
                >
              </button>
            </div>
          </div>
        </section>

        <section class="row g-3 mb-4" aria-label="Planner summary">
          <div v-for="stat in stats" :key="stat.label" class="col-6 col-xl-3">
            <div class="summary-stat d-flex gap-3 align-items-center h-100">
              <span class="stat-icon d-none d-sm-grid"><PlannerIcon :name="stat.icon" /></span>
              <div>
                <strong>{{ plannerLoading || plannerError ? '—' : stat.value }}</strong
                ><span>{{ stat.label }}</span>
              </div>
            </div>
          </div>
        </section>

        <div class="row g-4">
          <div class="col-12 col-xl-8">
            <section
              class="dashboard-panel agenda-panel mb-4"
              aria-labelledby="agenda-heading"
              :aria-busy="plannerLoading"
            >
              <div
                class="panel-heading d-flex flex-wrap align-items-center justify-content-between gap-3"
              >
                <div>
                  <p class="eyebrow mb-1">
                    {{
                      agendaMode === 'day'
                        ? dateText(selectedDate, { day: 'numeric', month: 'long' })
                        : 'LOOKING AHEAD'
                    }}
                  </p>
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
                    class="agenda-row d-flex gap-3"
                    :class="{ 'is-complete': item.done }"
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
                      <span class="event-type" :class="item.type"
                        ><PlannerIcon :name="itemIcon(item)" />{{ itemType(item) }}</span
                      >
                      <h3>{{ item.title }}</h3>
                      <p>{{ itemContext(item) }}</p>
                      <span v-if="isOverdue(item)" class="overdue-label">Overdue</span
                      ><RouterLink
                        v-if="item.source === 'group-meeting'"
                        class="text-link small mt-2"
                        to="/groupwork"
                        >View meeting <PlannerIcon name="arrow"
                      /></RouterLink>
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
            </section>

            <section class="dashboard-panel mb-4" aria-labelledby="assignments-heading">
              <div
                class="panel-heading d-flex flex-wrap align-items-center justify-content-between gap-3"
              >
                <div>
                  <p class="eyebrow mb-1">ONE STEP AT A TIME</p>
                  <h2 id="assignments-heading">Your assignments</h2>
                </div>
                <label class="visually-hidden" for="dashboard-assignment-sort"
                  >Sort assignments</label
                ><select
                  id="dashboard-assignment-sort"
                  v-model="sortBy"
                  class="form-select form-select-sm assignment-sort"
                >
                  <option value="deadline">By deadline</option>
                  <option value="course">By course</option>
                </select>
              </div>
              <p v-if="plannerLoading" class="px-4 pb-3 dashboard-muted" role="status">
                Loading assignments…
              </p>
              <p v-else-if="plannerError" class="px-4 pb-3 dashboard-muted">
                Your assignments are currently unavailable.
              </p>
              <div v-else-if="!assignments.length" class="dashboard-empty pt-2">
                <h3>A fresh start.</h3>
                <p>Add your first assignment and keep your deadlines in one place.</p>
                <RouterLink class="text-link" to="/assignments?new=1"
                  >Add an assignment <PlannerIcon name="arrow"
                /></RouterLink>
              </div>
              <ul v-else class="list-unstyled mb-0">
                <li
                  v-for="item in pagedAssignments"
                  :key="item.key"
                  class="assignment-row d-flex gap-3 align-items-start"
                  :class="{ 'is-complete': item.done }"
                >
                  <input
                    type="checkbox"
                    class="form-check-input mt-1"
                    :aria-label="
                      'Mark ' + item.title + ' as ' + (item.done ? 'incomplete' : 'complete')
                    "
                    :checked="item.done"
                    :disabled="savingItems.includes(item.key)"
                    @change="toggle(item, $event)"
                  />
                  <div class="flex-grow-1 min-width-0">
                    <h3>{{ item.title }}</h3>
                    <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
                      <span class="course-label">{{ item.courseName }}</span
                      ><span class="assignment-due" :class="{ 'overdue-label': isOverdue(item) }">{{
                        item.done
                          ? 'Completed'
                          : item.when
                            ? (isOverdue(item) ? 'Overdue · ' : '') +
                              dayLabel(item.when) +
                              ' · ' +
                              time(item.when)
                            : 'No due date'
                      }}</span>
                    </div>
                  </div>
                </li>
              </ul>
              <div
                v-if="!plannerLoading && !plannerError"
                class="pagination-footer d-flex flex-wrap align-items-center justify-content-between gap-2"
              >
                <RouterLink class="text-link small" to="/assignments"
                  >All coursework <PlannerIcon name="arrow"
                /></RouterLink>
                <div v-if="assignmentPageCount > 1" class="d-flex align-items-center gap-2">
                  <small aria-live="polite">{{
                    pageRange(assignmentPage, assignments.length)
                  }}</small>
                  <div class="btn-group">
                    <button
                      class="btn btn-sm btn-light icon-button"
                      type="button"
                      aria-label="Previous six assignments"
                      :disabled="assignmentPage === 0"
                      @click="assignmentPage--"
                    >
                      <PlannerIcon name="left" /></button
                    ><button
                      class="btn btn-sm btn-light icon-button"
                      type="button"
                      aria-label="Next six assignments"
                      :disabled="assignmentPage >= assignmentPageCount - 1"
                      @click="assignmentPage++"
                    >
                      <PlannerIcon name="right" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div class="col-12 col-xl-4">
            <div class="row g-4">
              <div class="col-12 col-md-6 col-xl-12">
                <section class="radar-panel h-100" aria-labelledby="radar-heading">
                  <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
                    <span class="eyebrow">ON YOUR RADAR</span><PlannerIcon name="sparkles" />
                  </div>
                  <template v-if="plannerLoading"
                    ><h2 id="radar-heading">Finding your next deadline…</h2></template
                  >
                  <template v-else-if="plannerError"
                    ><h2 id="radar-heading">Your next step, right here.</h2>
                    <p>Reload your planner to see upcoming deadlines.</p></template
                  >
                  <template v-else-if="nextAssignment"
                    ><span
                      class="radar-status"
                      :class="{ 'overdue-label': isOverdue(nextAssignment) }"
                      >{{
                        isOverdue(nextAssignment)
                          ? 'Needs your attention'
                          : 'Due ' + dayLabel(nextAssignment.when).toLowerCase()
                      }}</span
                    >
                    <h2 id="radar-heading" class="mt-2">{{ nextAssignment.title }}</h2>
                    <p>
                      {{ nextAssignment.courseName }}<br />{{
                        dateText(nextAssignment.when, { day: 'numeric', month: 'short' })
                      }}
                      at {{ time(nextAssignment.when) }}
                    </p>
                    <RouterLink
                      class="btn btn-primary d-inline-flex align-items-center gap-2"
                      to="/assignments"
                      >Open coursework <PlannerIcon name="arrow" /></RouterLink
                  ></template>
                  <template v-else
                    ><h2 id="radar-heading">A little room to breathe.</h2>
                    <p>No pending dated assignments. Make time for something you enjoy.</p>
                    <RouterLink class="text-link" to="/activities"
                      >Explore your plans <PlannerIcon name="arrow" /></RouterLink
                  ></template>
                  <p
                    v-if="overdueCount > 1 && !plannerLoading && !plannerError"
                    class="radar-footnote mb-0 mt-3"
                  >
                    {{ overdueCount }} assignments are overdue.
                  </p>
                </section>
              </div>

              <div class="col-12 col-md-6 col-xl-12">
                <section
                  id="dashboard-weather"
                  class="dashboard-panel weather-panel h-100"
                  aria-labelledby="weather-heading"
                >
                  <div class="panel-heading pb-2">
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <PlannerIcon name="cloud" /><span class="eyebrow">A LITTLE HEADS-UP</span>
                    </div>
                    <h2 id="weather-heading">Weather & your plans</h2>
                    <p class="small dashboard-muted mt-1 mb-0">
                      Singapore · {{ dayLabel(selectedDate) }}
                    </p>
                  </div>
                  <div class="px-3 px-sm-4 pb-4">
                    <div v-if="weatherError" class="small">
                      <p class="dashboard-muted">The forecast is taking a rain check.</p>
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-secondary"
                        @click="fetchWeather"
                      >
                        Try again
                      </button>
                    </div>
                    <p v-else-if="!forecast.length" class="dashboard-muted small" role="status">
                      Checking the skies…
                    </p>
                    <template v-else>
                      <div
                        v-if="selectedForecast"
                        class="weather-summary d-flex align-items-center gap-3 py-3"
                      >
                        <span class="weather-symbol" aria-hidden="true">{{
                          selectedForecast.icon
                        }}</span>
                        <div>
                          <strong>{{ selectedForecast.max }}°<span>C</span></strong>
                          <p>{{ selectedForecast.label }} · {{ selectedForecast.rain }}% rain</p>
                        </div>
                      </div>
                      <p v-else class="small dashboard-muted">
                        The forecast covers the next seven days. Check back closer to this date.
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
                      <p
                        v-if="!outdoorChecks.length && !plannerLoading && !plannerError"
                        class="small dashboard-muted mb-0"
                      >
                        No upcoming outdoor plans. You’re covered either way.
                      </p>
                      <RouterLink
                        v-if="outdoorChecks.length > 3"
                        class="text-link small mt-3"
                        to="/activities"
                        >All outdoor plans <PlannerIcon name="arrow"
                      /></RouterLink>
                      <details class="forecast-details mt-3">
                        <summary class="small">7-day outlook</summary>
                        <div class="row g-1 mt-2 flex-nowrap">
                          <div
                            v-for="day in forecast"
                            :key="day.date"
                            class="col text-center forecast-day"
                          >
                            <small>{{ day.dow }}</small
                            ><span role="img" :aria-label="day.label">{{ day.icon }}</span
                            ><strong>{{ day.max }}°</strong>
                          </div>
                        </div>
                      </details>
                    </template>
                  </div>
                </section>
              </div>

              <div class="col-12 col-md-6 col-xl-12">
                <section
                  class="dashboard-panel p-3 p-sm-4 h-100"
                  aria-labelledby="progress-heading"
                >
                  <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
                    <h2 id="progress-heading">Little wins add up.</h2>
                    <span class="progress-number">{{
                      plannerLoading || plannerError ? '—' : progress + '%'
                    }}</span>
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
                </section>
              </div>
              <div class="col-12 col-md-6 col-xl-12">
                <section
                  class="dashboard-panel p-3 p-sm-4 h-100"
                  aria-labelledby="conflict-heading"
                >
                  <div class="d-flex align-items-center gap-2 mb-2">
                    <PlannerIcon :name="conflicts.length ? 'alert' : 'check'" />
                    <h2 id="conflict-heading">Schedule check</h2>
                  </div>
                  <p v-if="plannerLoading || plannerError" class="small dashboard-muted mb-0">
                    {{
                      plannerLoading
                        ? 'Checking your schedule…'
                        : 'Your schedule couldn’t be checked.'
                    }}
                  </p>
                  <template v-else
                    ><p v-if="!conflicts.length" class="small dashboard-muted mb-0">
                      No clashes ahead. Looking good.
                    </p>
                    <template v-else
                      ><p class="small mb-2">
                        {{ conflicts.length }}
                        {{ conflicts.length === 1 ? 'overlap needs' : 'overlaps need' }} a second
                        look.
                      </p>
                      <details class="conflict-details">
                        <summary class="small">Review overlaps</summary>
                        <p
                          v-for="conflict in conflicts"
                          :key="conflict"
                          class="conflict-message small mt-2 mb-0"
                        >
                          {{ conflict }}
                        </p>
                      </details></template
                    ></template
                  >
                </section>
              </div>
              <div class="col-12">
                <section class="dashboard-panel p-3 p-sm-4" aria-labelledby="announcements-heading">
                  <div class="d-flex align-items-center justify-content-between gap-2">
                    <div class="d-flex align-items-center gap-2">
                      <PlannerIcon name="bell" />
                      <h2 id="announcements-heading">Course notices</h2>
                      <span v-if="!plannerLoading && !plannerError" class="notice-count">{{
                        announcements.length
                      }}</span>
                    </div>
                    <button
                      class="btn btn-sm btn-light"
                      type="button"
                      :aria-expanded="announcementsOpen"
                      aria-controls="dashboard-course-announcements"
                      @click="announcementsOpen = !announcementsOpen"
                    >
                      {{ announcementsOpen ? 'Hide' : 'Show' }}
                    </button>
                  </div>
                  <div v-if="announcementsOpen" id="dashboard-course-announcements" class="mt-3">
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
              </div>
            </div>
          </div>
        </div>
        <footer class="dashboard-footer mt-4 pt-2">A little structure. More room for life.</footer>
      </div>
    </main>
  </div>
</template>

<style scoped src="../assets/dashboard.css"></style>
