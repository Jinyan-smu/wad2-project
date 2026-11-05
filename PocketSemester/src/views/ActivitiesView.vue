<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import PlannerNavigation from '@/components/PlannerNavigation.vue'
import PlannerCompanion from '@/components/PlannerCompanion.vue'
import GoogleActivityMap from '@/components/GoogleActivityMap.vue'
import TaskUrgencyBadge from '@/components/TaskUrgencyBadge.vue'
import { useActivityEndClock } from '@/composables/useActivityEndClock'
import { hasActivityEnded, isActivityComplete } from '@/utils/activityCompletion'
import { getTaskUrgency } from '@/utils/taskUrgency'

const route = useRoute()

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search'
const API_URL = 'http://localhost:8000/api'


const presetPlaces = [
	{ name: 'NUS', lat: 1.2966, lng: 103.7764 },
	{ name: 'NTU', lat: 1.3483, lng: 103.6831 },
	{ name: 'SMU', lat: 1.2963, lng: 103.8502 },
	{ name: 'SUTD', lat: 1.3413, lng: 103.9638 },
	{ name: 'East Coast Park', lat: 1.301, lng: 103.912 },
	{ name: 'Singapore Botanic Gardens', lat: 1.3138, lng: 103.8159 },
	{ name: 'Marina Barrage', lat: 1.2806, lng: 103.8708 },
	{ name: 'Jurong Lake Gardens', lat: 1.3394, lng: 103.727 },
	{ name: 'Bishan-Ang Mo Kio Park', lat: 1.3626, lng: 103.8456 },
	{ name: 'Sentosa', lat: 1.2494, lng: 103.8303 },
	{ name: 'Orchard Road', lat: 1.3048, lng: 103.8318 },
	{ name: 'Changi Beach Park', lat: 1.3917, lng: 103.993 },
]


const activities = ref([])
const activityClock = useActivityEndClock(computed(() => activities.value.map((item) => item.end)))
const forecasts = ref({})
const weatherAlertsOpen = ref(false)
const loading = ref(true)
const loadError = ref('')
const formError = ref('')
const successMessage = ref('')
const showForm = ref(false)
const editingId = ref(null)
const saving = ref(false)
let disposed = false
onBeforeUnmount(() => { disposed = true })
const confirmDeleteId = ref(null)
const viewMode = ref('map')
const timeFilter = ref('upcoming')
watch(timeFilter, () => { activityClock.value = new Date() })
const activityListQuery = ref('')
const selectedId = ref(null)

const emptyForm = () => ({
	title: '',
	when: '',
	end: '',
	outdoor: 'true',
	notes: '',
	place: '',
	lat: null,
	lng: null,
})
const form = ref(emptyForm())

const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)
const searchMessage = ref('')

const googleMapRef = ref(null)


async function fetchActivities() {
	try {
		const response = await axios.get(`${API_URL}/activities`, { withCredentials: true })
		const data = response.data
		return Array.isArray(data) ? data : []
	} catch (error) {
		throw new Error(error || 'Could not load activities.', { cause: error })
	}
}

async function createActivity(payload) {
	try {
		const response = await axios.post(`${API_URL}/activities`, payload, {
			withCredentials: true,
		})
		const data = response.data
		return data
	} catch (error) {
		throw new Error(error || 'Could not save the activity.', { cause: error })
	}
}

async function updateActivity(id, changes) {
	try {
		const response = await axios.post(`${API_URL}/activities/${encodeURIComponent(id)}`, changes, {
			withCredentials: true,
		})
		const data = response.data
		return data
	} catch (error) {
		throw new Error(error || 'Could not update the activity.', { cause: error })
	}

	
	
}

async function deleteActivityRecord(id) {
	try {
		const response = await axios.delete(`${API_URL}/activities/${encodeURIComponent(id)}`, {
			withCredentials: true
		})
		const data = response.data
		return data
	} catch (error) {
		throw new Error(error || 'Could not delete the activity.', { cause: error })
	}
	
}

/* ---------- Date helpers ---------- */

const pad = (value) => String(value).padStart(2, '0')

function toDateKey(date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toLocalInput(value) {
	const date = new Date(value)
	return `${toDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(value, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
	if (!value) return 'No date'
	return new Date(value).toLocaleDateString('en-SG', options)
}

function formatTime(value) {
	if (!value) return ''
	return new Date(value).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
}

function formatWhen(activity) {
	const sameDay = toDateKey(new Date(activity.when)) === toDateKey(new Date(activity.end))
	const end = sameDay
		? formatTime(activity.end)
		: `${formatDate(activity.end)} ${formatTime(activity.end)}`
	return `${formatDate(activity.when)}, ${formatTime(activity.when)} to ${end}`
}


function describeCode(code) {
	if (code === 0) return { icon: '☀️', label: 'Clear' }
	if (code <= 2) return { icon: '🌤️', label: 'Partly cloudy' }
	if (code === 3) return { icon: '☁️', label: 'Overcast' }
	if (code <= 48) return { icon: '🌫️', label: 'Foggy' }
	if (code <= 57) return { icon: '🌦️', label: 'Drizzle' }
	if (code <= 67) return { icon: '🌧️', label: 'Rain' }
	if (code <= 77) return { icon: '❄️', label: 'Snow' }
	if (code <= 82) return { icon: '🌧️', label: 'Showers' }
	return { icon: '⛈️', label: 'Thunderstorm' }
}

const forecastKey = (lat, lng) => `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`

async function loadForecast(lat, lng) {
	const key = forecastKey(lat, lng)
	if (forecasts.value[key]) return
	forecasts.value[key] = { status: 'loading', days: {} }

	try {
		const url =
			`${WEATHER_URL}?latitude=${lat}&longitude=${lng}` +
			'&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=auto&forecast_days=16'
		const { data } = await axios.get(url)
		const { daily } = data

		const days = {}
		daily.time.forEach((day, index) => {
			days[day] = {
				code: daily.weather_code[index],
				temp: daily.temperature_2m_max[index],
				rain: daily.precipitation_probability_max[index] ?? 0,
			}
		})
		forecasts.value[key] = { status: 'ready', days }
	} catch {
		forecasts.value[key] = { status: 'error', days: {} }
	}
}

function loadAllForecasts() {
	activities.value.forEach((activity) => {
		if (activity.outdoor && hasLocation(activity)) loadForecast(activity.lat, activity.lng)
	})
}

// Same thresholds as the Dashboard's Smart Weather Check.
function rateDay(day) {
	if (day.rain >= 60 || day.code >= 95) return 'bad'
	if (day.rain >= 40) return 'maybe'
	return 'good'
}

const VERDICTS = { good: 'Good to go', maybe: 'Bring backup', bad: 'Move indoors' }

function weatherFor(activity, now) {
	const na = (verdict, detail = '') => ({ state: 'na', icon: '', verdict, detail })

	if (!activity.outdoor) return na('Indoor')
	if (hasActivityEnded(activity, now)) return na('Past')
	if (!hasLocation(activity)) return na('No location', 'Add a location to see the weather.')

	const forecast = forecasts.value[forecastKey(activity.lat, activity.lng)]
	if (!forecast || forecast.status === 'loading') return na('Checking…')
	if (forecast.status === 'error') return na('No data', 'Could not load the forecast.')

	const day = forecast.days[toDateKey(new Date(activity.when))]
	if (!day) return na('No data', 'Forecasts cover the next 16 days.')

	const { icon, label } = describeCode(day.code)
	const state = rateDay(day)
	return {
		state,
		icon,
		verdict: VERDICTS[state],
		detail: `${label}, ${Math.round(day.temp)}°C, ${day.rain}% chance of rain`,
	}
}

function betterDayFor(activity) {
	const forecast = forecasts.value[forecastKey(activity.lat, activity.lng)]
	if (!forecast?.days) return null
	const activityKey = toDateKey(new Date(activity.when))
	const match = Object.entries(forecast.days).find(
		([key, day]) => key > activityKey && rateDay(day) === 'good',
	)
	if (!match) return null
	return { label: formatDate(`${match[0]}T12:00:00`), rain: match[1].rain }
}



function hasLocation(activity) {
	return (
		typeof activity.lat === 'number' &&
		typeof activity.lng === 'number' &&
		!Number.isNaN(activity.lat) &&
		!Number.isNaN(activity.lng)
	)
}

const visibleActivities = computed(() => {
	const now = activityClock.value
	const periodStart = new Date(now)
	periodStart.setHours(0, 0, 0, 0)
	if (timeFilter.value === 'week') {
		periodStart.setDate(periodStart.getDate() - (periodStart.getDay() + 6) % 7)
	}
	const periodEnd = new Date(periodStart)
	periodEnd.setDate(periodEnd.getDate() + (timeFilter.value === 'week' ? 7 : 1))

	return activities.value
		.filter((item) => {
			if (timeFilter.value === 'all') return true
			const end = new Date(item.end)
			if (timeFilter.value === 'today' || timeFilter.value === 'week') {
				return new Date(item.when) < periodEnd && end > periodStart
			}
			const isPast = hasActivityEnded(item, now)
			return timeFilter.value === 'past' ? isPast : !isPast
		})
		.sort((first, second) =>
			timeFilter.value === 'past'
				? new Date(second.when) - new Date(first.when)
				: new Date(first.when) - new Date(second.when),
		)
		.map((item) => {
			const done = isActivityComplete(item, now)
			return {
				...item,
				done,
				weather: weatherFor(item, now),
				urgency: getTaskUrgency(item.when, { done, now, prefix: 'Starts', end: item.end }),
			}
		})
})

const mappableActivities = computed(() => visibleActivities.value.filter(hasLocation))
const unmappedCount = computed(() => visibleActivities.value.length - mappableActivities.value.length)
const searchedActivities = computed(() => {
	const terms = activityListQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) return visibleActivities.value
	return visibleActivities.value.filter((activity) => {
		const text = [activity.title, activity.place, activity.notes].join(' ').toLowerCase()
		return terms.every((term) => text.includes(term))
	})
})

async function clearActivitySearch() {
	activityListQuery.value = ''
	await nextTick()
	document.getElementById('activity-list-search')?.focus()
}

const totalCount = computed(() => activities.value.length)
const upcomingCount = computed(
	() => activities.value.filter((item) => !hasActivityEnded(item, activityClock.value)).length,
)
const outdoorCount = computed(() => activities.value.filter((item) => item.outdoor).length)

const weatherAlerts = computed(() =>
	visibleActivities.value
		.filter((item) => item.weather.state === 'bad' && !item.done)
		.map((item) => ({ ...item, better: betterDayFor(item) })),
)

const glyphFor = (activity) =>
	activity.outdoor ? activity.weather.icon || '📍' : '🏠'


function onPinClick(activity) {
	selectedId.value = activity.id
	nextTick(() =>
		document
			.getElementById(`activity-${activity.id}`)
			?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
	)
}

function onGoogleMapClick({ lat, lng }) {
	if (!showForm.value) return
	setFormLocation(`Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng)
}

function focusActivity(activity) {
	selectedId.value = activity.id
	if (!hasLocation(activity)) return
	viewMode.value = 'map'
	nextTick(() => googleMapRef.value?.focusActivity(activity))
}


function setFormLocation(place, lat, lng) {
	form.value.place = place
	form.value.lat = lat
	form.value.lng = lng
	searchResults.value = []
	searchMessage.value = ''
}

function clearFormLocation() {
	form.value.place = ''
	form.value.lat = null
	form.value.lng = null
}

function onPresetChange(event) {
	const preset = presetPlaces.find((item) => item.name === event.target.value)
	event.target.value = ''
	if (!preset) return
	setFormLocation(preset.name, preset.lat, preset.lng)
	viewMode.value = 'map'
	nextTick(() => googleMapRef.value?.focusLocation(preset.lat, preset.lng))
}

async function searchLocation() {
	const query = searchQuery.value.trim()
	if (!query) return
	searching.value = true
	searchMessage.value = ''
	searchResults.value = []

	try {
		const url = `${GEOCODE_URL}?format=jsonv2&limit=5&countrycodes=sg&q=${encodeURIComponent(query)}`
		const { data } = await axios.get(url)
		searchResults.value = data
		if (!searchResults.value.length) {
			searchMessage.value = 'No places found. Try another name, pick a preset, or click the map.'
		}
	} catch {
		searchMessage.value = 'Could not search for places right now. Pick a preset or click the map instead.'
	} finally {
		searching.value = false
	}
}

function pickResult(result) {
	const lat = Number(result.lat)
	const lng = Number(result.lon)
	setFormLocation(result.display_name, lat, lng)
	viewMode.value = 'map'
	nextTick(() => googleMapRef.value?.focusLocation(lat, lng))
}


watch(
	() => form.value.when,
	(value) => {
		if (!value) return
		const start = new Date(value)
		if (Number.isNaN(start.getTime())) return
		const end = form.value.end ? new Date(form.value.end) : null
		if (!end || end <= start) {
			form.value.end = toLocalInput(new Date(start.getTime() + 60 * 60 * 1000))
		}
	},
)

function resetForm() {
	form.value = emptyForm()
	searchQuery.value = ''
	searchResults.value = []
	searchMessage.value = ''
	formError.value = ''
}

function openNewForm() {
	resetForm()
	editingId.value = null
	showForm.value = true
}

function closeForm() {
	showForm.value = false
	editingId.value = null
	resetForm()
}

function toggleForm() {
	successMessage.value = ''
	if (showForm.value) closeForm()
	else openNewForm()
}

function startEdit(activity) {
	successMessage.value = ''
	confirmDeleteId.value = null
	resetForm()
	form.value = {
		title: activity.title,
		when: toLocalInput(activity.when),
		end: toLocalInput(activity.end),
		outdoor: String(activity.outdoor),
		notes: activity.notes || '',
		place: activity.place || '',
		lat: hasLocation(activity) ? activity.lat : null,
		lng: hasLocation(activity) ? activity.lng : null,
	}
	editingId.value = activity.id
	showForm.value = true
	window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function saveActivity() {
	if (saving.value || disposed || !showForm.value) return
	formError.value = ''
	successMessage.value = ''

	if (!form.value.title.trim() || !form.value.when || !form.value.end) {
		formError.value = 'Enter an activity name, a start time and an end time.'
		return
	}

	const start = new Date(form.value.when)
	const end = new Date(form.value.end)
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		formError.value = 'Enter a valid start and end time.'
		return
	}
	if (end <= start) {
		formError.value = 'The end time must be after the start time.'
		return
	}

	const outdoor = form.value.outdoor === 'true'
	if (outdoor && form.value.lat === null) {
		formError.value = 'Outdoor activities need a location so we can check the weather.'
		return
	}

	const payload = {
		title: form.value.title.trim(),
		when: start.toISOString(),
		end: end.toISOString(),
		outdoor,
		notes: form.value.notes.trim(),
		place: form.value.place,
		lat: form.value.lat,
		lng: form.value.lng,
	}

	const submittedForm = form.value
	const submittedValues = JSON.stringify(submittedForm)
	const submittedId = editingId.value
	const wasEditing = submittedId !== null
	// A late response must not close or attach errors to a replaced or edited draft.
	const isSubmittedForm = () => !disposed && showForm.value &&
		form.value === submittedForm && editingId.value === submittedId
	const isCurrentDraft = () => isSubmittedForm() &&
		JSON.stringify(form.value) === submittedValues
	saving.value = true
	try {
		const savedActivity = wasEditing
			? await updateActivity(submittedId, payload)
			: await createActivity(payload)

		if (disposed) return
		await loadActivities()
		if (!isCurrentDraft()) {
			// Edits to the same submitted form belong to the created record, not a second create.
			if (!wasEditing && isSubmittedForm() && savedActivity?.id != null) {
				editingId.value = savedActivity.id
			}
			return
		}
		closeForm()
		successMessage.value = wasEditing ? 'Activity updated.' : 'Activity added.'
	} catch (error) {
		if (isCurrentDraft()) {
			formError.value = error.message || 'Could not save the activity. Please try again.'
		}
	} finally {
		if (!disposed) saving.value = false
	}
}

async function removeActivity(activity) {
	try {
		await deleteActivityRecord(activity.id)
		if (selectedId.value === activity.id) selectedId.value = null
		if (editingId.value === activity.id) closeForm()
		confirmDeleteId.value = null
		await loadActivities()
		successMessage.value = 'Activity deleted.'
	} catch (error) {
		loadError.value = error.message || 'Could not delete the activity.'
	}
}

async function loadActivities() {
	loadError.value = ''
	try {
		activities.value = await fetchActivities()
		loadAllForecasts()
	} catch (error) {
		loadError.value = error.message || 'Could not load your activities. Please try again.'
	} finally {
		loading.value = false
	}
}

function openRequestedActivity() {
  if (typeof route.query.edit !== 'string') return
  const activity = activities.value.find(item => String(item.id) === route.query.edit)
	if (activity) { loadError.value = ''; startEdit(activity) }
  else loadError.value = 'This activity is no longer available.'
}
watch(() => route.query.edit, () => { if (!loading.value) openRequestedActivity() })
onMounted(async () => {
  await loadActivities()
	if (route.query.edit && !loadError.value) openRequestedActivity()
  else if (route.query.new === '1') openNewForm()
})
</script>

<template>
	<div class="app activities-app">
		<PlannerNavigation active="/activities" />

		<main class="main activities-page">
			<div class="container-fluid activities-container">
				<PlannerNavigation active="/activities" mobile />
				<header class="header activities-header">
					<div>
						<h1>Activities</h1>
						<p>See where your activities are and what the weather will be like.</p>
					</div>
					<div class="buttons">
						<button type="button" class="btn btn-primary" @click="toggleForm">
							{{ showForm ? 'Close form' : '+ Activity' }}
						</button>
					</div>
				</header>
				<PlannerCompanion character="blue" message="Make room for the good stuff." />

				<div v-if="loadError" class="alert alert-danger" role="alert">{{ loadError }}</div>
				<div v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</div>


				<section v-if="showForm" class="card activity-form-card">
					<div class="card-body">
						<div class="section-heading form-heading">
							<h2>{{ editingId ? 'Edit activity' : 'Add an activity' }}</h2>
						</div>

						<div v-if="formError" class="alert alert-danger py-2" role="alert">{{ formError }}</div>

						<form class="activity-form row g-3 align-items-end" @submit.prevent="saveActivity">
							<div class="form-field col-12 col-lg-6">
								<label for="activity-title" class="form-label">Activity name</label>
								<input id="activity-title" v-model="form.title" class="form-control" maxlength="160"
									placeholder="e.g. Study group at the library" required />
							</div>

							<div class="form-field col-12 col-sm-6 col-lg-3">
								<label for="activity-when" class="form-label">Starts</label>
								<input id="activity-when" v-model="form.when" class="form-control" type="datetime-local"
									required />
							</div>

							<div class="form-field col-12 col-sm-6 col-lg-3">
								<label for="activity-end" class="form-label">Ends</label>
								<input id="activity-end" v-model="form.end" class="form-control" type="datetime-local"
									required />
							</div>

							<div class="form-field col-12 col-md-5 col-lg-4">
								<label for="activity-outdoor" class="form-label">Where is it?</label>
								<select id="activity-outdoor" v-model="form.outdoor" class="form-select">
									<option value="true">Outdoors (check the weather)</option>
									<option value="false">Indoors</option>
								</select>
							</div>

							<div class="form-field col-12 col-md-7 col-lg-8">
								<label for="activity-preset" class="form-label">
									Quick pick a place <span>(optional)</span>
								</label>
								<select id="activity-preset" class="form-select" @change="onPresetChange">
									<option value="">Choose a popular place</option>
									<option v-for="place in presetPlaces" :key="place.name" :value="place.name">
										{{ place.name }}
									</option>
								</select>
							</div>

							<div class="form-field col-12">
								<label for="activity-search" class="form-label">
									Or search for a place <span>(or click the map)</span>
								</label>
								<div class="input-group">
									<input id="activity-search" v-model="searchQuery" class="form-control"
										placeholder="e.g. Pasir Ris Park" @keydown.enter.prevent="searchLocation" />
									<button type="button" class="btn btn-outline-secondary"
										:disabled="searching || !searchQuery.trim()" @click="searchLocation">
										{{ searching ? 'Searching…' : 'Search' }}
									</button>
								</div>

								<p v-if="searchMessage" class="muted mt-2 mb-0">{{ searchMessage }}</p>

								<ul v-if="searchResults.length" class="list-group search-results">
									<li v-for="result in searchResults" :key="result.place_id"
										class="list-group-item p-0">
										<button type="button" class="result-button" @click="pickResult(result)">
											{{ result.display_name }}
										</button>
									</li>
								</ul>

								<div v-if="form.lat !== null" class="chosen-location">
									<span>📍 {{ form.place }}</span>
									<button type="button" class="btn btn-sm btn-outline-secondary"
										@click="clearFormLocation">
										Remove
									</button>
								</div>
							</div>

							<div class="form-field col-12">
								<label for="activity-notes" class="form-label">Notes <span>(optional)</span></label>
								<textarea id="activity-notes" v-model="form.notes" class="form-control" rows="2"
									maxlength="300"></textarea>
							</div>

							<div class="form-actions col-12 d-flex justify-content-end gap-2">
								<button type="button" class="btn btn-outline-secondary"
									:disabled="saving" @click="closeForm">Cancel</button>
								<button type="submit" class="btn btn-primary" :disabled="saving">
									{{ saving ? 'Saving...' : editingId ? 'Save changes' : 'Add activity' }}
								</button>
							</div>
						</form>
					</div>
				</section>


				<section class="row g-2 g-sm-3 mb-3 mb-sm-4" aria-label="Activities summary">
					<div class="col-4">
						<div class="overview-card h-100 flex-column flex-sm-row align-items-center text-center text-sm-start">
							<span class="overview-icon calendar-icon">📅</span>
							<div>
								<strong>{{ totalCount }}</strong>
								<span>Total activities</span>
							</div>
						</div>
					</div>
					<div class="col-4">
						<div class="overview-card h-100 flex-column flex-sm-row align-items-center text-center text-sm-start">
							<span class="overview-icon assignment-icon">⏳</span>
							<div>
								<strong>{{ upcomingCount }}</strong>
								<span>Coming up</span>
							</div>
						</div>
					</div>
					<div class="col-4">
						<div class="overview-card h-100 flex-column flex-sm-row align-items-center text-center text-sm-start">
							<span class="overview-icon activity-icon">🌤️</span>
							<div>
								<strong>{{ outdoorCount }}</strong>
								<span>Outdoor</span>
							</div>
						</div>
					</div>
				</section>


				<section v-if="weatherAlerts.length" class="alert alert-warning weather-alerts" role="alert">
					<button
						type="button"
						class="weather-alerts-toggle"
						:aria-expanded="weatherAlertsOpen"
						aria-controls="activity-weather-alert-details"
						@click="weatherAlertsOpen = !weatherAlertsOpen"
					>
						<strong>⚠️ Weather alert ({{ weatherAlerts.length }})</strong>
						<span class="weather-alerts-action">
							{{ weatherAlertsOpen ? 'Hide details' : 'Show details' }}
							<span class="weather-alerts-chevron" :class="{ open: weatherAlertsOpen }" aria-hidden="true"></span>
						</span>
					</button>
					<ul id="activity-weather-alert-details" v-show="weatherAlertsOpen">
						<li v-for="item in weatherAlerts" :key="item.id">
							<b>{{ item.title }}</b> ({{ formatDate(item.when) }}): {{ item.weather.detail }}.
							<span v-if="item.better">
								{{ item.better.label }} looks drier ({{ item.better.rain }}% rain), or move it indoors.
							</span>
							<span v-else>Consider moving it indoors.</span>
						</li>
					</ul>
				</section>


				<section class="card planner-card">
					<div class="card-body">
						<div class="planner-toolbar">
							<h2 class="view-title">Your activities</h2>

							<div class="toolbar-controls">
								<label class="time-filter">
									<span>Show</span>
									<select v-model="timeFilter" class="form-select form-select-sm">
										<option value="today">Today</option>
										<option value="week">This week</option>
										<option value="upcoming">All upcoming</option>
										<option value="past">Past</option>
										<option value="all">All</option>
									</select>
								</label>

								<div class="tabs" role="group" aria-label="Choose view">
									<button type="button" :class="{ on: viewMode === 'map' }"
										:aria-pressed="viewMode === 'map'" @click="viewMode = 'map'">
										🗺️ Map
									</button>
									<button type="button" :class="{ on: viewMode === 'list' }"
										:aria-pressed="viewMode === 'list'" @click="viewMode = 'list'">
										📋 List
									</button>
								</div>
							</div>
						</div>

						<div class="map-layout">
							<div v-show="viewMode === 'map'" class="map-column">
								<GoogleActivityMap
									ref="googleMapRef"
									:activities="mappableActivities"
									:selected-id="selectedId"
									:draft-location="form.lat !== null ? { lat: form.lat, lng: form.lng } : null"
									:picking="showForm"
									@activity-selected="onPinClick"
									@map-click="onGoogleMapClick"
								/>

								<div class="map-legend">
									<span><i class="legend-dot outdoor-dot"></i>Outdoor</span>
									<span><i class="legend-dot indoor-dot"></i>Indoor</span>
									<span v-if="unmappedCount" class="muted">{{ unmappedCount }} without a
										location</span>
								</div>
							</div>

							<div v-show="viewMode === 'list'" class="list-column">
								<div class="activity-list-search">
									<label for="activity-list-search" class="form-label">Search activities</label>
									<div class="activity-list-search-field">
										<input id="activity-list-search" v-model="activityListQuery" type="search"
											class="form-control" placeholder="Search by name, location or notes"
											:aria-describedby="!loading ? 'activity-list-results' : undefined" />
										<button v-if="activityListQuery" type="button" class="btn btn-outline-secondary"
											aria-label="Clear activity search" @click="clearActivitySearch">Clear</button>
									</div>
									<p v-if="!loading" id="activity-list-results" class="muted mb-0" role="status">
										{{ searchedActivities.length }} of {{ visibleActivities.length }}
										{{ visibleActivities.length === 1 ? 'activity' : 'activities' }}
									</p>
								</div>
								<div v-if="loading" class="loading-state" role="status">
									<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
									Loading activities…
								</div>

								<div v-else-if="!searchedActivities.length" class="empty-state">
									<span>📅</span>
									<strong class="empty-title">{{ activityListQuery.trim() ? 'No matching activities' : 'No activities here' }}</strong>
									<p>{{ activityListQuery.trim() ? 'Try another search or change the time filter above.' : 'Use “+ Activity” to plan something, or change the filter above.' }}</p>
								</div>

								<template v-else>
									<div v-for="activity in searchedActivities" :id="`activity-${activity.id}`"
										:key="activity.id" class="activity-row"
										:data-urgency="activity.urgency?.level"
										:class="{ selected: activity.id === selectedId, done: activity.done }">
										<button type="button" class="row-main" @click="focusActivity(activity)">
											<span class="activity-weather-icon" :class="activity.weather.state">
												{{ glyphFor(activity) }}
											</span>
											<span class="activity-info">
												<strong>{{ activity.title }}</strong>
												<TaskUrgencyBadge :urgency="activity.urgency" />
												<span>{{ formatWhen(activity) }}</span>
												<span v-if="activity.place">📍 {{ activity.place }}</span>
												<span v-if="activity.weather.detail">{{ activity.weather.detail
												}}</span>
												<span v-if="activity.notes">{{ activity.notes }}</span>
											</span>
										</button>

										<span v-if="activity.done" class="verdict good">Completed</span>
										<span v-else class="verdict" :class="activity.weather.state">{{
											activity.weather.verdict }}</span>

										<div class="row-actions">
											<template v-if="confirmDeleteId === activity.id">
												<span class="confirm-text">Delete this?</span>
												<button type="button" class="btn btn-sm btn-danger"
													@click="removeActivity(activity)">
													Delete
												</button>
												<button type="button" class="btn btn-sm btn-outline-secondary"
													@click="confirmDeleteId = null">
													Keep
												</button>
											</template>
											<template v-else>
												<button type="button" class="btn btn-sm btn-outline-secondary"
													@click="startEdit(activity)">
													Edit
												</button>
												<button type="button" class="btn btn-sm btn-outline-danger"
													@click="confirmDeleteId = activity.id">
													Delete
												</button>
											</template>
										</div>
									</div>
								</template>
							</div>
						</div>
					</div>
				</section>
			</div>
		</main>
	</div>
</template>

<style scoped>
.activities-app {
	background: var(--bg);
}



.activities-page {
	width: 100%;
}

/* Form */
.activity-form-card,
.planner-card {
	border: 0;
	box-shadow: 0 0.6rem 2rem rgba(33, 42, 92, 0.07);
}

.form-heading {
	margin-bottom: 1.25rem;
}

.form-field {
	min-width: 0;
}

.form-label span {
	color: var(--muted);
	font-weight: 400;
}

.form-actions {
	padding-top: 0.25rem;
}

.search-results {
	margin-top: 0.5rem;
	border-radius: 0.6rem;
	overflow: hidden;
}

.result-button {
	display: block;
	width: 100%;
	padding: 0.6rem 0.9rem;
	border: 0;
	background: #fff;
	color: var(--ink);
	font-size: 0.85rem;
	text-align: left;
}

.result-button:hover,
.result-button:focus-visible {
	background: var(--brand-soft);
}

.chosen-location {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	margin-top: 0.6rem;
	padding: 0.5rem 0.75rem;
	border-radius: 0.6rem;
	background: var(--brand-soft);
	font-size: 0.85rem;
}

.chosen-location span {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.weather-alerts-toggle {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 0.5rem 1rem;
	width: 100%;
	min-height: 36px;
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.weather-alerts-action {
	display: inline-flex;
	align-items: center;
	gap: 0.6rem;
	font-size: 0.8rem;
	font-weight: 600;
}

.weather-alerts-chevron {
	width: 7px;
	height: 7px;
	border-right: 2px solid currentColor;
	border-bottom: 2px solid currentColor;
	transform: rotate(45deg);
}

.weather-alerts-chevron.open {
	transform: rotate(225deg);
}

.weather-alerts ul {
	margin: 0.4rem 0 0;
	padding-left: 1.2rem;
}

/* Toolbar */


.planner-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 1rem;
	padding-bottom: 1rem;
	border-bottom: 1px solid var(--border);
}

.view-title {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
}

.toolbar-controls {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 1rem;
}

.time-filter {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	color: var(--muted);
	font-size: 0.8rem;
	font-weight: 650;
}

.time-filter select {
	min-width: 130px;
}

/* Map and list use separate full-width views. */
.map-layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	width: 100%;
	padding-top: 1.1rem;
}

.map-layout.split {
	grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 1200px) {
	.map-layout.split {
		grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr);
	}

	.map-layout.split .list-column {
		max-height: 640px;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
}
.map-column,
.list-column {
	min-width: 0;
	width: 100%;
}
.activity-list-search {
	padding-bottom: 16px;
	border-bottom: 1px solid var(--border);
}
.activity-list-search-field {
	display: flex;
	gap: 8px;
}
.activity-list-search-field input {
	min-width: 0;
}
.activity-list-search-field button {
	flex-shrink: 0;
}
.activity-list-search p {
	margin-top: 8px;
	font-size: .75rem;
}

/* Map */
.map-wrap {
	position: relative;
	overflow: hidden;
	border: 1px solid var(--border);
	border-radius: 0.8rem;
}

.activities-map {
	display: block;
	width: 100%;
	height: auto;
	aspect-ratio: 1040 / 600;
	cursor: grab;
	touch-action: none;
	user-select: none;
}

.activities-map:active {
	cursor: grabbing;
}

.activities-map.picking {
	cursor: crosshair;
}

.sea {
	fill: #e4ecfb;
}

.land {
	fill: #fbfbff;
	stroke: #c9cff0;
	stroke-width: 1.5;
	vector-effect: non-scaling-stroke;
}

.park {
	fill: #dff5ea;
}

.area-label {
	fill: #9aa1c0;
	font-weight: 600;
	pointer-events: none;
}

.pin {
	cursor: pointer;
	outline: none;
}

.pin circle {
	fill: var(--brand);
	stroke: #fff;
	stroke-width: 3;
	filter: drop-shadow(0 2px 4px rgba(33, 42, 92, 0.35));
}

.pin.good circle {
	fill: var(--green);
}

.pin.maybe circle {
	fill: #f59f00;
}

.pin.bad circle {
	fill: var(--red);
}

.pin.done {
	opacity: 0.45;
}

.pin.selected circle,
.pin:focus-visible circle {
	stroke: var(--ink);
	stroke-width: 4;
}

.pin-glyph {
	font-size: 17px;
	pointer-events: none;
}

.pin-label {
	fill: var(--ink);
	font-size: 13px;
	font-weight: 700;
	paint-order: stroke;
	stroke: #fff;
	stroke-width: 4px;
	stroke-linejoin: round;
	pointer-events: none;
}

.pin-label-group {
	pointer-events: none;
}

.draft-pin circle {
	fill: rgba(91, 91, 240, 0.15);
	stroke: var(--brand);
	stroke-width: 2.5;
	stroke-dasharray: 4 3;
	pointer-events: none;
}

.draft-pin .draft-dot {
	fill: var(--brand);
	stroke: none;
}

.map-controls {
	position: absolute;
	top: 0.75rem;
	right: 0.75rem;
	display: grid;
	gap: 0.35rem;
}

.map-controls .btn {
	width: 2rem;
	height: 2rem;
	padding: 0;
	box-shadow: 0 0.2rem 0.6rem rgba(33, 42, 92, 0.18);
	font-size: 1rem;
	line-height: 1;
}

.map-hint {
	position: absolute;
	left: 50%;
	bottom: 0.75rem;
	margin: 0;
	transform: translateX(-50%);
	padding: 0.4rem 0.9rem;
	border-radius: 99px;
	background: #fff;
	box-shadow: 0 0.3rem 1rem rgba(33, 42, 92, 0.15);
	color: var(--muted);
	font-size: 0.8rem;
	white-space: nowrap;
	pointer-events: none;
}

.map-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 1rem;
	padding: 0.85rem 0.15rem 0;
	color: var(--muted);
	font-size: 0.75rem;
}

.map-legend span {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
}

.legend-dot {
	width: 0.6rem;
	height: 0.6rem;
	border-radius: 50%;
}

.outdoor-dot {
	background: #e5484d;
}

.indoor-dot {
	background: #4f5fe8;
}

/* Activity rows */
.activity-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.6rem 0.8rem;
	padding: 0.8rem 0.9rem;
	margin-bottom: 0.6rem;
	border: 1px solid var(--border);
	border-left: 5px solid var(--border);
	border-radius: 0.9rem;
	background: var(--surface-subtle);
}

.activity-row.selected {
	background: var(--brand-soft);
	border-left-color: var(--brand);
}

.activity-row[data-urgency='urgent'] {
	border-left-color: var(--red);
}

.activity-row[data-urgency='soon'] {
	border-left-color: #ad782b;
}

.activity-row[data-urgency='week'] {
	border-left-color: var(--brand);
}

.activity-row[data-urgency='active'] {
	border-left-color: var(--green);
}

.activity-row.done .row-main {
	opacity: 0.5;
	text-decoration: line-through;
}

.row-main {
	display: flex;
	flex: 1 1 220px;
	align-items: center;
	gap: 0.8rem;
	min-width: 0;
	padding: 0;
	border: 0;
	background: none;
	color: var(--ink);
	text-align: left;
}

.activity-weather-icon {
	display: grid;
	width: 2.5rem;
	height: 2.5rem;
	flex: 0 0 auto;
	place-items: center;
	border-radius: 0.75rem;
	background: var(--brand-soft);
	font-size: 1.2rem;
}

.activity-weather-icon.good {
	background: #dcf8ef;
}

.activity-weather-icon.maybe {
	background: #fff3d6;
}

.activity-weather-icon.bad {
	background: #ffe9ee;
}

.activity-info {
	display: grid;
	gap: 0.15rem;
	min-width: 0;
}

.activity-info span {
	color: var(--muted);
	font-size: 0.77rem;
}

.row-actions {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	margin-left: auto;
}

.confirm-text {
	color: var(--red);
	font-size: 0.8rem;
	font-weight: 600;
}

.loading-state {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.75rem;
	min-height: 240px;
	color: var(--muted);
}

.empty-state {
	display: grid;
	justify-items: center;
	padding: 3rem 1rem;
	text-align: center;
}

.empty-state>span {
	font-size: 2rem;
}

.empty-title {
	margin: 0.75rem 0 0.25rem;
	font-size: 1.1rem;
}

.empty-state p {
	margin: 0;
	color: var(--muted);
	font-size: 0.88rem;
}

@media (max-width: 767.98px) {
	.activities-page {
	}

	.planner-toolbar,
	.toolbar-controls {
		align-items: stretch;
		flex-direction: column;
		width: 100%;
	}

	.time-filter {
		align-items: flex-start;
		flex-direction: column;
	}

	.time-filter select {
		width: 100%;
	}

	.row-actions {
		width: 100%;
		justify-content: flex-end;
	}

	.form-actions .btn {
		flex: 1;
	}
}
</style>

