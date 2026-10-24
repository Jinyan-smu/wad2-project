<!-- Dashboard.vue – Student Life Planner home page (Vue 3 with Bootstrap) -->
<template>
  <div class="app">
    <!-- Sidebar -->
    <aside class="sidebar">
      <h2>🎓 Student Planner</h2>
      <RouterLink class="active" to="/dashboard">📊 Dashboard</RouterLink>
      <RouterLink to="/assignments">📝 Assignments</RouterLink>
      <RouterLink to="/activities">📅 Activities</RouterLink>
      <a>🌤️ Weather</a>
      <a>👥 Group Meetings</a>
    </aside>

    <main class="main">
      <div class="container-xxl dashboard-container">
      <!-- Header -->
      <header class="header">
        <div>
          <h1>{{ greeting }}, {{ userName }} 👋</h1>
          <p>{{ todayText }}</p>
        </div>
        <div class="buttons">
          <RouterLink class="btn btn-primary" to="/assignments?new=1">+ Assignment</RouterLink>
        </div>
      </header>

      <p v-if="plannerError" class="alert alert-danger py-2 px-3" role="alert">{{ plannerError }}</p>
      <p v-else-if="plannerLoading" class="muted">Loading your course work…</p>

      <!-- Stats -->
      <section class="row g-3 mb-4" aria-label="Planner summary">
        <div class="col-12 col-sm-6 col-lg-3" v-for="s in stats" :key="s.label">
          <div class="card stat h-100">
            <div class="card-body">
              <span class="emoji">{{ s.icon }}</span>
              <div>
                <b>{{ s.value }}</b>
                <small>{{ s.label }}</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="row g-4">
        <!-- LEFT -->
        <div class="content-column col-12 col-xl-8">
          <!-- Timeline -->
          <div class="card">
            <div class="card-body">
              <div class="section-heading">
                <h3>🕒 Upcoming Timeline</h3>
                <div class="tabs">
                  <button v-for="t in ['all', 'assignment', 'quiz']" :key="t"
                          :class="{ on: filter === t }" @click="filter = t">{{ t }}</button>
                </div>
              </div>

              <p v-if="!timeline.length" class="empty">Nothing coming up 🎉</p>

              <div v-for="item in timeline" :key="item.type + item.id" class="item" :class="item.type">
                <input type="checkbox" :checked="item.done" @change="toggle(item)" />
                <div class="info" :class="{ done: item.done }">
                  <strong>{{ item.title }}</strong>
                  <small v-if="item.type === 'activity'">📍 {{ item.place }}</small>
                  <small v-else>{{ item.courseName }}</small>
                </div>
                <span class="when">{{ dayLabel(item.when) }}<br />{{ time(item.when) }}</span>
              </div>
            </div>
          </div>

          <!-- Assignments -->
          <div class="card">
            <div class="card-body">
              <div class="section-heading">
                <h3>🚩 Assignments</h3>
                <div class="filters">
                  <select v-model="sortBy" class="form-select form-select-sm w-auto">
                    <option value="deadline">Sort by deadline</option>
                    <option value="course">Sort by course</option>
                  </select>
                </div>
              </div>

              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <tbody>
                    <tr v-if="!filteredAssignments.length">
                      <td colspan="4" class="empty">No assignments are in the JSON data for this course.</td>
                    </tr>
                    <tr v-for="a in filteredAssignments" :key="a.id" :class="{ done: a.done }">
                      <td><input type="checkbox" :checked="a.done" @change="toggle(a)" /></td>
                      <td><strong>{{ a.title }}</strong></td>
                      <td><span class="badge rounded-pill tag">{{ a.courseName }}</span></td>
                      <td class="muted">{{ a.when ? dayLabel(a.when) : 'No due date' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT -->
        <div class="content-column col-12 col-xl-4">
          <!-- Progress -->
          <div class="card">
            <div class="card-body">
              <h3>🏆 Progress</h3>
              <div class="bar"><div :style="{ width: progress + '%' }"></div></div>
              <small class="muted">{{ doneCount }} of {{ assignments.length }} assignments done ({{ progress }}%)</small>
            </div>
          </div>

          <!-- Conflicts -->
          <div class="card">
            <div class="card-body">
              <h3>⚠️ Schedule Conflicts</h3>
              <p v-if="!conflicts.length" class="alert alert-success py-2 px-3 mb-0">No conflicts. You're all clear ✅</p>
              <p v-for="c in conflicts" :key="c" class="alert alert-warning py-2 px-3 mb-0 mt-2">{{ c }}</p>
            </div>
          </div>

          <!-- Weather -->
          <div class="card">
            <div class="card-body">
              <h3>🌤️ Smart Weather Check</h3>
              <p v-if="weatherError" class="alert alert-warning py-2 px-3 mb-0">Couldn't load the forecast.</p>
              <p v-else-if="!forecast.length" class="muted">Loading forecast…</p>

              <template v-else>
                <div class="forecast">
                  <div v-for="d in forecast" :key="d.date">
                    <small>{{ d.dow }}</small>
                    <span>{{ d.icon }}</span>
                    <b>{{ d.max }}°</b>
                  </div>
                </div>

                <h4>Outdoor activities</h4>
              <p v-if="!outdoorChecks.length" class="muted">Add an activity to see its weather outlook here.</p>
                <div v-for="o in outdoorChecks" :key="o.id" class="outdoor">
                  <div>
                    <strong>{{ o.title }}</strong>
                    <small>{{ dayLabel(o.when) }} · {{ o.rain }}% rain</small>
                  </div>
                  <span class="verdict" :class="o.cls">{{ o.verdict }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

const userName = ref('there')
const plannerLoading = ref(true)
const plannerError = ref('')
const assignments = ref([])
const quizzes = ref([])
const activities = ref([])

const fetchUserData = async () => {
  try {
    const response = await fetch('http://localhost:8000/api/me', {
      credentials: 'include' 
    })
    const data = await response.json()
    userName.value = data.user.username
  } catch (err) {
    console.error('Failed to fetch session user:', err)
  }
}

const fetchPlannerData = async () => {
  plannerLoading.value = true
  plannerError.value = ''

  try {
    const response = await fetch('http://localhost:8000/api/planner-data', {
      credentials: 'include'
    })
    if (!response.ok) throw new Error('Could not load planner data.')

    const data = await response.json()
    const toDashboardItem = (item, type) => ({
      id: item.Id,
      title: item.Name,
      courseName: item.CourseName,
      when: item.EventDate || item.DueDate || item.StartDate
        ? new Date(item.EventDate || item.DueDate || item.StartDate)
        : null,
      done: false,
      type
    })

    assignments.value = (data.assignments || []).map(item => toDashboardItem(item, 'assignment'))
    quizzes.value = (data.quizzes || []).map(item => toDashboardItem(item, 'quiz'))
    activities.value = (data.activities || []).map(activity => ({
      ...activity,
      when: new Date(activity.when),
      end: new Date(activity.end),
      type: 'activity'
    }))
  } catch (error) {
    plannerError.value = error.message || 'Could not load your course work.'
  } finally {
    plannerLoading.value = false
  }
}

/* ---------- Helpers ---------- */
const now = new Date()
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const todayText = now.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'
const time = d => d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
const dateKey = d => d.toLocaleDateString('en-CA') // gives YYYY-MM-DD in local time
const dayLabel = d => {
  const diff = Math.round((new Date(dateKey(d)) - new Date(dateKey(now))) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
}

const toggle = item => {
  const list = item.type === 'activity'
    ? activities.value
    : item.type === 'quiz' ? quizzes.value : assignments.value
  const target = list.find(x => x.id === item.id)
  if (target) target.done = !target.done
}

/* ---------- Stats ---------- */
const pending = computed(() => assignments.value.filter(a => !a.done))
const doneCount = computed(() => assignments.value.length - pending.value.length)
const progress = computed(() => Math.round((doneCount.value / assignments.value.length) * 100) || 0)

const stats = computed(() => [
  { icon: '📝', label: 'Pending assignments', value: pending.value.length },
  { icon: '⏰', label: 'Due within 3 days', value: pending.value.filter(a => a.when && a.when >= now && a.when - now < 3 * 86400000).length },
  { icon: '✏️', label: 'Upcoming quizzes', value: quizzes.value.filter(quiz => !quiz.done && quiz.when && quiz.when >= now).length },
  { icon: '✅', label: 'Completed', value: doneCount.value },
])

/* ---------- Timeline (assignments, quizzes, and future user activities) ---------- */
const filter = ref('all')
const timeline = computed(() =>
  [
    ...assignments.value.map(a => ({ ...a, type: 'assignment' })),
    ...quizzes.value.map(quiz => ({ ...quiz, type: 'quiz' })),
    ...activities.value.map(a => ({ ...a, type: 'activity' })),
  ]
    .filter(i => i.when && i.when >= todayStart && (filter.value === 'all' || i.type === filter.value))
    .sort((a, b) => a.when - b.when)
)

/* ---------- Assignment filters ---------- */
const sortBy = ref('deadline')

const filteredAssignments = computed(() =>
  assignments.value
    .sort((a, b) => {
      if (sortBy.value === 'course') return a.courseName.localeCompare(b.courseName)
      if (!a.when) return 1
      if (!b.when) return -1
      return a.when - b.when
    })
)

/* ---------- Conflict detection ---------- */
const conflicts = computed(() => {
  const found = []
  const acts = activities.value.filter(a => !a.done)

  // activity overlapping an assignment deadline
  acts.forEach(act =>
    pending.value.forEach(a => {
      if (a.when && a.when >= act.when && a.when <= act.end)
        found.push(`"${act.title}" overlaps the deadline for "${a.title}" (${dayLabel(a.when)}).`)
    })
  )
  // two activities overlapping each other
  acts.forEach((x, i) =>
    acts.slice(i + 1).forEach(y => {
      if (x.when < y.end && y.when < x.end) found.push(`"${x.title}" clashes with "${y.title}".`)
    })
  )
  return found
})

/* ---------- Weather (Open-Meteo geocoding + forecast) ---------- */
const forecast = ref([])
const weatherError = ref(false)
const icon = code => (code === 0 ? '☀️' : code <= 3 ? '⛅' : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 82 ? '🌦️' : '⛈️')

onMounted(async () => {
  fetchUserData();
  fetchPlannerData();
  try {
    const geo = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=Singapore&count=1')).json()
    const { latitude, longitude } = geo.results[0]
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      '&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=auto&forecast_days=7'
    const data = (await (await fetch(url)).json()).daily

    forecast.value = data.time.map((date, i) => ({
      date,
      dow: new Date(date + 'T00:00').toLocaleDateString('en-SG', { weekday: 'short' }),
      icon: icon(data.weather_code[i]),
      max: Math.round(data.temperature_2m_max[i]),
      rain: data.precipitation_probability_max[i] ?? 0,
    }))
  } catch {
    weatherError.value = true
  }
})

const outdoorChecks = computed(() =>
  activities.value
    .filter(a => a.outdoor && !a.done)
    .map(a => {
      const day = forecast.value.find(d => d.date === dateKey(a.when))
      const rain = day ? day.rain : 0
      if (!day) return { ...a, rain: '–', verdict: 'No data', cls: 'na' }
      if (rain >= 60) return { ...a, rain, verdict: 'Move indoors', cls: 'bad' }
      if (rain >= 40) return { ...a, rain, verdict: 'Bring backup', cls: 'maybe' }
      return { ...a, rain, verdict: 'Good to go', cls: 'good' }
    })
)
</script>

