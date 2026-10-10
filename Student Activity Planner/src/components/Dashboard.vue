<!-- Dashboard.vue – Student Life Planner home page (Vue 3, no Bootstrap) -->
<template>
  <div class="app">
    <!-- Sidebar -->
    <aside class="sidebar">
      <h2>🎓 Student Planner</h2>
      <a class="active">📊 Dashboard</a>
      <a>📝 Assignments</a>
      <a>📅 Activities</a>
      <a>🌤️ Weather</a>
      <a>👥 Group Meetings</a>
    </aside>

    <main class="main">
      <!-- Header -->
      <header class="header">
        <div>
          <h1>{{ greeting }}, {{ userName }} 👋</h1>
          <p>{{ todayText }}</p>
        </div>
        <div class="buttons">
          <button class="btn primary">+ Assignment</button>
          <button class="btn">+ Activity</button>
        </div>
      </header>

      <!-- Stats -->
      <section class="stats">
        <div class="card stat" v-for="s in stats" :key="s.label">
          <span class="emoji">{{ s.icon }}</span>
          <div>
            <b>{{ s.value }}</b>
            <small>{{ s.label }}</small>
          </div>
        </div>
      </section>

      <div class="columns">
        <!-- LEFT -->
        <div class="col">
          <!-- Timeline -->
          <div class="card">
            <div class="row">
              <h3>🕒 Upcoming Timeline</h3>
              <div class="tabs">
                <button v-for="t in ['all', 'assignment', 'activity']" :key="t"
                        :class="{ on: filter === t }" @click="filter = t">{{ t }}</button>
              </div>
            </div>

            <p v-if="!timeline.length" class="empty">Nothing coming up 🎉</p>

            <div v-for="item in timeline" :key="item.type + item.id" class="item" :class="item.type">
              <input type="checkbox" :checked="item.done" @change="toggle(item)" />
              <div class="info" :class="{ done: item.done }">
                <strong>{{ item.title }}</strong>
                <small v-if="item.type === 'assignment'">{{ item.module }} · {{ item.priority }} priority</small>
                <small v-else>📍 {{ item.place }}</small>
              </div>
              <span class="when">{{ dayLabel(item.when) }}<br />{{ time(item.when) }}</span>
            </div>
          </div>

          <!-- Assignments -->
          <div class="card">
            <div class="row">
              <h3>🚩 Assignments</h3>
              <div class="filters">
                <select v-model="moduleFilter">
                  <option value="all">All modules</option>
                  <option v-for="module in modules" :key="module">{{ module  }}</option>
                </select>
                <select v-model="sortBy">
                  <option value="deadline">Sort by deadline</option>
                  <option value="priority">Sort by priority</option>
                </select>
              </div>
            </div>

            <table>
              <tr v-for="a in filteredAssignments" :key="a.id" :class="{ done: a.done }">
                <td><input type="checkbox" :checked="a.done" @change="toggle(a)" /></td>
                <td><strong>{{ a.title }}</strong></td>
                <td><span class="tag">{{ a.module }}</span></td>
                <td><span class="tag" :class="a.priority">{{ a.priority }}</span></td>
                <td class="muted">{{ dayLabel(a.when) }}</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- RIGHT -->
        <div class="col">
          <!-- Progress -->
          <div class="card">
            <h3>🏆 Progress</h3>
            <div class="bar"><div :style="{ width: progress + '%' }"></div></div>
            <small class="muted">{{ doneCount }} of {{ assignments.length }} assignments done ({{ progress }}%)</small>
          </div>

          <!-- Conflicts -->
          <div class="card">
            <h3>⚠️ Schedule Conflicts</h3>
            <p v-if="!conflicts.length" class="ok">No conflicts. You're all clear ✅</p>
            <p v-for="c in conflicts" :key="c" class="warn">{{ c }}</p>
          </div>

          <!-- Weather -->
          <div class="card">
            <h3>🌤️ Smart Weather Check</h3>
            <p v-if="weatherError" class="warn">Couldn't load the forecast.</p>
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
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

/* ---------- Sample data (replace with calls to your Express/MongoDB API) ---------- */
const userName = ref('Rithik')
const at = (days, hour, min = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, min, 0, 0)
  return d
}

const assignments = ref([
  { id: 1, title: 'IS216 Project Proposal', module: 'IS216', priority: 'high', when: at(0, 23, 59), done: false },
  { id: 2, title: 'Calculus Problem Set 4', module: 'MA1521', priority: 'medium', when: at(1, 12), done: false },
  { id: 3, title: 'Reflection Essay', module: 'GEN2000', priority: 'low', when: at(2, 15), done: false },
  { id: 4, title: 'Database Lab Report', module: 'IS210', priority: 'high', when: at(4, 18), done: false },
  { id: 5, title: 'Quiz Revision Sheet', module: 'IS210', priority: 'low', when: at(-1, 9), done: true },
])

const activities = ref([
  { id: 1, title: 'Morning Run', place: 'East Coast Park', outdoor: true, when: at(0, 7), end: at(0, 8), done: false },
  { id: 2, title: 'Team Meeting', place: 'Library Room 3', outdoor: false, when: at(1, 14), end: at(1, 16), done: false },
  { id: 3, title: 'Inter-Hall Football', place: 'University Field', outdoor: true, when: at(2, 14), end: at(2, 17), done: false },
  { id: 4, title: 'Beach BBQ', place: 'Sentosa', outdoor: true, when: at(5, 17, 30), end: at(5, 21), done: false },
])

/* ---------- Helpers ---------- */
const now = new Date()
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
  const list = item.type === 'activity' ? activities.value : assignments.value
  const target = list.find(x => x.id === item.id)
  target.done = !target.done
}

/* ---------- Stats ---------- */
const pending = computed(() => assignments.value.filter(a => !a.done))
const doneCount = computed(() => assignments.value.length - pending.value.length)
const progress = computed(() => Math.round((doneCount.value / assignments.value.length) * 100) || 0)

const stats = computed(() => [
  { icon: '📝', label: 'Pending assignments', value: pending.value.length },
  { icon: '⏰', label: 'Due within 3 days', value: pending.value.filter(a => a.when - now < 3 * 86400000).length },
  { icon: '📅', label: 'Upcoming activities', value: activities.value.filter(a => !a.done).length },
  { icon: '✅', label: 'Completed', value: doneCount.value },
])

/* ---------- Timeline (assignments + activities in one list) ---------- */
const filter = ref('all')
const timeline = computed(() =>
  [
    ...assignments.value.map(a => ({ ...a, type: 'assignment' })),
    ...activities.value.map(a => ({ ...a, type: 'activity' })),
  ]
    .filter(i => i.when >= new Date(dateKey(now)) && (filter.value === 'all' || i.type === filter.value))
    .sort((a, b) => a.when - b.when)
)

/* ---------- Assignment filters ---------- */
const moduleFilter = ref('all')
const sortBy = ref('deadline')
const modules = computed(() => [...new Set(assignments.value.map(a => a.module))])
const rank = { high: 3, medium: 2, low: 1 }

const filteredAssignments = computed(() =>
  assignments.value
    .filter(a => moduleFilter.value === 'all' || a.module === moduleFilter.value)
    .sort((a, b) => (sortBy.value === 'priority' ? rank[b.priority] - rank[a.priority] : a.when - b.when))
)

/* ---------- Conflict detection ---------- */
const conflicts = computed(() => {
  const found = []
  const acts = activities.value.filter(a => !a.done)

  // activity overlapping an assignment deadline
  acts.forEach(act =>
    pending.value.forEach(a => {
      if (a.when >= act.when && a.when <= act.end)
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

<style>
:root {
  --brand: #5b5bf0;
  --ink: #1e2340;
  --muted: #7b819e;
  --bg: #f4f6fc;
  --red: #f03e5f;
  --green: #12b886;
}
body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, 'Segoe UI', sans-serif; }

/* Layout */
.app { display: flex; min-height: 100vh; }
.sidebar {
  width: 230px; padding: 24px 16px; color: #fff; position: sticky; top: 0; height: 100vh; box-sizing: border-box;
  background: linear-gradient(170deg, #3b3bd8, #8b5cf6);
}
.sidebar h2 { font-size: 1.2rem; margin: 0 0 28px 8px; }
.sidebar a { display: block; padding: 12px 14px; margin-bottom: 6px; border-radius: 12px; cursor: pointer; opacity: .85; }
.sidebar a:hover { background: rgba(255, 255, 255, .15); }
.sidebar a.active { background: #fff; color: var(--brand); font-weight: 700; opacity: 1; }
.main { flex: 1; padding: 28px 32px; min-width: 0; }

.header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.header h1 { margin: 0; font-size: 1.7rem; }
.header p { margin: 4px 0 0; color: var(--muted); }
.buttons { display: flex; gap: 10px; }
.btn { padding: 10px 18px; border-radius: 12px; border: 1px solid #d9dcf0; background: #fff; font-weight: 600; cursor: pointer; }
.btn.primary { background: var(--brand); color: #fff; border: 0; box-shadow: 0 6px 16px rgba(91, 91, 240, .35); }

/* Cards */
.card { background: #fff; border-radius: 18px; padding: 20px; margin-bottom: 20px; box-shadow: 0 8px 24px rgba(60, 70, 140, .08); }
.card h3 { margin: 0 0 14px; font-size: 1.05rem; }
.card h4 { margin: 18px 0 8px; font-size: .8rem; color: var(--muted); text-transform: uppercase; }
.row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; margin-bottom: 20px; }
.stat { display: flex; align-items: center; gap: 14px; margin: 0; }
.stat .emoji { font-size: 1.6rem; background: #ececff; width: 50px; height: 50px; display: grid; place-items: center; border-radius: 14px; }
.stat b { font-size: 1.7rem; display: block; line-height: 1; }
.stat small, .info small, .outdoor small { color: var(--muted); display: block; margin-top: 3px; }

.columns { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
@media (max-width: 1000px) { .columns { grid-template-columns: 1fr; } .sidebar { display: none; } }

/* Timeline */
.tabs { display: flex; background: #f0f1fb; border-radius: 10px; padding: 3px; }
.tabs button { border: 0; background: none; padding: 5px 12px; border-radius: 8px; font-weight: 600; color: var(--muted); text-transform: capitalize; cursor: pointer; }
.tabs button.on { background: #fff; color: var(--brand); box-shadow: 0 2px 6px rgba(0, 0, 0, .1); }

.item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-top: 10px; background: #f8f9fe; border-radius: 14px; border-left: 5px solid; }
.item.assignment { border-color: var(--red); }
.item.activity { border-color: var(--green); }
.item .info { flex: 1; }
.info.done, tr.done { opacity: .5; text-decoration: line-through; }
.when { font-size: .8rem; font-weight: 600; color: var(--muted); text-align: right; }
input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--brand); cursor: pointer; }

/* Assignments table */
.filters { display: flex; gap: 8px; }
select { padding: 7px 10px; border-radius: 10px; border: 1px solid #e0e3f5; background: #f6f7fd; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
td { padding: 12px 6px; border-bottom: 1px solid #eef0fa; }
.muted { color: var(--muted); font-size: .85rem; }
.tag { padding: 3px 10px; border-radius: 99px; font-size: .75rem; font-weight: 700; background: #ececff; color: var(--brand); }
.tag.high { background: #ffe9ee; color: var(--red); }
.tag.medium { background: #fff3d6; color: #c27d00; }
.tag.low { background: #dcf8ef; color: #0b8e68; }

/* Progress, alerts, weather */
.bar { height: 12px; background: #e8eafc; border-radius: 99px; overflow: hidden; margin-bottom: 8px; }
.bar div { height: 100%; background: linear-gradient(90deg, var(--brand), #8b5cf6); border-radius: 99px; transition: width .4s; }
.warn, .ok { padding: 12px; border-radius: 12px; font-size: .88rem; margin: 8px 0 0; }
.warn { background: #fff4e0; color: #8a5a00; }
.ok { background: #dcf8ef; color: #0a7a5a; }

.forecast { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; background: linear-gradient(135deg, #38a1f3, #5b5bf0); color: #fff; padding: 12px 4px; border-radius: 14px; }
.forecast span { display: block; font-size: 1.2rem; margin: 4px 0; }
.forecast small { font-size: .7rem; opacity: .85; }
.forecast b { font-size: .8rem; }

.outdoor { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e4e6f5; }
.verdict { padding: 4px 10px; border-radius: 99px; font-size: .72rem; font-weight: 700; white-space: nowrap; }
.good { background: #dcf8ef; color: #0a7a5a; }
.maybe { background: #fff3d6; color: #a86b00; }
.bad { background: #ffe9ee; color: var(--red); }
.na { background: #eceefa; color: var(--muted); }
.empty { text-align: center; color: var(--muted); padding: 20px 0; }
</style>