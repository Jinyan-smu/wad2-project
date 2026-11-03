<script setup>
  import { computed, onMounted, ref } from 'vue'
  import { RouterLink, useRoute } from 'vue-router'
  import axios from 'axios'
  import LogoutButton from './LogoutButton.vue'

  const API_URL = 'http://localhost:8000/api'
  const route = useRoute()

  const courses = ref([])
  const assignments = ref([])
  const quizzes = ref([])
  const loading = ref(true)
  const saving = ref(false)
  const loadError = ref('')
  const formError = ref('')
  const actionError = ref('')
  const successMessage = ref('')
  const showForm = ref(false)
  const editingAssignment = ref(null)
  const selectedCourseId = ref('all')
  const searchQuery = ref('')
  const statusFilter = ref('all')
  const typeFilter = ref('all')
  const activeView = ref('calendar')
  const collapsedCourseIds = ref([])
  const selectedDateKey = ref('')
  const currentMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const typeFilterOptions = [
    { value: 'all', label: 'All types' },
    { value: 'assignment', label: 'Assignments' },
    { value: 'quiz', label: 'Quizzes' },
  ]
  const statusFilterOptions = [
    { value: 'all', label: 'All' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'completed', label: 'Completed' },
  ]

  const form = ref({
    name: '',
    courseId: '',
    dueDate: '',
  })

  const filteredAssignments = computed(() =>
    assignments.value.filter(
      (item) => selectedCourseId.value === 'all' || String(item.CourseId) === selectedCourseId.value,
    ),
  )

  const filteredQuizzes = computed(() =>
    quizzes.value.filter(
      (item) => selectedCourseId.value === 'all' || String(item.CourseId) === selectedCourseId.value,
    ),
  )

  const calendarEvents = computed(() =>
    [...filteredAssignments.value, ...filteredQuizzes.value]
      .map((item) => ({
        ...item,
        EventDate: item.EventDate || item.DueDate || item.StartDate || null,
        EventDateLabel: item.EventDateLabel || (item.DueDate ? 'Due' : 'No due date'),
        Done: Boolean(item.Done),
      }))
      .filter((item) => typeFilter.value === 'all' || item.Type === typeFilter.value)
      .filter((item) => {
        const query = searchQuery.value.trim().toLowerCase()
        return !query || `${item.Name} ${item.CourseName}`.toLowerCase().includes(query)
      })
      .filter((item) => statusFilter.value === 'all' || eventStatus(item) === statusFilter.value)
      .sort((first, second) => {
        if (!first.EventDate) return 1
        if (!second.EventDate) return -1
        return new Date(first.EventDate) - new Date(second.EventDate)
      }),
  )

  const scheduledEvents = computed(() => calendarEvents.value.filter((item) => item.EventDate))
  const undatedEvents = computed(() => calendarEvents.value.filter((item) => !item.EventDate))
  const groupedEvents = computed(() => {
    const groups = new Map()
    calendarEvents.value.forEach((event) => {
      const id = String(event.CourseId)
      if (!groups.has(id)) groups.set(id, { id, name: event.CourseName, events: [] })
      groups.get(id).events.push(event)
    })
    return [...groups.values()].sort((first, second) => first.name.localeCompare(second.name))
  })
  const monthTitle = computed(() =>
    currentMonth.value.toLocaleDateString('en-SG', {
      month: 'long',
      year: 'numeric',
    }),
  )

  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const calendarDays = computed(() => {
    const year = currentMonth.value.getFullYear()
    const month = currentMonth.value.getMonth()
    const firstDay = new Date(year, month, 1)
    const mondayOffset = (firstDay.getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - mondayOffset)

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      const key = toDateKey(date)

      return {
        date,
        key,
        dayNumber: date.getDate(),
        inCurrentMonth: date.getMonth() === month,
        isToday: key === toDateKey(new Date()),
        isSelected: key === selectedDateKey.value,
        events: scheduledEvents.value.filter((item) => toDateKey(new Date(item.EventDate)) === key),
      }
    })
  })

  const selectedDateEvents = computed(() =>
    calendarEvents.value.filter(
      (item) => item.EventDate && toDateKey(new Date(item.EventDate)) === selectedDateKey.value,
    ),
  )

  const hasActiveFilters = computed(() =>
    Boolean(searchQuery.value || selectedCourseId.value !== 'all' || statusFilter.value !== 'all' || typeFilter.value !== 'all'),
  )

  const monthEventCount = computed(
    () =>
      scheduledEvents.value.filter((item) => {
        const date = new Date(item.EventDate)
        return (
          date.getFullYear() === currentMonth.value.getFullYear() &&
          date.getMonth() === currentMonth.value.getMonth()
        )
      }).length,
  )

  function toDateKey(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!value) return 'No due date'
    return new Date(value).toLocaleDateString('en-SG', options)
  }

  function formatTime(value) {
    if (!value) return ''
    return new Date(value).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
  }

  function eventStatus(item) {
    if (item.Done) return 'completed'
    if (!item.EventDate) return 'undated'

    const eventDate = new Date(item.DueDate || item.EventDate)
    if (item.DueDate && eventDate < new Date()) return 'overdue'
    if (eventDate >= new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) {
      return 'upcoming'
    }
    return 'past'
  }

  function eventStatusLabel(item) {
    const status = eventStatus(item)
    return ({
      completed: 'Completed',
      overdue: 'Overdue',
      upcoming: 'Upcoming',
      undated: 'No date',
      past: 'Past',
    })[status]
  }

  function friendlyEventDate(item) {
    if (!item.EventDate) return 'No due date'

    const value = new Date(item.DueDate || item.EventDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const eventDay = new Date(value)
    eventDay.setHours(0, 0, 0, 0)
    const dayDifference = Math.round((eventDay - today) / 86400000)
    const label = item.DueDate ? 'Due' : 'Available'

    if (item.DueDate && value < new Date()) {
      if (dayDifference === 0) return 'Overdue · earlier today'
      return `Overdue by ${Math.abs(dayDifference)} day${Math.abs(dayDifference) === 1 ? '' : 's'}`
    }
    if (dayDifference === 0) return `${label} today`
    if (dayDifference === 1) return `${label} tomorrow`
    if (dayDifference > 1 && dayDifference <= 7) return `${label} in ${dayDifference} days`
    return `${label} ${formatDate(value, { day: 'numeric', month: 'short' })}`
  }

  function localDateTimeInput(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }

  function clearFilters() {
    searchQuery.value = ''
    selectedCourseId.value = 'all'
    statusFilter.value = 'all'
    typeFilter.value = 'all'
  }

  function toggleCourse(id) {
    const key = String(id)
    collapsedCourseIds.value = collapsedCourseIds.value.includes(key)
      ? collapsedCourseIds.value.filter((courseId) => courseId !== key)
      : [...collapsedCourseIds.value, key]
  }

  function openCourseList() {
    activeView.value = 'list'
    collapsedCourseIds.value = groupedEvents.value.map((group) => group.id)
  }

  function isCourseCollapsed(id) {
    return collapsedCourseIds.value.includes(String(id))
  }

  function changeMonth(amount) {
    currentMonth.value = new Date(
      currentMonth.value.getFullYear(),
      currentMonth.value.getMonth() + amount,
      1,
    )
  }

  function goToToday() {
    const today = new Date()
    currentMonth.value = new Date(today.getFullYear(), today.getMonth(), 1)
    selectedDateKey.value = toDateKey(today)
  }

  function selectDay(day) {
    selectedDateKey.value = day.key
    if (!day.inCurrentMonth) {
      currentMonth.value = new Date(day.date.getFullYear(), day.date.getMonth(), 1)
    }
  }

  function toggleForm() {
    showForm.value = !showForm.value
    formError.value = ''
    successMessage.value = ''
    actionError.value = ''
    if (!showForm.value) {
      editingAssignment.value = null
      form.value.name = ''
      form.value.dueDate = ''
      if (courses.value.length) form.value.courseId = String(courses.value[0].Id)
    } else {
      editingAssignment.value = null
      form.value.name = ''
      form.value.dueDate = ''
    }
  }

  function startEditingAssignment(event) {
    editingAssignment.value = event
    form.value.name = event.Name
    form.value.courseId = String(event.CourseId)
    form.value.dueDate = localDateTimeInput(event.DueDate)
    formError.value = ''
    successMessage.value = ''
    actionError.value = ''
    showForm.value = true
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function loadPlannerData() {
    loading.value = true
    loadError.value = ''

    try {
      const { data } = await axios.get(`${API_URL}/planner-data`, { withCredentials: true })
      courses.value = data.courses || []
      assignments.value = data.assignments || []
      quizzes.value = data.quizzes || []
      if (!form.value.courseId && courses.value.length) {
        form.value.courseId = String(courses.value[0].Id)
      }
    } catch (error) {
      loadError.value =
        error.response?.data?.message || 'Could not load your course work. Please try again.'
    } finally {
      loading.value = false
    }
  }

  async function saveAssignment() {
    formError.value = ''
    successMessage.value = ''

    if (!form.value.name.trim() || !form.value.courseId) {
      formError.value = 'Enter an assignment name and choose a course.'
      return
    }

    let dueDate = null
    if (form.value.dueDate) {
      const parsedDate = new Date(form.value.dueDate)
      if (Number.isNaN(parsedDate.getTime())) {
        formError.value = 'Enter a valid due date.'
        return
      }
      dueDate = parsedDate.toISOString()
    }

    saving.value = true
    try {
      const payload = {
        name: form.value.name.trim(),
        courseId: form.value.courseId,
        dueDate,
      }
      if (editingAssignment.value) {
        await axios.patch(
          `${API_URL}/assignments/${encodeURIComponent(form.value.courseId)}/${encodeURIComponent(editingAssignment.value.Id)}`,
          payload,
          { withCredentials: true },
        )
      } else {
        await axios.post(`${API_URL}/assignments`, payload, { withCredentials: true })
      }

      await loadPlannerData()
      form.value.name = ''
      form.value.dueDate = ''
      showForm.value = false
      successMessage.value = editingAssignment.value
        ? 'Assignment updated.'
        : 'Assignment saved to the project data file.'
      editingAssignment.value = null
    } catch (error) {
      formError.value =
        error.response?.data?.message || 'Could not save the assignment. Please try again.'
    } finally {
      saving.value = false
    }
  }

  async function toggleCompleted(event) {
    actionError.value = ''
    const done = !event.Done
    try {
      await axios.patch(
        `${API_URL}/coursework/${event.Type}/${encodeURIComponent(event.CourseId)}/${encodeURIComponent(event.Id)}`,
        { done },
        { withCredentials: true },
      )
      const items = event.Type === 'quiz' ? quizzes.value : assignments.value
      const item = items.find((candidate) =>
        String(candidate.Id) === String(event.Id) && String(candidate.CourseId) === String(event.CourseId),
      )
      if (item) item.Done = done
      successMessage.value = done ? 'Marked as completed.' : 'Marked as not completed.'
    } catch (error) {
      actionError.value = error.response?.data?.message || 'Could not update this item. Please try again.'
    }
  }

  onMounted(() => {
    if (route.query.new === '1') showForm.value = true
    loadPlannerData()
  })
</script>

<template>
	<div class="app assignments-app">
		<aside class="sidebar assignments-sidebar">
			<h2>🎓 Student Planner</h2>
			<RouterLink to="/dashboard">📊 Dashboard</RouterLink>
			<RouterLink to="/assignments" class="active">📝 Assignments</RouterLink>
			<RouterLink to="/activities">📅 Activities</RouterLink>
			<a>🌤️ Weather</a>
			<RouterLink to="/groupwork">👥 Group Meetings</RouterLink>
			<LogoutButton />
		</aside>

		<main class="main assignments-page">
			<div class="container-xxl assignments-container">
			<header class="header assignments-header">
				<div>
					<p class="eyebrow">STAY ON TOP OF YOUR WORK</p>
					<h1>Assignments</h1>
					<p>See assignment and quiz deadlines across your courses.</p>
				</div>
				<button type="button" class="btn btn-primary" @click="toggleForm">
					{{ showForm ? 'Close form' : '+ Add assignment' }}
				</button>
			</header>

			<div v-if="loadError" class="alert alert-danger" role="alert">{{ loadError }}</div>
			<div v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</div>

			<section v-if="showForm" class="card assignment-form-card">
				<div class="card-body">
					<div class="section-heading form-heading">
						<div>
							<p class="eyebrow">PERSONAL COURSE WORK</p>
							<h2>{{ editingAssignment ? 'Edit assignment' : 'Add an assignment' }}</h2>
						</div>
						<span class="badge rounded-pill text-bg-primary">{{ editingAssignment ? 'Custom assignment' : 'Saved to project JSON' }}</span>
					</div>

					<div v-if="formError" class="alert alert-danger py-2" role="alert">{{ formError }}</div>

					<form class="assignment-form row g-3 align-items-end" @submit.prevent="saveAssignment">
						<div class="form-field assignment-name-field col-12">
							<label for="assignment-name" class="form-label">Assignment name</label>
							<input
								id="assignment-name"
								v-model="form.name"
								class="form-control"
								maxlength="160"
								placeholder="e.g. Project proposal"
								required
							/>
						</div>

						<div class="form-field col-12 col-md-6 col-xl-4">
							<label for="assignment-course" class="form-label">Course</label>
							<select
								id="assignment-course"
								v-model="form.courseId"
								class="form-select"
								:disabled="Boolean(editingAssignment)"
								required
							>
								<option disabled value="">Choose a course</option>
								<option v-for="course in courses" :key="course.Id" :value="String(course.Id)">
									{{ course.Name }}
								</option>
							</select>
						</div>

						<div class="form-field col-12 col-md-6 col-xl-4">
							<label for="assignment-due-date" class="form-label">Due date <span>(optional)</span></label>
							<input
								id="assignment-due-date"
								v-model="form.dueDate"
								class="form-control"
								type="datetime-local"
							/>
						</div>

						<div class="form-actions col-12 d-flex justify-content-end gap-2">
							<button type="button" class="btn btn-outline-secondary" @click="toggleForm">Cancel</button>
							<button type="submit" class="btn btn-primary" :disabled="saving">
								{{ saving ? 'Saving…' : editingAssignment ? 'Update assignment' : 'Save assignment' }}
							</button>
						</div>
					</form>
				</div>
			</section>

			<section class="row g-3 mb-4" aria-label="Course work summary">
				<div class="col-12 col-sm-6 col-xl-4">
					<div class="overview-card h-100">
						<span class="overview-icon assignment-icon">📝</span>
						<div>
							<strong>{{ filteredAssignments.length }}</strong
							><span>Assignments</span>
						</div>
					</div>
				</div>
				<div class="col-12 col-sm-6 col-xl-4">
					<div class="overview-card h-100">
						<span class="overview-icon quiz-icon">✏️</span>
						<div>
							<strong>{{ filteredQuizzes.length }}</strong
							><span>Quizzes</span>
						</div>
					</div>
				</div>
				<div class="col-12 col-sm-6 col-xl-4">
					<div class="overview-card h-100">
						<span class="overview-icon calendar-icon">📅</span>
						<div>
							<strong>{{ monthEventCount }}</strong
							><span>Events this month</span>
						</div>
					</div>
				</div>
			</section>

			<section class="card planner-card">
				<div class="card-body">
					<div class="planner-toolbar">
						<h2 class="calendar-view-title">Assignments and quizzes</h2>
						<div class="planner-toolbar-controls">
							<label class="course-filter">
								<span>Course</span>
								<select v-model="selectedCourseId" class="form-select form-select-sm">
									<option value="all">All courses</option>
									<option v-for="course in courses" :key="course.Id" :value="String(course.Id)">
										{{ course.Name }}
									</option>
								</select>
							</label>
							<label class="search-filter">
								<span class="visually-hidden">Search coursework</span>
								<input v-model="searchQuery" class="form-control form-control-sm" type="search" placeholder="Search assignments or courses" />
							</label>
						</div>
					</div>

					<div v-if="loading" class="loading-state" role="status">
						<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
						Loading courses and deadlines…
					</div>

					<template v-else>
						<div class="assignment-view-filters">
							<div class="view-switch" role="group" aria-label="Choose coursework view">
								<button type="button" :class="{ active: activeView === 'calendar' }" :aria-pressed="activeView === 'calendar'" @click="activeView = 'calendar'">Calendar</button>
								<button type="button" :class="{ active: activeView === 'list' }" :aria-pressed="activeView === 'list'" @click="openCourseList">Course list</button>
							</div>
							<div class="filter-group" role="group" aria-label="Filter by item type">
								<button v-for="option in typeFilterOptions" :key="option.value" type="button" :class="{ active: typeFilter === option.value }" @click="typeFilter = option.value">{{ option.label }}</button>
							</div>
							<div class="filter-group" role="group" aria-label="Filter by status">
								<button v-for="option in statusFilterOptions" :key="option.value" type="button" :class="{ active: statusFilter === option.value }" @click="statusFilter = option.value">{{ option.label }}</button>
							</div>
							<button v-if="hasActiveFilters" type="button" class="btn btn-sm btn-link clear-filters" @click="clearFilters">Clear filters</button>
						</div>
						<div v-if="actionError" class="alert alert-danger py-2" role="alert">{{ actionError }}</div>
						<div v-if="activeView === 'calendar'">
						<div class="calendar-toolbar">
							<div class="calendar-month-title">
								<h2>{{ monthTitle }}</h2>
								<span>{{ monthEventCount }} scheduled items</span>
							</div>
							<div class="calendar-controls btn-group" role="group" aria-label="Calendar navigation">
								<button
									type="button"
									class="btn btn-outline-secondary"
									aria-label="Previous month"
									@click="changeMonth(-1)"
								>
									‹
								</button>
								<button type="button" class="btn btn-outline-secondary" @click="goToToday">Today</button>
								<button
									type="button"
									class="btn btn-outline-secondary"
									aria-label="Next month"
									@click="changeMonth(1)"
								>
									›
								</button>
							</div>
						</div>

						<div class="calendar-scroll">
							<div class="calendar-weekdays" aria-hidden="true">
								<span v-for="weekday in weekdayNames" :key="weekday">{{ weekday }}</span>
							</div>
							<div class="calendar-grid">
								<button
									v-for="day in calendarDays"
									:key="day.key"
									type="button"
									class="calendar-day"
									:class="{
										'outside-month': !day.inCurrentMonth,
										today: day.isToday,
										selected: day.isSelected,
									}"
									:aria-label="`${formatDate(day.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${day.events.length} items`"
									@click="selectDay(day)"
								>
									<span class="day-number">{{ day.dayNumber }}</span>
									<span class="day-event-list">
										<span
											v-for="event in day.events.slice(0, 3)"
											:key="`${event.Type}-${event.CourseId}-${event.Id}`"
											class="calendar-event"
											:class="[event.Type, eventStatus(event)]"
										>
											<span class="event-dot" aria-hidden="true"></span>
											<span class="event-name">{{ event.Name }}</span>
										</span>
										<span v-if="day.events.length > 3" class="more-events"
											>+{{ day.events.length - 3 }} more</span
										>
									</span>
								</button>
							</div>
						</div>

						<div class="calendar-legend">
							<span><i class="legend-dot assignment-dot"></i>Assignment</span>
							<span><i class="legend-dot quiz-dot"></i>Quiz</span>
							<span><i class="legend-dot overdue-dot"></i>Overdue</span>
							<span><i class="legend-dot completed-dot"></i>Completed</span>
						</div>
						<div v-if="!calendarEvents.length" class="empty-state compact-empty">
							<span>🔎</span>
							<h2>{{ hasActiveFilters ? 'No matching coursework' : 'No assignments or quizzes yet' }}</h2>
							<p>{{ hasActiveFilters ? 'Try changing your search or filters.' : 'Add a personal assignment to start planning your deadlines.' }}</p>
							<button v-if="hasActiveFilters" type="button" class="btn btn-sm btn-outline-primary" @click="clearFilters">Clear filters</button>
							<button v-else type="button" class="btn btn-sm btn-primary" @click="toggleForm">Add assignment</button>
						</div>

						<section v-if="selectedDateKey" class="selected-date-panel">
							<h3>
								{{ formatDate(selectedDateKey, { weekday: 'long', day: 'numeric', month: 'long' }) }}
							</h3>
							<p v-if="!selectedDateEvents.length" class="text-secondary mb-0">
								Nothing scheduled for this day.
							</p>
							<div
								v-for="event in selectedDateEvents"
								:key="`${event.Type}-${event.CourseId}-${event.Id}`"
								class="event-detail"
							>
								<span class="event-type-icon" :class="event.Type">{{
									event.Type === 'quiz' ? '✏️' : '📝'
								}}</span>
								<div>
									<strong>{{ event.Name }}</strong>
									<span
										>{{ event.CourseName }}<template v-if="formatTime(event.EventDate)"> · {{ formatTime(event.EventDate) }}</template></span
									>
									<span class="event-date-label" :class="eventStatus(event)">{{ friendlyEventDate(event) }}</span>
									<span class="coursework-status" :class="eventStatus(event)">{{ eventStatusLabel(event) }}</span>
								</div>
								<span
									class="badge rounded-pill"
									:class="event.Type === 'quiz' ? 'text-bg-info' : 'text-bg-primary'"
								>
									{{ event.Type === 'quiz' ? 'Quiz' : 'Assignment' }}
								</span>
								<label class="completion-action">
									<input type="checkbox" :checked="event.Done" :aria-label="`Mark ${event.Name} completed`" @change="toggleCompleted(event)" />
									Completed
								</label>
								<button v-if="event.Type === 'assignment' && event.IsCustom" type="button" class="btn btn-sm btn-outline-secondary" @click="startEditingAssignment(event)">Edit</button>
							</div>
						</section>

						<section v-if="undatedEvents.length" class="undated-section">
							<div class="section-heading">
								<div>
									<h3>Unscheduled</h3>
									<p>These items don’t have a date in the source data.</p>
								</div>
								<span class="badge rounded-pill text-bg-secondary">{{ undatedEvents.length }}</span>
							</div>
							<div class="undated-list">
								<div
									v-for="event in undatedEvents"
									:key="`${event.Type}-${event.CourseId}-${event.Id}`"
									class="undated-item"
								>
									<span class="event-type-icon" :class="event.Type">{{
										event.Type === 'quiz' ? '✏️' : '📝'
									}}</span>
									<div>
										<strong>{{ event.Name }}</strong
										><span>{{ event.CourseName }}</span>
									</div>
									<span
										class="badge rounded-pill"
										:class="event.Type === 'quiz' ? 'text-bg-info' : 'text-bg-primary'"
									>
										{{ event.Type === 'quiz' ? 'Quiz' : 'Assignment' }}
									</span>
								</div>
							</div>
						</section>
						</div>

						<section v-else class="course-group-list">
							<div v-if="!calendarEvents.length" class="empty-state">
								<span>🔎</span>
								<h2>{{ hasActiveFilters ? 'No matching coursework' : 'No assignments or quizzes yet' }}</h2>
								<p>{{ hasActiveFilters ? 'Try changing your search or filters.' : 'Add a personal assignment to start planning your deadlines.' }}</p>
								<button v-if="hasActiveFilters" type="button" class="btn btn-sm btn-outline-primary" @click="clearFilters">Clear filters</button>
								<button v-else type="button" class="btn btn-sm btn-primary" @click="toggleForm">Add assignment</button>
							</div>
							<article v-for="group in groupedEvents" :key="group.id" class="course-group">
								<button type="button" class="course-group-heading" :aria-expanded="!isCourseCollapsed(group.id)" @click="toggleCourse(group.id)">
									<span><strong>{{ group.name }}</strong><small>{{ group.events.length }} item{{ group.events.length === 1 ? '' : 's' }}</small></span>
									<span class="group-chevron" aria-hidden="true">{{ isCourseCollapsed(group.id) ? '＋' : '−' }}</span>
								</button>
								<div v-if="!isCourseCollapsed(group.id)" class="course-group-items">
									<article v-for="event in group.events" :key="`${event.Type}-${event.CourseId}-${event.Id}`" class="coursework-card" :class="eventStatus(event)">
										<span class="event-type-icon" :class="event.Type">{{ event.Type === 'quiz' ? '✏️' : '📝' }}</span>
										<div class="coursework-card-main">
											<strong>{{ event.Name }}</strong>
											<span>{{ event.CourseName }}<template v-if="formatTime(event.EventDate)"> · {{ formatTime(event.EventDate) }}</template></span>
											<span class="event-date-label" :class="eventStatus(event)">{{ friendlyEventDate(event) }}</span>
											<span class="coursework-status" :class="eventStatus(event)">{{ eventStatusLabel(event) }}</span>
										</div>
										<label class="completion-action"><input type="checkbox" :checked="event.Done" :aria-label="`Mark ${event.Name} completed`" @change="toggleCompleted(event)" /> Completed</label>
										<button v-if="event.Type === 'assignment' && event.IsCustom" type="button" class="btn btn-sm btn-outline-secondary" @click="startEditingAssignment(event)">Edit</button>
									</article>
								</div>
							</article>
						</section>
					</template>
				</div>
			</section>
			</div>
		</main>
	</div>
</template>

<style scoped>
.assignments-app {
	background: var(--bg);
}

.assignments-page {
	max-width: 1600px;
	margin: 0 auto;
	width: 100%;
}
.assignments-header {
	margin-bottom: 1.5rem;
}
.assignments-header h1 {
	font-size: clamp(1.8rem, 3vw, 2.45rem);
	font-weight: 750;
	letter-spacing: -0.04em;
}
.assignments-header > div > p:last-child {
	margin-top: 0.35rem;
}
.eyebrow {
	margin: 0 0 0.4rem;
	color: var(--brand);
	font-size: 0.7rem;
	font-weight: 800;
	letter-spacing: 0.12em;
}
.assignment-form-card,
.planner-card {
	border: 0;
	box-shadow: 0 0.6rem 2rem rgba(33, 42, 92, 0.07);
}
.form-heading {
	margin-bottom: 1.25rem;
}
.form-heading h2 {
	margin: 0;
	font-size: 1.2rem;
	font-weight: 700;
}
.form-field {
	min-width: 0;
}
.form-field .form-label {
	font-size: 0.85rem;
	font-weight: 650;
	color: #414761;
}
.form-label span {
	color: #8a90a4;
	font-weight: 400;
}
.form-actions {
	padding-top: 0.25rem;
}
.planner-card > .card-body {
	padding: 1.15rem 1.25rem 1.35rem;
}
.planner-toolbar,
.calendar-toolbar,
.section-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}
.planner-toolbar {
	flex-wrap: wrap;
	padding-bottom: 1rem;
	border-bottom: 1px solid #edf0f6;
}
.planner-toolbar-controls {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 0.75rem;
}
.calendar-view-title {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
}
.course-filter {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	color: #777f97;
	font-size: 0.8rem;
	font-weight: 650;
}
.course-filter select {
	min-width: 190px;
	max-width: min(42vw, 360px);
}
.search-filter input {
	min-width: min(280px, 40vw);
}
.assignment-view-filters {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.65rem;
	padding: 1rem 0 0.25rem;
}
.view-switch,
.filter-group {
	display: inline-flex;
	align-items: center;
	gap: 0.2rem;
	padding: 0.2rem;
	border: 1px solid #e8eaf3;
	border-radius: 0.75rem;
	background: #f8f9fc;
}
.view-switch button,
.filter-group button {
	padding: 0.38rem 0.7rem;
	border: 0;
	border-radius: 0.55rem;
	background: transparent;
	color: #687087;
	font-size: 0.76rem;
	font-weight: 650;
	white-space: nowrap;
}
.view-switch button.active,
.filter-group button.active {
	background: #fff;
	box-shadow: 0 1px 4px rgba(33, 42, 92, 0.12);
	color: var(--brand);
}
.clear-filters {
	text-decoration: none;
}
.loading-state {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.75rem;
	min-height: 240px;
	color: #727a91;
}
.calendar-toolbar {
	padding: 1.25rem 0 1rem;
}
.calendar-month-title h2 {
	margin: 0;
	font-size: 1.25rem;
	font-weight: 750;
}
.calendar-month-title span {
	color: #80879b;
	font-size: 0.8rem;
}
.calendar-scroll {
	overflow-x: auto;
}
.calendar-weekdays,
.calendar-grid {
	display: grid;
	grid-template-columns: repeat(7, minmax(0, 1fr));
	min-width: 700px;
}
.calendar-weekdays {
	border: 1px solid #e9ecf4;
	border-bottom: 0;
	border-radius: 0.8rem 0.8rem 0 0;
	background: #f8f9fc;
}
.calendar-weekdays span {
	padding: 0.7rem 0.8rem;
	color: #7d8498;
	font-size: 0.72rem;
	font-weight: 750;
	letter-spacing: 0.04em;
	text-align: left;
	text-transform: uppercase;
}
.calendar-grid {
	overflow: hidden;
	border: 1px solid #e9ecf4;
	border-radius: 0 0 0.8rem 0.8rem;
}
.calendar-day {
	display: block;
	min-width: 0;
	min-height: 118px;
	padding: 0.55rem;
	border: 0;
	border-top: 1px solid #e9ecf4;
	border-right: 1px solid #e9ecf4;
	background: #fff;
	color: #202541;
	text-align: left;
	transition: background-color 0.15s ease;
}
.calendar-day:nth-child(7n) {
	border-right: 0;
}
.calendar-day:hover,
.calendar-day.selected {
	background: #f5f5ff;
}
.calendar-day.outside-month {
	background: #fafbfe;
	color: #a6abbb;
}
.calendar-day.today .day-number {
	color: #fff;
	background: var(--brand);
}
.calendar-day.selected {
	box-shadow: inset 0 0 0 2px var(--brand);
}
.day-number {
	display: grid;
	width: 1.75rem;
	height: 1.75rem;
	place-items: center;
	border-radius: 50%;
	font-size: 0.8rem;
	font-weight: 700;
}
.day-event-list {
	display: grid;
	gap: 0.25rem;
	margin-top: 0.25rem;
}
.calendar-event {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	min-width: 0;
	padding: 0.2rem 0.35rem;
	border-radius: 0.35rem;
	font-size: 0.68rem;
	line-height: 1.2;
}
.calendar-event.assignment {
	background: #eeeefe;
	color: #4242bc;
}
.calendar-event.quiz {
	background: #e9f5ff;
	color: #21659a;
}
.calendar-event.overdue {
	background: #fff0f0;
	color: #a43f49;
}
.calendar-event.completed {
	background: #edf7ef;
	color: #3c7651;
}
.calendar-event.completed .event-name {
	text-decoration: line-through;
}
.event-dot,
.legend-dot {
	width: 0.42rem;
	height: 0.42rem;
	flex: 0 0 auto;
	border-radius: 50%;
	background: currentColor;
}
.event-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.more-events {
	padding-left: 0.35rem;
	color: #7c8297;
	font-size: 0.65rem;
}
.calendar-legend {
	display: flex;
	gap: 1rem;
	padding: 0.85rem 0.15rem 0;
	color: #737b91;
	font-size: 0.75rem;
}
.calendar-legend span {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
}
.assignment-dot {
	background: #5b5bf0;
}
.quiz-dot {
	background: #45a1dc;
}
.selected-date-panel,
.undated-section {
	margin-top: 1.35rem;
	padding-top: 1.1rem;
	border-top: 1px solid #edf0f6;
}
.event-date-label {
	width: fit-content;
	color: #52716a !important;
	font-weight: 650;
}
.event-date-label.overdue {
	color: #a43f49 !important;
}
.event-date-label.completed {
	color: #3c7651 !important;
}
.event-date-label.past,
.event-date-label.undated {
	color: #858ba0 !important;
}
.coursework-status {
	display: inline-flex;
	width: fit-content;
	align-items: center;
	padding: 0.14rem 0.48rem;
	border-radius: 99px;
	background: #eef0ff;
	color: #4848a5;
	font-size: 0.66rem;
	font-weight: 750;
}
.coursework-status.overdue {
	background: #fff0f0;
	color: #a43f49;
}
.coursework-status.completed {
	background: #eaf6ed;
	color: #3c7651;
}
.coursework-status.past,
.coursework-status.undated {
	background: #f0f1f5;
	color: #6f7588;
}
.completion-action {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	color: #687087;
	font-size: 0.75rem;
	white-space: nowrap;
}
.completion-action input {
	width: 1rem;
	height: 1rem;
	accent-color: var(--brand);
}
.course-group-list {
	display: grid;
	gap: 0.85rem;
	padding-top: 1rem;
}
.course-group {
	overflow: hidden;
	border: 1px solid #e8eaf2;
	border-radius: 0.85rem;
	background: #fff;
}
.course-group-heading {
	display: flex;
	width: 100%;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.9rem 1rem;
	border: 0;
	background: #f8f9fc;
	color: #292e45;
	text-align: left;
}
.course-group-heading > span:first-child {
	display: grid;
	gap: 0.18rem;
	min-width: 0;
}
.course-group-heading strong {
	overflow: hidden;
	font-size: 0.9rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.course-group-heading small {
	color: #81879a;
	font-size: 0.72rem;
}
.group-chevron {
	color: var(--brand);
	font-size: 1.2rem;
}
.course-group-items {
	padding: 0 0.85rem;
}
.coursework-card {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.75rem;
	padding: 0.85rem 0.2rem;
	border-bottom: 1px solid #eff1f6;
}
.coursework-card:last-child {
	border-bottom: 0;
}
.coursework-card.overdue {
	border-left: 3px solid #cf6670;
	padding-left: 0.65rem;
}
.coursework-card.completed .coursework-card-main > strong {
	color: #737b91;
	text-decoration: line-through;
}
.coursework-card-main {
	display: grid;
	flex: 1 1 220px;
	gap: 0.2rem;
	min-width: 0;
}
.coursework-card-main > strong {
	overflow-wrap: anywhere;
	font-size: 0.88rem;
}
.coursework-card-main > span {
	color: #7c8296;
	font-size: 0.76rem;
}
.coursework-card-main > .event-date-label {
	font-weight: 650;
}
.compact-empty {
	padding: 1.5rem 1rem;
}
.overdue-dot {
	background: #c85b65;
}
.completed-dot {
	background: #4d9364;
}
.selected-date-panel h3,
.undated-section h3 {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 750;
}
.event-detail,
.undated-item {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	padding: 0.75rem 0;
	border-bottom: 1px solid #eff1f6;
}
.event-detail > div,
.undated-item > div {
	display: grid;
	flex: 1;
	gap: 0.15rem;
	min-width: 0;
}
.event-detail > div span,
.undated-item > div span {
	color: #7c8296;
	font-size: 0.77rem;
}
.event-type-icon {
	display: grid;
	width: 2.25rem;
	height: 2.25rem;
	flex: 0 0 auto;
	place-items: center;
	border-radius: 0.7rem;
	background: #f0f0ff;
}
.event-type-icon.quiz {
	background: #e9f5ff;
}
.undated-section .section-heading > div > p {
	margin: 0.25rem 0 0;
	color: #7c8296;
	font-size: 0.78rem;
}
.event-detail strong,
.undated-item strong {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.undated-label {
	flex: 0 0 auto;
	color: #858ba0;
	font-size: 0.72rem;
}
.empty-state {
	display: grid;
	justify-items: center;
	padding: 4rem 1rem;
	text-align: center;
}
.empty-state > span {
	font-size: 2rem;
}
.empty-state h2 {
	margin: 0.75rem 0 0.25rem;
	font-size: 1.1rem;
}
.empty-state p {
	margin: 0;
	color: #7c8296;
	font-size: 0.88rem;
}

@media (max-width: 700px) {
	.assignments-page {
		padding: 1.2rem;
	}
	.assignments-header {
		align-items: flex-start;
	}
	.overview-card {
		padding: 0.75rem 0.9rem;
	}
	.course-filter {
		align-items: flex-start;
		flex-direction: column;
		width: 100%;
	}
	.course-filter select {
		max-width: none;
		width: 100%;
	}
	.calendar-toolbar {
		align-items: flex-start;
		flex-direction: column;
	}
	.planner-toolbar {
		align-items: stretch;
	}
	.planner-toolbar-controls {
		align-items: stretch;
		flex-direction: column;
		width: 100%;
	}
	.search-filter,
	.search-filter input {
		width: 100%;
		min-width: 0;
	}
	.assignment-view-filters {
		align-items: flex-start;
	}
	.view-switch,
	.filter-group {
		max-width: 100%;
		overflow-x: auto;
	}
	.coursework-card {
		align-items: flex-start;
	}
	.coursework-card-main {
		flex-basis: calc(100% - 3.5rem);
	}
	.event-detail {
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.event-detail > div {
		flex-basis: calc(100% - 3.25rem);
	}
	.form-actions .btn {
		flex: 1;
	}
}
</style>
