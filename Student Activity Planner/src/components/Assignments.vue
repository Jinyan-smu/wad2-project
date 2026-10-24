<script setup>
  import { computed, onMounted, ref } from 'vue'
  import { RouterLink, useRoute } from 'vue-router'
  import axios from 'axios'

  const API_URL = 'http://localhost:8000/api'
  const route = useRoute()

  const courses = ref([])
  const assignments = ref([])
  const quizzes = ref([])
  const loading = ref(true)
  const saving = ref(false)
  const loadError = ref('')
  const formError = ref('')
  const successMessage = ref('')
  const showForm = ref(false)
  const selectedCourseId = ref('all')
  const selectedDateKey = ref('')
  const currentMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

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
      }))
      .sort((first, second) => {
        if (!first.EventDate) return 1
        if (!second.EventDate) return -1
        return new Date(first.EventDate) - new Date(second.EventDate)
      }),
  )

  const scheduledEvents = computed(() => calendarEvents.value.filter((item) => item.EventDate))
  const undatedEvents = computed(() => calendarEvents.value.filter((item) => !item.EventDate))
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

  async function addAssignment() {
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
      await axios.post(
        `${API_URL}/assignments`,
        {
          name: form.value.name.trim(),
          courseId: form.value.courseId,
          dueDate,
        },
        { withCredentials: true },
      )

      await loadPlannerData()
      form.value.name = ''
      form.value.dueDate = ''
      showForm.value = false
      successMessage.value = 'Assignment saved to the project data file.'
    } catch (error) {
      formError.value =
        error.response?.data?.message || 'Could not save the assignment. Please try again.'
    } finally {
      saving.value = false
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
			<a class="disabled-link" aria-disabled="true">📅 Activities</a>
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
							<h2>Add an assignment</h2>
						</div>
						<span class="badge rounded-pill text-bg-primary">Saved locally</span>
					</div>

					<div v-if="formError" class="alert alert-danger py-2" role="alert">{{ formError }}</div>

					<form class="assignment-form row g-3 align-items-end" @submit.prevent="addAssignment">
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
								{{ saving ? 'Saving…' : 'Save assignment' }}
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

						<label class="course-filter">
							<span>Course</span>
							<select v-model="selectedCourseId" class="form-select form-select-sm">
								<option value="all">All courses</option>
								<option v-for="course in courses" :key="course.Id" :value="String(course.Id)">
									{{ course.Name }}
								</option>
							</select>
						</label>
					</div>

					<div v-if="loading" class="loading-state" role="status">
						<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
						Loading courses and deadlines…
					</div>

					<template v-else>
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
											:class="event.Type"
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
										>{{ event.CourseName }} · {{ event.EventDateLabel }}
										{{ formatTime(event.EventDate) }}</span
									>
								</div>
								<span
									class="badge rounded-pill"
									:class="event.Type === 'quiz' ? 'text-bg-info' : 'text-bg-primary'"
								>
									{{ event.Type === 'quiz' ? 'Quiz' : 'Assignment' }}
								</span>
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
.assignments-sidebar a {
	color: rgba(255, 255, 255, 0.9);
	text-decoration: none;
}
.assignments-sidebar .disabled-link {
	cursor: default;
	opacity: 0.6;
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
.overview-card {
	display: flex;
	align-items: center;
	gap: 0.85rem;
	padding: 1rem 1.15rem;
	border: 1px solid #e9ebf4;
	border-radius: 1rem;
	background: #fff;
	box-shadow: 0 0.3rem 1rem rgba(33, 42, 92, 0.04);
}
.overview-icon {
	display: grid;
	width: 2.7rem;
	height: 2.7rem;
	flex: 0 0 auto;
	place-items: center;
	border-radius: 0.85rem;
	font-size: 1.2rem;
}
.assignment-icon {
	background: #ececff;
}
.quiz-icon {
	background: #e8f4ff;
}
.calendar-icon {
	background: #e5f8f0;
}
.overview-card strong,
.overview-card span:last-child {
	display: block;
}
.overview-card strong {
	font-size: 1.25rem;
	line-height: 1.15;
}
.overview-card div span {
	color: #777f97;
	font-size: 0.8rem;
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
	.form-actions .btn {
		flex: 1;
	}
}
</style>
