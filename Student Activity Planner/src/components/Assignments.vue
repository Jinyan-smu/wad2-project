<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import axios from 'axios'
import PlannerNavigation from './PlannerNavigation.vue'
import PlannerCompanion from './PlannerCompanion.vue'
import PlannerIcon from './PlannerIcon.vue'
import TaskUrgencyBadge from './TaskUrgencyBadge.vue'
import { recordCourseworkCompletion } from '../utils/dashboardPersonalization'

const API_URL = 'http://localhost:8000/api'
const TIME_ZONE = 'Asia/Singapore'
const route = useRoute()
const courses = ref([])
const assignments = ref([])
const quizzes = ref([])
const loading = ref(true)
const loadError = ref('')
const formError = ref('')
const actionError = ref('')
const successMessage = ref('')
const saving = ref(false)
const pendingKeys = ref([])
const showForm = ref(false)
const editingAssignment = ref(null)
const selectedCourseId = ref('all')
const searchQuery = ref('')
const typeFilter = ref('all')
const statusFilter = ref('todo')
const selectedKey = ref('')
const detailsHeading = ref(null)
const nameInput = ref(null)
const now = ref(new Date())
const form = ref({ name: '', courseId: '', dueDate: '' })
let viewerRequest = Promise.resolve(null)
let loadRequest = 0
let clock
let destroyed = false

const taskKey = (item) => [item.Type, item.CourseId, item.Id].join(':')
const validDate = (value) => Boolean(value) && Number.isFinite(new Date(value).getTime())
function dateKey(value) {
  if (!validDate(value)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type).value)
    .join('-')
}
const today = computed(() => dateKey(now.value))
const weekEnd = computed(() => {
  const date = new Date(`${today.value}T12:00:00+08:00`)
  date.setUTCDate(date.getUTCDate() + 7)
  return dateKey(date)
})
const tasks = computed(() =>
  [
    ...assignments.value.map((item) => ({ ...item, Type: 'assignment', Done: Boolean(item.Done) })),
    ...quizzes.value.map((item) => ({ ...item, Type: 'quiz', Done: Boolean(item.Done) })),
  ].map((item) => ({
    ...item,
    key: taskKey(item),
    CourseName:
      item.CourseName ||
      courses.value.find((course) => String(course.Id) === String(item.CourseId))?.Name ||
      'Coursework',
  })),
)
function bucket(item) {
  if (item.Done) return 'Completed'
  if (!validDate(item.DueDate)) return 'No due date'
  if (new Date(item.DueDate) < now.value) return 'Overdue'
  const dueDay = dateKey(item.DueDate)
  if (dueDay === today.value) return 'Due today'
  if (dueDay <= weekEnd.value) return 'Next 7 days'
  return 'Later'
}
const summary = computed(() => ({
  overdue: tasks.value.filter((item) => bucket(item) === 'Overdue').length,
  today: tasks.value.filter((item) => bucket(item) === 'Due today').length,
  upcoming: tasks.value.filter((item) => bucket(item) === 'Next 7 days').length,
}))
const pendingCount = computed(() => tasks.value.filter((item) => !item.Done).length)
const completedCount = computed(() => tasks.value.filter((item) => item.Done).length)
const filteredTasks = computed(() =>
  tasks.value
    .filter((item) => {
      if (selectedCourseId.value !== 'all' && String(item.CourseId) !== selectedCourseId.value)
        return false
      if (typeFilter.value !== 'all' && item.Type !== typeFilter.value) return false
      const query = searchQuery.value.trim().toLowerCase()
      if (query && !`${item.Name} ${item.CourseName}`.toLowerCase().includes(query)) return false
      if (statusFilter.value === 'completed') return item.Done
      if (item.Done) return false
      if (statusFilter.value === 'overdue') return bucket(item) === 'Overdue'
      if (statusFilter.value === 'upcoming') return !['Overdue'].includes(bucket(item))
      return true
    })
    .sort(
      (a, b) =>
        (validDate(a.DueDate) ? Date.parse(a.DueDate) : Infinity) -
          (validDate(b.DueDate) ? Date.parse(b.DueDate) : Infinity) || a.Name.localeCompare(b.Name),
    ),
)
const taskGroups = computed(() =>
  ['Overdue', 'Due today', 'Next 7 days', 'Later', 'No due date', 'Completed']
    .map((label) => ({
      label,
      items: filteredTasks.value.filter((item) => bucket(item) === label),
    }))
    .filter((group) => group.items.length),
)
const selectedTask = computed(
  () => filteredTasks.value.find((item) => item.key === selectedKey.value) || null,
)
const hasFilters = computed(
  () =>
    selectedCourseId.value !== 'all' ||
    typeFilter.value !== 'all' ||
    searchQuery.value ||
    ['overdue', 'upcoming'].includes(statusFilter.value),
)
watch(
  filteredTasks,
  (list) => {
    if (!list.some((item) => item.key === selectedKey.value)) selectedKey.value = list[0]?.key || ''
  },
  { immediate: true },
)

function formatDate(value) {
  return validDate(value)
    ? new Date(value).toLocaleDateString('en-SG', {
        timeZone: TIME_ZONE,
        day: 'numeric',
        month: 'short',
      })
    : 'No due date'
}
function formatTime(value) {
  return validDate(value)
    ? new Date(value).toLocaleTimeString('en-SG', {
        timeZone: TIME_ZONE,
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''
}
function urgency(item) {
  if (item.Done || !validDate(item.DueDate)) return null
  if (new Date(item.DueDate) < now.value) return { level: 'overdue', label: 'Overdue' }
  const dueDay = Date.parse(`${dateKey(item.DueDate)}T00:00:00Z`)
  const currentDay = Date.parse(`${today.value}T00:00:00Z`)
  const daysAway = Math.round((dueDay - currentDay) / 86400000)
  if (daysAway === 0) return { level: 'urgent', label: 'Due today' }
  if (daysAway === 1) return { level: 'urgent', label: 'Due tomorrow' }
  if (daysAway <= 3) return { level: 'soon', label: `Due in ${daysAway} days` }
  if (daysAway <= 7) return { level: 'week', label: `Due in ${daysAway} days` }
  return null
}
function inputDate(value) {
  if (!validDate(value)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type) => parts.find((item) => item.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
function messageOf(error, fallback) {
  return typeof error?.response?.data?.message === 'string' ? error.response.data.message : fallback
}
function clearFilters() {
  selectedCourseId.value = 'all'
  searchQuery.value = ''
  typeFilter.value = 'all'
  if (statusFilter.value !== 'completed') statusFilter.value = 'todo'
}
async function selectTask(item) {
  selectedKey.value = item.key
  await nextTick()
  detailsHeading.value?.focus({ preventScroll: true })
  if (window.innerWidth < 1200) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    detailsHeading.value?.closest('.assignment-details')?.scrollIntoView?.({
      block: 'start',
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }
}
function closeForm() {
  if (saving.value) return
  showForm.value = false
  editingAssignment.value = null
  formError.value = ''
}
async function toggleForm() {
  if (saving.value) return
  if (showForm.value) return closeForm()
  editingAssignment.value = null
  form.value = {
    name: '',
    courseId: courses.value[0] ? String(courses.value[0].Id) : '',
    dueDate: '',
  }
  formError.value = ''
  showForm.value = true
  await nextTick()
  nameInput.value?.focus()
}
async function startEditing(item) {
  if (saving.value || item.Type !== 'assignment' || !item.IsCustom) return
  editingAssignment.value = item
  form.value = {
    name: item.Name,
    courseId: String(item.CourseId),
    dueDate: inputDate(item.DueDate),
  }
  formError.value = ''
  showForm.value = true
  await nextTick()
  nameInput.value?.focus()
}

function applyRoute() {
  selectedCourseId.value =
    typeof route.query.course === 'string' &&
    courses.value.some((course) => String(course.Id) === route.query.course)
      ? route.query.course
      : 'all'
  searchQuery.value = typeof route.query.search === 'string' ? route.query.search : ''
  typeFilter.value = ['assignment', 'quiz'].includes(route.query.type) ? route.query.type : 'all'
  statusFilter.value = ['completed', 'overdue', 'upcoming'].includes(route.query.status)
    ? route.query.status
    : 'todo'
  const event =
    typeof route.query.event === 'string'
      ? route.query.event
      : typeof route.query.id === 'string' && route.query.type && route.query.course
        ? `${route.query.type}:${route.query.course}:${route.query.id}`
        : ''
  const requested = tasks.value.find((item) => item.key === event)
  if (requested) {
    selectedCourseId.value = String(requested.CourseId)
    typeFilter.value = requested.Type
    searchQuery.value = ''
    statusFilter.value = requested.Done ? 'completed' : 'todo'
    selectedKey.value = requested.key
  }
  if (route.query.new === '1' && !showForm.value) toggleForm()
}
watch(
  () => [
    route.query.course,
    route.query.search,
    route.query.status,
    route.query.type,
    route.query.id,
    route.query.event,
    route.query.new,
  ],
  applyRoute,
)

async function loadPlannerData({ routeFilters = false } = {}) {
  const request = ++loadRequest
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get(`${API_URL}/planner-data`, { withCredentials: true })
    if (destroyed || request !== loadRequest) return false
    courses.value = data.courses || []
    assignments.value = data.assignments || []
    quizzes.value = data.quizzes || []
    if (!form.value.courseId && courses.value.length)
      form.value.courseId = String(courses.value[0].Id)
    if (routeFilters) applyRoute()
    return true
  } catch (error) {
    if (!destroyed && request === loadRequest)
      loadError.value = messageOf(error, 'Could not load your coursework. Please try again.')
    return false
  } finally {
    if (!destroyed && request === loadRequest) loading.value = false
  }
}
async function saveAssignment() {
  if (saving.value) return
  formError.value = ''
  successMessage.value = ''
  if (!form.value.name.trim() || !form.value.courseId) {
    formError.value = 'Enter an assignment name and choose a course.'
    return
  }
  const due = form.value.dueDate ? new Date(`${form.value.dueDate}+08:00`) : null
  if (due && !Number.isFinite(due.getTime())) {
    formError.value = 'Enter a valid due date.'
    return
  }
  const editing = editingAssignment.value
  const payload = {
    name: form.value.name.trim(),
    courseId: form.value.courseId,
    dueDate: due ? due.toISOString() : null,
  }
  saving.value = true
  try {
    const response = editing
      ? await axios.patch(
          `${API_URL}/assignments/${encodeURIComponent(editing.CourseId)}/${encodeURIComponent(editing.Id)}`,
          payload,
          { withCredentials: true },
        )
      : await axios.post(`${API_URL}/assignments`, payload, { withCredentials: true })
    if (destroyed) return
    const saved = response?.data?.assignment
    if (saved) {
      const index = assignments.value.findIndex(
        (item) =>
          String(item.Id) === String(saved.Id) && String(item.CourseId) === String(saved.CourseId),
      )
      if (index >= 0) assignments.value[index] = { ...assignments.value[index], ...saved }
      else assignments.value.push(saved)
      clearFilters()
      statusFilter.value = assignments.value.find(
        (item) =>
          String(item.Id) === String(saved.Id) && String(item.CourseId) === String(saved.CourseId),
      )?.Done
        ? 'completed'
        : 'todo'
      selectedKey.value = `assignment:${saved.CourseId}:${saved.Id}`
    } else await loadPlannerData()
    if (destroyed) return
    showForm.value = false
    editingAssignment.value = null
    form.value.name = ''
    form.value.dueDate = ''
    successMessage.value = editing ? 'Assignment updated.' : 'Assignment saved.'
  } catch (error) {
    if (!destroyed)
      formError.value = messageOf(error, 'Could not save the assignment. Please try again.')
  } finally {
    if (!destroyed) saving.value = false
  }
}

async function toggleCompleted(item, event) {
  if (event?.target) event.target.checked = item.Done
  if (pendingKeys.value.includes(item.key)) return
  pendingKeys.value.push(item.key)
  actionError.value = ''
  const done = !item.Done
  try {
    await axios.patch(
      `${API_URL}/coursework/${item.Type}/${encodeURIComponent(item.CourseId)}/${encodeURIComponent(item.Id)}`,
      { done },
      { withCredentials: true },
    )
    if (destroyed) return
    const list = item.Type === 'quiz' ? quizzes.value : assignments.value
    const source = list.find(
      (candidate) =>
        String(candidate.Id) === String(item.Id) &&
        String(candidate.CourseId) === String(item.CourseId),
    )
    if (source) source.Done = done
    viewerRequest.then((userId) =>
      recordCourseworkCompletion(userId, { key: item.key, title: item.Name }, done),
    )
    successMessage.value = done ? 'Marked as completed.' : 'Moved to To do.'
  } catch (error) {
    if (!destroyed)
      actionError.value = messageOf(error, 'Could not update this item. Please try again.')
  } finally {
    if (!destroyed) pendingKeys.value = pendingKeys.value.filter((key) => key !== item.key)
  }
}

onMounted(() => {
  viewerRequest = axios
    .get(`${API_URL}/me`, { withCredentials: true, timeout: 10000 })
    .then(({ data }) => data.user?.id ?? null)
    .catch(() => null)
  loadPlannerData({ routeFilters: true })
  clock = window.setInterval(() => {
    now.value = new Date()
  }, 60000)
})
onBeforeUnmount(() => {
  destroyed = true
  loadRequest++
  window.clearInterval(clock)
})
</script>

<template>
  <div class="app assignments-app">
    <PlannerNavigation active="/assignments" />
    <main class="main assignments-page">
      <div class="container-xxl assignments-container">
        <PlannerNavigation active="/assignments" mobile />
        <header class="header assignments-header">
          <div>
            <p class="eyebrow">ONE THING AT A TIME</p>
            <h1>Assignments</h1>
            <p>Know what's due. Focus on what's next.</p>
          </div>
          <button
            type="button"
            class="btn btn-primary"
            :aria-expanded="showForm"
            :disabled="saving"
            @click="toggleForm"
          >
            <PlannerIcon v-if="!showForm" name="plus" />{{
              showForm ? 'Close form' : 'Add assignment'
            }}
          </button>
        </header>
        <PlannerCompanion character="coral" message="One thing at a time. You've got this." />
        <div
          v-if="loadError"
          class="alert alert-danger d-flex align-items-center justify-content-between gap-2"
          role="alert"
        >
          <span>{{ loadError }}</span
          ><button class="btn btn-sm btn-outline-danger" type="button" @click="loadPlannerData()">
            Try again
          </button>
        </div>
        <div v-if="actionError" class="alert alert-danger" role="alert">{{ actionError }}</div>
        <p v-if="successMessage" class="assignment-notice" role="status">{{ successMessage }}</p>

        <section
          v-if="showForm"
          class="assignment-form-card"
          aria-labelledby="assignment-form-heading"
        >
          <div class="form-heading">
            <h2 id="assignment-form-heading">
              {{ editingAssignment ? 'Edit assignment' : 'Add an assignment' }}
            </h2>
            <p>Save your personal coursework alongside your course deadlines.</p>
          </div>
          <div v-if="formError" class="alert alert-danger" role="alert">{{ formError }}</div>
          <p v-if="!loading && !courses.length" class="assignment-help">
            No courses are available yet. Add coursework after your course list loads.
          </p>
          <form class="assignment-form" novalidate @submit.prevent="saveAssignment">
            <label class="form-field form-wide" for="assignment-name"
              >Assignment name<input
                id="assignment-name"
                ref="nameInput"
                v-model="form.name"
                class="form-control"
                maxlength="160"
                :disabled="saving"
                placeholder="e.g. Project proposal"
                required
            /></label>
            <label class="form-field" for="assignment-course"
              >Course<select
                id="assignment-course"
                v-model="form.courseId"
                class="form-select"
                :disabled="saving || Boolean(editingAssignment)"
                required
              >
                <option value="" disabled>Choose a course</option>
                <option v-for="course in courses" :key="course.Id" :value="String(course.Id)">
                  {{ course.Name }}
                </option>
              </select></label
            >
            <label class="form-field" for="assignment-due-date"
              >Due date <span class="field-hint">optional · Singapore time</span
              ><input
                id="assignment-due-date"
                v-model="form.dueDate"
                class="form-control"
                type="datetime-local"
                :disabled="saving"
            /></label>
            <div class="form-actions form-wide">
              <button
                type="button"
                class="btn btn-outline-secondary"
                :disabled="saving"
                @click="closeForm"
              >
                Cancel</button
              ><button
                type="submit"
                class="btn btn-primary"
                :disabled="saving || loading || !courses.length"
              >
                {{
                  saving ? 'Saving…' : editingAssignment ? 'Update assignment' : 'Save assignment'
                }}
              </button>
            </div>
          </form>
        </section>

        <p v-if="!loading && !loadError" class="assignment-summary" aria-label="Coursework summary">
          <span class="summary-overdue"
            ><strong>{{ summary.overdue }}</strong> overdue</span
          ><span
            ><strong>{{ summary.today }}</strong> due today</span
          ><span
            ><strong>{{ summary.upcoming }}</strong> in the next 7 days</span
          >
        </p>
        <div v-if="loading" class="assignment-loading" role="status">
          <span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading your
          coursework…
        </div>
        <div v-else-if="!loadError" class="assignment-layout">
          <div class="assignment-work">
            <div class="assignment-tabs" role="group" aria-label="Completion status">
              <button
                type="button"
                :aria-pressed="statusFilter !== 'completed'"
                @click="statusFilter = 'todo'"
              >
                To do <span>{{ pendingCount }}</span></button
              ><button
                type="button"
                :aria-pressed="statusFilter === 'completed'"
                @click="statusFilter = 'completed'"
              >
                Completed <span>{{ completedCount }}</span>
              </button>
            </div>
            <div class="assignment-filters">
              <label
                ><span class="visually-hidden">Filter by course</span
                ><select v-model="selectedCourseId" class="form-select form-select-sm">
                  <option value="all">All courses</option>
                  <option v-for="course in courses" :key="course.Id" :value="String(course.Id)">
                    {{ course.Name }}
                  </option>
                </select></label
              >
              <label
                ><span class="visually-hidden">Filter by task type</span
                ><select v-model="typeFilter" class="form-select form-select-sm">
                  <option value="all">Assignments &amp; quizzes</option>
                  <option value="assignment">Assignments only</option>
                  <option value="quiz">Quizzes only</option>
                </select></label
              >
              <label class="assignment-search"
                ><span class="visually-hidden">Search coursework</span
                ><input
                  v-model="searchQuery"
                  class="form-control form-control-sm"
                  type="search"
                  placeholder="Search coursework"
              /></label>
              <button
                v-if="hasFilters"
                type="button"
                class="btn btn-sm btn-link"
                @click="clearFilters"
              >
                Clear filters
              </button>
            </div>
            <div v-if="!filteredTasks.length" class="assignment-empty">
              <PlannerIcon name="check" />
              <h2>{{ tasks.length ? 'No tasks in this view' : 'No coursework yet' }}</h2>
              <p>
                {{
                  tasks.length
                    ? 'Try another course, task type, or completion tab.'
                    : 'Your assignments and quizzes will appear here. You can also add a personal assignment.'
                }}
              </p>
              <button
                v-if="hasFilters"
                type="button"
                class="btn btn-sm btn-outline-primary"
                @click="clearFilters"
              >
                Clear filters</button
              ><button
                v-else-if="!tasks.length"
                type="button"
                class="btn btn-sm btn-primary"
                @click="toggleForm"
              >
                Add assignment
              </button>
            </div>
            <section
              v-for="group in taskGroups"
              :key="group.label"
              class="deadline-group"
              :data-group="group.label"
              :aria-label="group.label"
            >
              <div class="deadline-group-heading">
                <h2>{{ group.label }}</h2>
                <span>{{ group.items.length }}</span>
              </div>
              <div class="deadline-rows">
                <article
                  v-for="item in group.items"
                  :key="item.key"
                  class="coursework-card"
                  :class="{ 'is-selected': selectedKey === item.key, 'is-complete': item.Done }"
                >
                  <input
                    class="task-checkbox"
                    type="checkbox"
                    :checked="item.Done"
                    :disabled="pendingKeys.includes(item.key)"
                    :aria-label="`Mark ${item.Name} completed`"
                    @change="toggleCompleted(item, $event)"
                  />
                  <button
                    type="button"
                    class="task-open"
                    :aria-label="`View ${item.Name}`"
                    :aria-pressed="selectedKey === item.key"
                    @click="selectTask(item)"
                  >
                    <strong>{{ item.Name }}</strong
                    ><span
                      >{{ item.CourseName }}
                      <span>· {{ item.Type === 'quiz' ? 'Quiz' : 'Assignment' }}</span></span
                    >
                  </button>
                  <div class="task-due">
                    <time v-if="validDate(item.DueDate)" :datetime="item.DueDate"
                      >{{ formatDate(item.DueDate) }} · {{ formatTime(item.DueDate) }}</time
                    ><span v-else class="undated-label">No due date</span
                    ><span v-if="item.Done" class="task-status task-status--done">Completed</span
                    ><TaskUrgencyBadge v-else-if="urgency(item)" :urgency="urgency(item)" /><span
                      v-else
                      class="task-status"
                      >{{
                        validDate(item.DueDate)
                          ? 'Upcoming'
                          : item.Type === 'quiz' && validDate(item.StartDate)
                            ? 'Quiz available'
                            : 'Unscheduled'
                      }}</span
                    >
                  </div>
                </article>
              </div>
            </section>
          </div>
          <aside
            v-if="selectedTask"
            class="assignment-details"
            aria-label="Selected assignment details"
          >
            <p class="details-eyebrow">
              {{ selectedTask.Type === 'quiz' ? 'QUIZ DETAILS' : 'ASSIGNMENT DETAILS' }}
            </p>
            <span class="details-icon"><PlannerIcon name="check" /></span>
            <h2 ref="detailsHeading" tabindex="-1">{{ selectedTask.Name }}</h2>
            <p class="details-course">{{ selectedTask.CourseName }}</p>
            <span v-if="selectedTask.Done" class="task-status task-status--done">Completed</span
            ><TaskUrgencyBadge v-else-if="urgency(selectedTask)" :urgency="urgency(selectedTask)" />
            <dl class="details-meta">
              <div>
                <dt><PlannerIcon name="calendar" />Due</dt>
                <dd>
                  {{ formatDate(selectedTask.DueDate)
                  }}<template v-if="validDate(selectedTask.DueDate)"
                    ><br />{{ formatTime(selectedTask.DueDate) }} · Singapore time</template
                  >
                </dd>
              </div>
              <div v-if="selectedTask.Type === 'quiz' && validDate(selectedTask.StartDate)">
                <dt>Available from</dt>
                <dd>
                  {{ formatDate(selectedTask.StartDate) }} ·
                  {{ formatTime(selectedTask.StartDate) }}
                </dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>
                  {{
                    selectedTask.Type === 'quiz'
                      ? 'Quiz'
                      : selectedTask.IsCustom
                        ? 'Personal assignment'
                        : 'Course assignment'
                  }}
                </dd>
              </div>
            </dl>
            <div class="details-description">
              <h3>What to do</h3>
              <p>
                {{
                  selectedTask.Description ||
                  selectedTask.Instructions ||
                  (selectedTask.Type === 'quiz'
                    ? 'Review the quiz requirements in your course materials before its due date.'
                    : selectedTask.IsCustom
                      ? 'Your personal coursework reminder. Edit its name or due date as your plans change.'
                      : 'Check your course materials for the full requirements and submission instructions.')
                }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary details-complete"
              :disabled="pendingKeys.includes(selectedTask.key)"
              @click="toggleCompleted(selectedTask)"
            >
              {{
                pendingKeys.includes(selectedTask.key)
                  ? 'Saving…'
                  : selectedTask.Done
                    ? 'Mark as to do'
                    : 'Mark complete'
              }}
            </button>
            <button
              v-if="selectedTask.Type === 'assignment' && selectedTask.IsCustom"
              type="button"
              class="btn btn-outline-secondary details-edit"
              :disabled="saving"
              @click="startEditing(selectedTask)"
            >
              Edit assignment
            </button>
            <RouterLink
              v-if="
                validDate(selectedTask.DueDate || selectedTask.EventDate || selectedTask.StartDate)
              "
              class="details-calendar-link"
              :to="{ path: '/calendar', query: { event: selectedTask.key } }"
              ><PlannerIcon name="calendar" />View in Calendar</RouterLink
            >
            <p class="details-help">Select another task to view its details.</p>
          </aside>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.assignments-container {
  max-width: 1440px;
}
.assignments-header .btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.assignment-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 0 0 26px;
  color: var(--muted);
  font-size: 0.78rem;
}
.assignment-summary strong {
  color: var(--ink);
  font-weight: 700;
}
.assignment-summary .summary-overdue,
.assignment-summary .summary-overdue strong {
  color: var(--red);
}
.assignment-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 285px;
  gap: 24px;
  align-items: start;
}
.assignment-work {
  min-width: 0;
}
.assignment-tabs {
  display: flex;
  gap: 22px;
  border-bottom: 1px solid var(--border);
  width: fit-content;
  margin-bottom: 17px;
}
.assignment-tabs button {
  padding: 8px 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 650;
}
.assignment-tabs button[aria-pressed='true'] {
  color: var(--brand);
  border-bottom-color: var(--brand);
}
.assignment-tabs button span {
  display: inline-block;
  padding: 1px 6px;
  margin-left: 5px;
  background: var(--brand-soft);
  border-radius: 6px;
  color: var(--brand);
  font-size: 0.66rem;
}
.assignment-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 25px;
}
.assignment-filters label {
  min-width: 0;
  max-width: 100%;
}
.assignment-filters :is(input, select) {
  font-size: 0.76rem;
  min-height: 35px;
}
.assignment-filters .assignment-search {
  flex: 1 1 155px;
}
.deadline-group {
  margin: 0 0 24px;
}
.deadline-group-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.app .deadline-group-heading h2 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 650;
}
.deadline-group-heading > span {
  font-size: 0.68rem;
  color: var(--muted);
}
.deadline-group[data-group='Overdue'] h2 {
  color: var(--red);
}
.deadline-rows {
  border: 1px solid var(--border);
  border-radius: 13px;
  overflow: hidden;
  background: var(--surface);
}
.coursework-card {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 19px 17px;
  border-bottom: 1px solid var(--border);
}
.coursework-card:last-child {
  border-bottom: 0;
}
.coursework-card.is-selected {
  background: var(--brand-soft);
}
.task-checkbox {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}
.task-open {
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  color: var(--ink);
  min-width: 0;
}
.task-open strong {
  display: block;
  font-size: 0.85rem;
  font-weight: 650;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.task-open > span {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.71rem;
  line-height: 1.6;
}
.is-complete .task-open strong {
  color: var(--muted);
}
.task-due {
  display: flex;
  flex-direction: column;
  gap: 7px;
  align-items: flex-end;
  min-width: 85px;
}
.task-due :is(time, .undated-label) {
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.6;
  text-align: right;
}
.task-status {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--brand);
  background: var(--brand-soft);
  font-size: 0.67rem;
  font-weight: 650;
  line-height: 1.5;
}
.task-status--done {
  color: #337354;
  background: #e4f3eb;
}
.assignment-details {
  scroll-margin-top: calc(var(--mobile-nav-height, 0px) + 20px);
  background: var(--surface);
  padding: 25px 22px;
  border: 1px solid var(--border);
  border-radius: 16px;
  min-width: 0;
}
.details-eyebrow {
  color: var(--muted);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  margin: 0 0 22px;
}
.details-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  background: var(--brand-soft);
  border-radius: 12px;
  margin-bottom: 17px;
}
.app .assignment-details h2 {
  font-size: 1.16rem;
  line-height: 1.45;
  margin: 0 0 8px;
  letter-spacing: -0.035em;
  overflow-wrap: anywhere;
}
.assignment-details h2:focus {
  outline: none;
}
.assignment-details h2:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 4px;
}
.details-course {
  color: var(--muted);
  margin: 0 0 16px;
  font-size: 0.77rem;
  line-height: 1.7;
}
.details-meta {
  margin: 20px 0;
}
.details-meta > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 7px;
  margin: 12px 0;
  font-size: 0.73rem;
  line-height: 1.7;
}
.details-meta dt {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  color: var(--muted);
  font-weight: 500;
}
.details-meta dt .planner-icon {
  width: 15px;
  height: 15px;
  margin-top: 3px;
}
.details-meta dd {
  margin: 0;
  color: var(--ink);
}
.details-description {
  border-top: 1px solid var(--border);
  padding-top: 18px;
}
.app .details-description h3 {
  margin: 0 0 8px;
  font-size: 0.77rem;
}
.details-description p {
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.85;
  margin: 0;
  overflow-wrap: anywhere;
}
.details-complete,
.details-edit {
  display: block;
  width: 100%;
  margin-top: 20px;
  font-size: 0.77rem;
}
.details-edit {
  margin-top: 9px;
}
.details-calendar-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 16px;
  font-size: 0.74rem;
  color: var(--brand);
  text-decoration: none;
}
.details-calendar-link:hover {
  text-decoration: underline;
}
.details-calendar-link .planner-icon {
  width: 17px;
  height: 17px;
}
.details-help {
  color: var(--muted);
  margin: 20px 0 0;
  font-size: 0.68rem;
  line-height: 1.6;
}
.assignment-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 30px 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.assignment-notice {
  color: #337354;
  font-size: 0.79rem;
  margin: 0 0 20px;
}
.assignment-empty {
  padding: 30px 23px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 13px;
}
.assignment-empty > .planner-icon {
  width: 32px;
  height: 32px;
  margin-bottom: 12px;
}
.app .assignment-empty h2 {
  font-size: 1rem;
  margin: 0 0 8px;
}
.assignment-empty p {
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.7;
  margin-bottom: 15px;
}
.assignment-form-card {
  border: 1px solid var(--border);
  border-radius: 15px;
  background: var(--surface);
  padding: 24px;
  margin-bottom: 25px;
}
.app .form-heading h2 {
  margin: 0 0 8px;
  font-size: 1.08rem;
}
.form-heading p,
.assignment-help {
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.7;
  margin: 0 0 20px;
}
.assignment-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 0.8rem;
  font-weight: 600;
}
.field-hint {
  color: var(--muted);
  font-size: 0.69rem;
  font-weight: 400;
}
.form-wide {
  grid-column: 1 / -1;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
button,
input,
select {
  -webkit-tap-highlight-color: transparent;
}
.task-open:focus-visible,
.assignment-tabs button:focus-visible,
.task-checkbox:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 4px;
}
@media (max-width: 1199px) {
  .assignment-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .assignment-details {
    max-width: none;
  }
}
@media (max-width: 575px) {
  .assignment-summary {
    gap: 7px 14px;
    font-size: 0.72rem;
  }
  .coursework-card {
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 9px;
    padding: 16px 13px;
  }
  .task-due {
    grid-column: 2;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .task-due time {
    text-align: left;
  }
  .assignment-filters > label {
    flex: 1 1 100%;
  }
  .assignment-filters :is(input, select),
  .assignment-form :is(input, select) {
    font-size: 1rem;
  }
  .assignment-form {
    grid-template-columns: minmax(0, 1fr);
  }
  .assignment-form-card {
    padding: 20px 16px;
  }
  .form-actions .btn {
    flex: 1;
  }
  .assignment-details {
    padding: 22px 18px;
  }
}
</style>
