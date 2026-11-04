<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import axios from 'axios'
import LogoutButton from './LogoutButton.vue'

/*
 * AI-assisted implementation of the two behaviours this screen was missing:
 * common-availability matching and the invitation send/accept flow.
 * The matching algorithm and the invitation rules live on the server
 * (server/group-meetings.js) so the browser only ever receives the answer,
 * never another member's raw calendar. Record this assistance in the team's
 * final README.txt as required by the brief.
 *
 * Booking was added later: a chosen slot becomes a real meeting, blocks the
 * slot for every participant, and shows up on the Dashboard timeline as an
 * activity (the server derives it from the meeting, so it cannot drift).
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const TIME_ZONE = 'Asia/Singapore'

const loading = ref(true)
const loadError = ref('')
const state = ref(null)

const selectedGroupId = ref('')
const draft = reactive({
  fromDate: '',
  toDate: '',
  startTime: '09:00',
  endTime: '18:00',
  durationMinutes: '60',
})

const matching = ref(false)
const matchError = ref('')
const matchResult = ref(null)

// Search form and results now live in one card, so after a search the viewport
// moves to the answer block instead of leaving the user staring at the button.
const resultsAnchor = ref(null)
const meetingsSection = ref(null)
const bookingAnchor = ref(null)
const flashTarget = ref('')
let highlightTimer = 0

const busyAction = ref('')
const actionError = ref('')
const actionNotice = ref('')

const inviteEmail = ref('')
// Inviting has its own group choice: you often create a group first and only
// then think about who to add, without switching the whole page.
const inviteGroupId = ref('')
const inviteError = ref('')
const inviteNotice = ref('')

const newGroupName = ref('')
const newGroupError = ref('')

// Booking form. A slot chip in the results simply fills this in.
const booking = reactive({ title: '', date: '', startTime: '09:00', durationMinutes: '60' })
const bookingBusy = ref(false)
const bookingError = ref('')
const bookingNotice = ref('')

// Cancelling is two steps: the second click confirms, so a stray click on the
// meeting list cannot delete a booking.
const confirmingMeetingId = ref('')

// Booking a time that is not shared-free asks first: { title, startAt, endAt,
// conflicts, reason }. reason is 'busy' | 'outside' | 'unsearched'.
const bookingConfirm = ref(null)
const confirmButton = ref(null)
const confirmBusyNames = computed(() =>
  (bookingConfirm.value?.conflicts || []).map((item) => item.name).join(', '),
)

// Existing planner source, kept for context alongside the group data.
const planner = reactive({ assignments: [], quizzes: [], activities: [] })
const plannerLoading = ref(true)
const plannerError = ref('')

const groups = computed(() => state.value?.groups || [])
const selectedGroup = computed(
  () => groups.value.find((group) => group.id === selectedGroupId.value) || null,
)
const members = computed(() => selectedGroup.value?.members || [])
const incomingInvitations = computed(() => state.value?.incomingInvitations || [])
const pendingCount = computed(
  () => incomingInvitations.value.filter((invitation) => invitation.status === 'pending').length,
)

// Invitations live in the sidebar bell instead of taking a card at the top of
// the page: the badge carries the "something needs you" signal.
const bellOpen = ref(false)
const bellButton = ref(null)
const mobileBellButton = ref(null)
const bellPanel = ref(null)
const bellPanelStyle = ref({})

function placeBellPanel() {
  if (window.innerWidth <= 1000) {
    // Narrow screens use the CSS placement (full width, below the top bar).
    bellPanelStyle.value = {}
    return
  }
  const anchor = (bellButton.value || mobileBellButton.value)?.getBoundingClientRect()
  if (!anchor) return
  const height = 460
  bellPanelStyle.value = {
    top: `${Math.max(16, Math.min(anchor.top - 8, window.innerHeight - height))}px`,
    left: `${anchor.right + 12}px`,
  }
}

function toggleBell() {
  bellOpen.value = !bellOpen.value
  if (bellOpen.value) nextTick(placeBellPanel)
}

function onBellDocumentClick(event) {
  const target = event.target
  if (bellPanel.value?.contains(target)) return
  if (bellButton.value?.contains(target) || mobileBellButton.value?.contains(target)) return
  bellOpen.value = false
}

function onBellKeydown(event) {
  if (event.key === 'Escape') bellOpen.value = false
}

watch(bellOpen, (open) => {
  if (open) {
    document.addEventListener('click', onBellDocumentClick, true)
    document.addEventListener('keydown', onBellKeydown)
  } else {
    document.removeEventListener('click', onBellDocumentClick, true)
    document.removeEventListener('keydown', onBellKeydown)
  }
})
const inviteGroup = computed(
  () => groups.value.find((group) => group.id === inviteGroupId.value) || null,
)
const sentInvitations = computed(
  () =>
    (state.value?.sentInvitations || []).filter(
      (invitation) => invitation.groupId === inviteGroupId.value,
    ),
)
const groupMeetings = computed(
  () => (state.value?.meetings || []).filter((meeting) => meeting.groupId === selectedGroupId.value),
)
const canJoinDemo = computed(() => state.value?.demo?.canJoin === true)
const matchReady = computed(() => members.value.length > 0)
// Group meetings are already listed above; the read-only source list shows the
// rest of the planner's activities only.
const sourceActivities = computed(() =>
  planner.activities.filter((activity) => activity.source !== 'group-meeting'),
)
const bookingPlaceholder = computed(() => 'e.g. Weekly sync')

function messageOf(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    'Something went wrong. Please try again.'
  )
}

function formatDateTime(value) {
  if (!value) return 'Date not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date in source'
  return date.toLocaleString('en-SG', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('en-SG', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatRange(startAt, endAt) {
  return `${formatTime(startAt)} – ${formatTime(endAt)}`
}

/** Calendar date (YYYY-MM-DD) of an instant, read in Singapore time. */
function sgDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Singapore wall clock (date + HH:MM) -> ISO instant. */
function sgStartIso(dateText, timeText) {
  if (!dateText || !timeText) return ''
  const stamp = Date.parse(`${dateText}T${timeText}:00+08:00`)
  return Number.isNaN(stamp) ? '' : new Date(stamp).toISOString()
}

function formatDay(dateText) {
  const date = new Date(`${dateText}T00:00:00+08:00`)
  if (Number.isNaN(date.getTime())) return dateText
  return date.toLocaleDateString('en-SG', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const BLOCKER_LABELS = {
  schedule_incomplete: 'Calendar not complete',
  coverage_partial: 'Calendar coverage too short',
  unknown_member: 'No member profile',
}

function blockerLabel(reason) {
  return BLOCKER_LABELS[reason] || 'Availability unknown'
}

function ensureSelection() {
  const list = state.value?.groups || []
  if (!list.some((group) => group.id === selectedGroupId.value)) {
    selectedGroupId.value = list[0]?.id || ''
  }
  if (!list.some((group) => group.id === inviteGroupId.value)) {
    inviteGroupId.value = selectedGroupId.value
  }
}

async function loadGroupState() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await axios.get(`${API_URL}/group-meetings`,{ withCredentials: true })
    const data = response.data
    state.value = data

    if (!draft.fromDate) {
      Object.assign(draft, {
        fromDate: data.defaults.fromDate,
        toDate: data.defaults.toDate,
        startTime: data.defaults.startTime,
        endTime: data.defaults.endTime,
        durationMinutes: String(data.defaults.durationMinutes),
      })
    }
    if (!booking.date) booking.date = data.fromDate

    ensureSelection()
  } catch (error) {
    loadError.value = messageOf(error)
    state.value = null
  } finally {
    loading.value = false
  }
}

async function loadPlannerData() {
  plannerLoading.value = true
  plannerError.value = ''
  try {
    const response = await axios.get(`${API_URL}/planner-data`, { withCredentials: true })
    const data = response.data
    if (!Array.isArray(data?.activities) || !Array.isArray(data?.assignments)) {
      throw new Error('The planner response is missing expected fields.')
    }
    planner.activities = data.activities
    planner.assignments = data.assignments
    planner.quizzes = data.quizzes || []
  } catch (error) {
    plannerError.value = messageOf(error)
  } finally {
    plannerLoading.value = false
  }
}

onMounted(() => {
  loadGroupState()
  loadPlannerData()
})

watch(selectedGroupId, () => {
  matchResult.value = null
  matchError.value = ''
  inviteError.value = ''
  inviteNotice.value = ''
  bookingError.value = ''
  bookingNotice.value = ''
  confirmingMeetingId.value = ''
  // The invite panel follows the page's group until it is pointed elsewhere.
  inviteGroupId.value = selectedGroupId.value
})

/* ------------------------------------------------------------------ *
 * Scrolling helpers: a result the user cannot see looks like a bug.
 * ------------------------------------------------------------------ */

function flash(name) {
  flashTarget.value = name
  window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => {
    flashTarget.value = ''
  }, 1800)
}

function revealElement(element) {
  if (!element) return
  const rect = element.getBoundingClientRect()
  const alreadyInPlace = rect.top >= 0 && rect.top <= window.innerHeight * 0.35
  if (!alreadyInPlace) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  element.focus({ preventScroll: true })
}

async function revealResults() {
  await nextTick()
  revealElement(resultsAnchor.value)
  flash('results')
}

async function revealMeetings() {
  await nextTick()
  revealElement(meetingsSection.value)
  flash('meetings')
}

async function revealBooking() {
  await nextTick()
  revealElement(bookingAnchor.value)
}

onBeforeUnmount(() => {
  window.clearTimeout(highlightTimer)
  document.removeEventListener('click', onBellDocumentClick, true)
  document.removeEventListener('keydown', onBellKeydown)
})

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

async function findCommonTime({ quiet = false } = {}) {
  matchError.value = ''
  if (!selectedGroupId.value) {
    matchError.value = 'Choose a group first.'
    if (!quiet) await revealResults()
    return
  }

  matching.value = true
  try {
    const response = await axios.post(`${API_URL}/group-meetings/common-time`, {
      groupId: selectedGroupId.value,
      fromDate: draft.fromDate,
      toDate: draft.toDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      durationMinutes: Number(draft.durationMinutes),
    }, { withCredentials: true })
    const data = response.data
    matchResult.value = data

    // Prefill the booking form with the best slot, but never overwrite a time
    // the user picked by hand.
    if (data.status === 'ok' && data.best && !booking.date) {
      booking.date = data.best.date
      booking.startTime = formatTime(data.best.startAt)
      booking.durationMinutes = String(data.window.durationMinutes)
    }
  } catch (error) {
    matchError.value = messageOf(error)
    matchResult.value = null
  } finally {
    matching.value = false
    // Runs after the spinner is gone, so the answer is already in the DOM.
    if (!quiet) await revealResults()
  }
}

/* ------------------------------------------------------------------ *
 * Booking
 * ------------------------------------------------------------------ */

function pickSlot(date, slot) {
  booking.date = date
  booking.startTime = formatTime(slot.startAt)
  booking.durationMinutes = String(matchResult.value?.window?.durationMinutes || 60)
  bookingError.value = ''
  bookingNotice.value = ''
  revealBooking()
}

function isPickedSlot(date, slot) {
  return (
    booking.date === date &&
    booking.startTime === formatTime(slot.startAt) &&
    Number(booking.durationMinutes) === matchResult.value?.window?.durationMinutes
  )
}

/**
 * True when the range sits inside one of the free blocks the last search
 * returned, i.e. the search already proved everyone is free for that long.
 */
function isInsideSharedFreeBlock(startAt, endAt) {
  if (matchResult.value?.status !== 'ok') return false
  const start = Date.parse(startAt)
  const end = Date.parse(endAt)

  return matchResult.value.days.some((day) =>
    day.blocks.some(
      (block) => start >= Date.parse(block.startAt) && end <= Date.parse(block.endAt),
    ),
  )
}

async function submitBooking({ title, startAt, endAt, force }) {
  bookingBusy.value = true
  try {
    const response = await axios.post(`${API_URL}/group-meetings/meetings`, {
      groupId: selectedGroupId.value,
      title,
      startAt,
      endAt,
      force,
    }, { withCredentials: true })

    const data = response.data

    bookingConfirm.value = null
    bookingNotice.value =
      `"${data.meeting.title}" is booked for ${formatDay(sgDate(data.meeting.startAt))}, ` +
      `${formatRange(data.meeting.startAt, data.meeting.endAt)}. ` +
      'It is on your Dashboard timeline now.'

    await loadGroupState()
    // The booked slot is no longer free, so refresh the result silently.
    if (matchResult.value) await findCommonTime({ quiet: true })
    await revealMeetings()
  } catch (error) {
    bookingConfirm.value = null
    bookingError.value = messageOf(error)
  } finally {
    bookingBusy.value = false
  }
}

async function bookMeeting() {
  bookingError.value = ''
  bookingNotice.value = ''

  if (!selectedGroupId.value) {
    bookingError.value = 'Choose a group first.'
    return
  }
  const title = booking.title.trim()
  if (title.length < 2) {
    bookingError.value = 'Give the meeting a title of at least 2 characters.'
    return
  }
  if (!booking.date) {
    bookingError.value = 'Pick a date for the meeting.'
    return
  }

  const startAt = sgStartIso(booking.date, booking.startTime)
  if (!startAt) {
    bookingError.value = 'That start time could not be read.'
    return
  }
  const endAt = new Date(
    Date.parse(startAt) + Number(booking.durationMinutes) * 60000,
  ).toISOString()

  bookingBusy.value = true
  try {
    // Ask the server who is busy before writing anything.
    const response = await axios.post(`${API_URL}/group-meetings/meetings/preview`, {
      groupId: selectedGroupId.value,
      title,
      startAt,
      endAt,
    }, { withCredentials: true })
    const data = response.data
    const conflicts = data.conflicts || []
    const searched = matchResult.value?.status === 'ok'
    const sharedFree = searched && isInsideSharedFreeBlock(startAt, endAt)

    // A time outside the shared result is not the same as a free time: 04:00 has
    // no busy interval for anyone, yet nobody is available either.
    if (conflicts.length || !sharedFree) {
      bookingConfirm.value = {
        title,
        startAt,
        endAt,
        conflicts,
        reason: conflicts.length ? 'busy' : searched ? 'outside' : 'unsearched',
      }
      // Release the busy state first: the dialog button is disabled while it is
      // set, and a disabled button cannot take focus.
      bookingBusy.value = false
      await nextTick()
      confirmButton.value?.focus()
      return
    }

    await submitBooking({ title, startAt, endAt, force: false })
  } catch (error) {
    bookingError.value = messageOf(error)
  } finally {
    bookingBusy.value = false
  }
}

/** The dialog was accepted: book it, overriding the clash if there was one. */
async function confirmBooking() {
  const pending = bookingConfirm.value
  if (!pending) return

  await submitBooking({
    title: pending.title,
    startAt: pending.startAt,
    endAt: pending.endAt,
    force: pending.conflicts.length > 0,
  })
}

/** The booker and the group owner can cancel; the server enforces the same rule. */
function canCancelMeeting(meeting) {
  return meeting.isMine === true || selectedGroup.value?.isOwner === true
}

async function cancelMeeting(meeting) {
  actionError.value = ''
  actionNotice.value = ''
  busyAction.value = `cancel-meeting:${meeting.id}`
  try {
    await axios.delete(`${API_URL}/group-meetings/meetings/${meeting.id}`, { withCredentials: true })
    actionNotice.value =
      `"${meeting.title}" is cancelled. That slot is free again and the meeting is off your ` +
      'Dashboard timeline.'
    confirmingMeetingId.value = ''
    await loadGroupState()
    // The freed slot can be booked again, so refresh the result silently.
    if (matchResult.value) await findCommonTime({ quiet: true })
  } catch (error) {
    actionError.value = messageOf(error)
  } finally {
    busyAction.value = ''
  }
}

/* ------------------------------------------------------------------ *
 * Invitations and sharing
 * ------------------------------------------------------------------ */

async function respond(invitation, action) {
  actionError.value = ''
  actionNotice.value = ''
  busyAction.value = `${action}:${invitation.id}`
  try {
    await axios.post(`${API_URL}/group-meetings/invitations/${invitation.id}/${action}`, { withCredentials: true })
    const labels = {
      accept: `You joined ${invitation.groupName}.`,
      decline: `You declined the invitation to ${invitation.groupName}.`,
      cancel: `Invitation to ${invitation.toUserName} cancelled.`,
    }
    actionNotice.value = labels[action]
    await loadGroupState()
    matchResult.value = null
  } catch (error) {
    actionError.value = messageOf(error)
  } finally {
    busyAction.value = ''
  }
}

async function sendInvitation() {
  inviteError.value = ''
  inviteNotice.value = ''
  const email = inviteEmail.value.trim()

  if (!inviteGroupId.value) {
    inviteError.value = 'Choose the group to invite into.'
    return
  }
  if (!email) {
    inviteError.value = 'Enter the email address of a classmate who has an account.'
    return
  }

  busyAction.value = 'invite'
  try {
    await axios.post(`${API_URL}/group-meetings/invitations`, {
      groupId: inviteGroupId.value,
      email,
    }, { withCredentials: true })
    inviteNotice.value =
      `Invitation sent to ${email} for ${inviteGroup.value?.name || 'the group'}. ` +
      'They become a member only after accepting.'
    inviteEmail.value = ''
    await loadGroupState()
  } catch (error) {
    inviteError.value = messageOf(error)
  } finally {
    busyAction.value = ''
  }
}

async function createGroup() {
  newGroupError.value = ''
  actionError.value = ''
  const name = newGroupName.value.trim()
  if (name.length < 2) {
    newGroupError.value = 'Give the group a name of at least 2 characters.'
    return
  }

  busyAction.value = 'create'
  try {
    const response = await axios.post(`${API_URL}/group-meetings/groups`, { name }, { withCredentials: true })
    const data = response.data
    newGroupName.value = ''
    await loadGroupState()
    selectedGroupId.value = data.group.id
    actionNotice.value = `${name} created. Invite teammates to get started.`
  } catch (error) {
    newGroupError.value = messageOf(error)
  } finally {
    busyAction.value = ''
  }
}

async function joinDemoGroup() {
  actionError.value = ''
  busyAction.value = 'demo'
  try {
    const response = await axios.post(`${API_URL}/group-meetings/demo-group/join`, { withCredentials: true })
    const data = response.data
    await loadGroupState()
    selectedGroupId.value = data.group.id
    actionNotice.value = 'You joined the demo group.'
  } catch (error) {
    actionError.value = messageOf(error)
  } finally {
    busyAction.value = ''
  }
}
</script>

<template>
  <div class="app gm-app">
    <aside class="sidebar gm-sidebar" aria-label="Planner navigation">
      <h2>🎓 Student Planner</h2>
      <RouterLink to="/dashboard">📊 Dashboard</RouterLink>
      <RouterLink to="/assignments">📝 Assignments</RouterLink>
      <RouterLink to="/activities">📅 Activities</RouterLink>
      <a class="disabled-link" aria-disabled="true">🌤️ Weather</a>
      <RouterLink to="/groupwork" class="active" aria-current="page">👥 Group Meetings</RouterLink>
      <button ref="bellButton" type="button" class="gm-bell"
        :class="{ 'gm-bell-open': bellOpen, 'gm-bell-alert': pendingCount > 0 }"
        :aria-expanded="bellOpen" aria-haspopup="dialog" @click="toggleBell">
        <span class="gm-bell-icon" aria-hidden="true">🔔</span>
        <span>Invitations</span>
        <span v-if="pendingCount" class="gm-bell-dot" aria-hidden="true"></span>
        <span class="gm-sr-only">{{ pendingCount }} awaiting response</span>
      </button>
      <LogoutButton />
    </aside>

    <main class="main gm-page">
      <div class="container-xxl">
        <nav class="gm-mobile-nav d-flex flex-wrap gap-2 mb-3" aria-label="Mobile navigation">
          <RouterLink class="btn btn-sm btn-outline-secondary" to="/dashboard">Dashboard</RouterLink>
          <RouterLink class="btn btn-sm btn-outline-secondary" to="/assignments">Assignments</RouterLink>
          <RouterLink class="btn btn-sm btn-outline-secondary" to="/activities">Activities</RouterLink>
          <button ref="mobileBellButton" type="button" class="btn btn-sm btn-outline-secondary gm-bell-mobile"
            :class="{ 'gm-bell-alert': pendingCount > 0 }" :aria-expanded="bellOpen" @click="toggleBell">
            <span aria-hidden="true">🔔</span> Invitations
            <span v-if="pendingCount" class="gm-bell-dot gm-bell-dot-inline" aria-hidden="true"></span>
          </button>
        </nav>

        <header class="header gm-header">
          <div>
            <p class="gm-eyebrow">PLAN TOGETHER</p>
            <h1>Group Meetings</h1>
            <p>Connect your schedules, find a time that works, then book it.</p>
          </div>
          <span class="badge rounded-pill gm-phase">
            {{ groups.length ? 'Live group data' : 'No group yet' }}
          </span>
        </header>

        <div v-if="loadError" class="alert alert-danger" role="alert">
          {{ loadError }} Start the backend on port 8000, sign in, then reload this page.
        </div>
        <div v-if="actionNotice" class="alert alert-success" role="status">{{ actionNotice }}</div>
        <div v-if="actionError" class="alert alert-warning" role="alert">{{ actionError }}</div>

        <div v-if="loading" class="gm-empty" role="status">
          <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          Loading your groups...
        </div>

        <template v-else-if="state">
          <!-- First run: no group yet -->
          <section v-if="!groups.length" class="card gm-card gm-onboarding" aria-labelledby="gm-start-title">
            <div class="card-body">
              <h2 id="gm-start-title">Start a group</h2>
              <p class="gm-help">
                A group is the set of people whose calendars are compared. Create one and invite
                teammates by the email address they registered with.
              </p>
              <div class="row g-3 align-items-end">
                <div class="col-12 col-md-6">
                  <label for="gm-first-group" class="form-label">Group name</label>
                  <input id="gm-first-group" v-model="newGroupName" class="form-control"
                    placeholder="e.g. IS216 project team" maxlength="80" />
                </div>
                <div class="col-12 col-md-6 d-flex flex-wrap gap-2">
                  <button type="button" class="btn btn-primary" :disabled="busyAction === 'create'"
                    @click="createGroup">
                    {{ busyAction === 'create' ? 'Creating...' : 'Create group' }}
                  </button>
                  <button v-if="canJoinDemo" type="button" class="btn btn-outline-secondary"
                    :disabled="busyAction === 'demo'" @click="joinDemoGroup">
                    {{ busyAction === 'demo' ? 'Joining...' : 'Join demo group' }}
                  </button>
                </div>
              </div>
              <p v-if="newGroupError" class="text-danger gm-help mt-2 mb-0" role="alert">{{ newGroupError }}</p>
              <p v-if="canJoinDemo" class="gm-help mt-3 mb-0">
                The demo group comes with three seeded members and sample calendars, so matching can be
                tried immediately.
              </p>
            </div>
          </section>

          <template v-if="groups.length">
            <section class="row g-3 mb-4" aria-label="Group summary">
              <div class="col-12 col-sm-6 col-xl-4">
                <div class="gm-summary h-100">
                  <span>Your groups</span>
                  <strong>{{ groups.length }}</strong>
                  <small>{{ selectedGroup?.name || 'None selected' }}</small>
                </div>
              </div>
              <div class="col-12 col-sm-6 col-xl-4">
                <!-- Desktop: plain summary box (names are in the Members card) -->
                <div class="d-none d-xl-block h-100">
                  <div class="gm-summary h-100">
                    <span>Members in this group</span>
                    <strong>{{ members.length }}</strong>
                    <small>{{ selectedGroup?.isOwner ? 'You own this group' : 'Member' }}</small>
                  </div>
                </div>
                <!-- Mobile: tap the box to show the member names -->
                <div class="d-xl-none h-100">
                  <details class="gm-summary h-100">
                    <summary class="d-block">
                      <span class="d-block">Members in this group</span>
                      <strong class="d-block">{{ members.length }}</strong>
                      <small class="d-block">{{ selectedGroup?.isOwner ? 'You own this group' : 'Member' }} ▾</small>
                    </summary>
                    <ul class="list-unstyled border-top mt-3 pt-2 mb-0">
                      <li v-for="member in members" :key="member.id" class="py-1">
                        <strong>{{ member.name }}</strong>
                        <small class="d-block">
                          <span v-if="member.isOwner">Owner</span>
                          <span v-if="member.isViewer"><span v-if="member.isOwner"> · </span>You</span>
                          <span v-if="member.scheduleStatus !== 'complete'"> · Calendar incomplete</span>
                        </small>
                      </li>
                    </ul>
                  </details>
                </div>
              </div>
              <div class="col-12 col-sm-6 col-xl-4">
                <div class="gm-summary h-100">
                  <span>Meetings booked</span>
                  <strong>{{ groupMeetings.length }}</strong>
                  <small>{{ matchReady ? 'Matching can run' : 'No members yet' }}</small>
                </div>
              </div>
            </section>

            <div class="row g-4">
              <div class="col-12 col-xl-8 gm-column">
                <!-- Booked meetings: first, because booking several is the point -->
                <section ref="meetingsSection" class="card gm-card gm-meetings"
                  :class="{ 'gm-card-flash': flashTarget === 'meetings' }" aria-labelledby="gm-meetings-title">
                  <div class="card-body">
                    <div class="section-heading mb-3">
                      <div>
                        <h2 id="gm-meetings-title">Meetings in this group</h2>
                        <p class="gm-help mb-0">
                          Booked meetings block their slot for every participant in later searches.
                        </p>
                      </div>
                      <span class="badge rounded-pill gm-invitation-accepted">
                        {{ groupMeetings.length }} booked
                      </span>
                    </div>

                    <p v-if="!groupMeetings.length" class="gm-help mb-0">
                      No meeting has been booked in this group yet. Book one below and it also appears
                      on your Dashboard timeline.
                    </p>

                    <article v-for="meeting in groupMeetings" :key="meeting.id" class="gm-meeting-row">
                      <div class="gm-meeting-time">
                        <strong>{{ formatTime(meeting.startAt) }}</strong>
                        <small>{{ formatDay(sgDate(meeting.startAt)) }}</small>
                      </div>
                      <div class="gm-record">
                        <strong>{{ meeting.title }}</strong>
                        <p class="gm-help mb-0">
                          {{ formatRange(meeting.startAt, meeting.endAt) }} ·
                          {{ meeting.participantIds.length }} participants
                          <span v-if="meeting.createdByName">
                            · booked by {{ meeting.isMine ? 'you' : meeting.createdByName }}
                          </span>
                        </p>
                      </div>
                      <div class="gm-meeting-actions">
                        <template v-if="confirmingMeetingId === meeting.id">
                          <span class="gm-help">Cancel this meeting?</span>
                          <button type="button" class="btn btn-sm btn-danger"
                            :disabled="busyAction === `cancel-meeting:${meeting.id}`"
                            @click="cancelMeeting(meeting)">
                            {{ busyAction === `cancel-meeting:${meeting.id}` ? 'Cancelling...' : 'Yes, cancel' }}
                          </button>
                          <button type="button" class="btn btn-sm btn-outline-secondary"
                            @click="confirmingMeetingId = ''">
                            Keep it
                          </button>
                        </template>
                        <template v-else>
                          <span v-if="meeting.forced" class="badge rounded-pill gm-invitation-pending"
                            title="Booked despite a clash with someone's calendar">overlap</span>
                          <span class="badge rounded-pill gm-invitation-accepted">{{ meeting.status }}</span>
                          <button v-if="canCancelMeeting(meeting)" type="button"
                            class="btn btn-sm btn-outline-secondary"
                            @click="confirmingMeetingId = meeting.id">
                            Cancel meeting
                          </button>
                        </template>
                      </div>
                    </article>

                    <p class="gm-help mt-3 mb-0">
                      The person who booked a meeting, and the group owner, can cancel it. Cancelling
                      frees the slot again and removes it from the Dashboard timeline.
                    </p>                  </div>
                </section>

                <!-- Search + result + booking, all in one card -->
                <section id="gm-common-times" class="card gm-card gm-results"
                  :class="{ 'gm-card-flash': flashTarget === 'results' }" aria-labelledby="gm-common-title">
                  <div class="card-body">
                    <div class="section-heading mb-3">
                      <div>
                        <h2 id="gm-common-title">Find a common time</h2>
                        <p class="gm-help mb-0">
                          Search the window, then book the slot you want. Times are Singapore time.
                        </p>
                      </div>
                      <span class="badge rounded-pill"
                        :class="matchResult?.status === 'ok' ? 'gm-invitation-accepted' : 'gm-unknown'">
                        {{ matchResult?.status === 'ok' ? `${matchResult.totalSlots} slots` : 'Not calculated' }}
                      </span>
                    </div>

                    <form class="row g-2 align-items-end" @submit.prevent="findCommonTime()">
                      <div class="col-12 col-md-4">
                        <label for="gm-group" class="form-label">Group</label>
                        <select id="gm-group" v-model="selectedGroupId" class="form-select">
                          <option v-for="group in groups" :key="group.id" :value="group.id">
                            {{ group.name }}
                          </option>
                        </select>
                      </div>
                      <div class="col-6 col-md-4">
                        <label for="gm-from" class="form-label">From date</label>
                        <input id="gm-from" v-model="draft.fromDate" type="date" class="form-control" />
                      </div>
                      <div class="col-6 col-md-4">
                        <label for="gm-to" class="form-label">To date</label>
                        <input id="gm-to" v-model="draft.toDate" type="date" class="form-control" />
                      </div>
                      <div class="col-6 col-md-2">
                        <label for="gm-start" class="form-label">Earliest time</label>
                        <input id="gm-start" v-model="draft.startTime" type="time" class="form-control" />
                      </div>
                      <div class="col-6 col-md-2">
                        <label for="gm-end" class="form-label">Latest time</label>
                        <input id="gm-end" v-model="draft.endTime" type="time" class="form-control" />
                      </div>
                      <div class="col-12 col-md-3">
                        <label for="gm-duration" class="form-label">Meeting length</label>
                        <select id="gm-duration" v-model="draft.durationMinutes" class="form-select">
                          <option value="30">30 minutes</option>
                          <option value="60">60 minutes</option>
                          <option value="90">90 minutes</option>
                        </select>
                      </div>
                      <div class="col-12 col-md-5">
                        <button type="submit" class="btn btn-primary w-100" :disabled="matching">
                          {{ matching ? 'Searching...' : 'Find common time' }}
                        </button>
                      </div>
                    </form>

                    <!-- Nothing is shown until a search has been run: an empty
                         "result" block above the booking form was just noise. -->
                    <div v-if="matching || matchError || matchResult" ref="resultsAnchor" tabindex="-1"
                      class="gm-result-area">
                      <div class="section-heading mb-2">
                        <h3 class="gm-subheading mb-0">Result</h3>
                      </div>

                      <div v-if="matching" class="gm-empty" role="status">
                        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                        Comparing calendars...
                      </div>

                      <div v-else-if="matchError" class="alert alert-danger mb-0" role="alert">
                        {{ matchError }}
                      </div>

                      <div v-else-if="matchResult.status === 'blocked'" class="alert alert-warning mb-0"
                        role="alert">
                        <strong>Availability is unknown for {{ matchResult.blockers.length }}
                          {{ matchResult.blockers.length === 1 ? 'member' : 'members' }}.</strong>
                        <p class="mb-2">No result is produced while information is missing, because a
                          missing calendar is not the same as a free calendar.</p>
                        <ul class="mb-0">
                          <li v-for="blocker in matchResult.blockers" :key="blocker.userId">
                            <strong>{{ blocker.name }}</strong> — {{ blocker.message }}
                            <span class="badge rounded-pill gm-unknown ms-1">{{ blockerLabel(blocker.reason) }}</span>
                          </li>
                        </ul>
                      </div>

                      <div v-else-if="!matchResult.totalSlots" class="gm-empty gm-pending">
                        <strong>No shared window of {{ matchResult.window.durationMinutes }} minutes.</strong>
                        <p class="gm-help mb-0">
                          Everyone's calendars were compared and nothing fits. Try a shorter meeting,
                          a wider time window, or more days.
                        </p>
                      </div>

                      <template v-else>
                        <div class="gm-best">
                          <span>Best match</span>
                          <strong>{{ formatDay(matchResult.best.date) }}</strong>
                          <p class="mb-0">{{ formatRange(matchResult.best.startAt, matchResult.best.endAt) }}
                            <span class="gm-help">· Singapore time</span></p>
                          <button type="button" class="btn btn-sm btn-primary mt-2"
                            @click="pickSlot(matchResult.best.date, matchResult.best)">
                            Select this time
                          </button>
                        </div>

                        <div v-for="day in matchResult.days" :key="day.date" class="gm-day">
                          <div class="gm-day-head">
                            <strong>{{ formatDay(day.date) }}</strong>
                            <small class="gm-help">
                              {{ day.freeMinutes }} free minutes together ·
                              {{ day.blocks.reduce((total, block) => total + block.slots.length, 0) }}
                              possible {{ day.blocks.reduce((total, block) => total + block.slots.length, 0) === 1 ? 'start' : 'starts' }}
                            </small>
                          </div>
                          <p v-if="!day.blocks.length" class="gm-help mb-0">No shared window long enough on this day.</p>
                          <div v-for="block in day.blocks" :key="block.startAt" class="gm-block">
                            <div class="gm-block-range">
                              <strong>{{ formatRange(block.startAt, block.endAt) }}</strong>
                              <small class="gm-help">everyone free · {{ block.lengthMinutes }} min ·
                                fits {{ block.maxMeetings }}</small>
                            </div>
                            <div class="gm-slot-list">
                              <button v-for="slot in block.slots.slice(0, 8)" :key="slot.startAt"
                                type="button" class="gm-slot"
                                :class="{ 'gm-slot-tight': slot.startsRightAfterBusy, 'gm-slot-picked': isPickedSlot(day.date, slot) }"
                                :aria-pressed="isPickedSlot(day.date, slot)"
                                :aria-label="`Select ${formatTime(slot.startAt)} on ${formatDay(day.date)}`"
                                @click="pickSlot(day.date, slot)">
                                <span class="gm-slot-time">{{ formatTime(slot.startAt) }}</span>
                                <span class="gm-slot-action">
                                  {{ isPickedSlot(day.date, slot) ? 'Selected' : 'Select' }}
                                </span>
                              </button>
                              <span v-if="block.slots.length > 8" class="gm-slot gm-slot-more">
                                +{{ block.slots.length - 8 }} more
                              </span>
                            </div>
                          </div>
                        </div>

                        <p class="gm-help mt-3 mb-0">
                          Every chip is a start time on a {{ matchResult.window.stepMinutes }} minute grid.
                          Press <strong>Select</strong> to copy that time into the booking form below.
                          A shaded chip starts the moment someone's previous commitment ends.
                        </p>
                      </template>
                    </div>

                    <!-- Booking is always available, searched or not -->
                    <div ref="bookingAnchor" tabindex="-1" class="gm-booking">
                        <div class="section-heading mb-2">
                          <h3 class="gm-subheading mb-0">Book a meeting</h3>
                          <span class="gm-help">{{ members.length }} participants · Singapore time</span>
                        </div>
                        <div class="row g-2 align-items-end">
                          <div class="col-12 col-lg-4">
                            <label for="gm-book-title" class="form-label">Meeting title</label>
                            <input id="gm-book-title" v-model="booking.title" class="form-control"
                              maxlength="80" :placeholder="bookingPlaceholder" />
                          </div>
                          <div class="col-6 col-lg-3">
                            <label for="gm-book-date" class="form-label">Date</label>
                            <input id="gm-book-date" v-model="booking.date" type="date" class="form-control" />
                          </div>
                          <div class="col-6 col-lg-2">
                            <label for="gm-book-start" class="form-label">Start</label>
                            <input id="gm-book-start" v-model="booking.startTime" type="time" class="form-control" />
                          </div>
                          <div class="col-12 col-lg-3">
                            <label for="gm-book-length" class="form-label">Length</label>
                            <select id="gm-book-length" v-model="booking.durationMinutes" class="form-select">
                              <option value="30">30 minutes</option>
                              <option value="60">60 minutes</option>
                              <option value="90">90 minutes</option>
                            </select>
                          </div>
                          <div class="col-12">
                            <button type="button" class="btn btn-primary w-100"
                              :disabled="bookingBusy" @click="bookMeeting">
                              {{ bookingBusy ? 'Booking...' : 'Book this meeting' }}
                            </button>
                          </div>
                        </div>
                        <p class="gm-help mt-2 mb-0">
                          Everyone in the group is invited. The time is checked against every
                          participant's calendar first, so a clash is refused instead of silently booked.
                        </p>
                        <p v-if="bookingError" class="text-danger gm-help mt-2 mb-0" role="alert">
                          {{ bookingError }}
                        </p>
                        <p v-if="bookingNotice" class="text-success gm-help mt-2 mb-0" role="status">
                          {{ bookingNotice }}
                          <RouterLink to="/dashboard" class="gm-text-link">Open Dashboard</RouterLink>
                        </p>
                      </div>
                  </div>
                </section>

                <!-- Planner source -->
                <section class="card gm-card" aria-labelledby="gm-source-title">
                  <div class="card-body">
                    <div class="section-heading mb-3">
                      <div>
                        <h2 id="gm-source-title">Connected schedule source</h2>
                        <p class="gm-help mb-0">
                          Read-only coursework and sample activities. Booked group meetings are listed
                          at the top of this page instead.
                        </p>
                      </div>
                      <button type="button" class="btn btn-outline-secondary btn-sm"
                        :disabled="plannerLoading" @click="loadPlannerData">
                        {{ plannerLoading ? 'Loading...' : 'Reload' }}
                      </button>
                    </div>

                    <div v-if="plannerLoading" class="gm-empty" role="status">
                      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                      Loading planner data...
                    </div>
                    <div v-else-if="plannerError" class="alert alert-danger mb-0" role="alert">
                      {{ plannerError }}
                    </div>
                    <template v-else>
                      <p v-if="!sourceActivities.length" class="gm-help mb-0">
                        No sample activities in the current source.
                      </p>
                      <ul v-else class="gm-source-list list-unstyled mb-0">
                        <li v-for="(activity, index) in sourceActivities" :key="`${activity.id}-${index}`"
                          class="gm-source-item">
                          <div class="gm-record">
                            <strong>{{ activity.title || 'Untitled activity' }}</strong>
                            <p class="gm-help mb-1">{{ activity.place || 'Location not provided' }}</p>
                            <p class="gm-time mb-0">
                              {{ formatDateTime(activity.when) }} &ndash; {{ formatDateTime(activity.end) }}
                            </p>
                          </div>
                          <span class="badge rounded-pill gm-sample">Sample</span>
                        </li>
                      </ul>
                      <div class="gm-context mt-3">
                        <strong>{{ planner.assignments.length }} assignments / {{ planner.quizzes.length }} quizzes</strong>
                        <p class="gm-help mb-0">
                          Due dates are deadlines, not busy intervals, so they are not used for matching.
                        </p>
                        <RouterLink to="/assignments" class="gm-text-link">View coursework</RouterLink>
                      </div>
                    </template>
                  </div>
                </section>
              </div>

              <div class="col-12 col-xl-4 gm-column">
                <!-- Members -->
                <section class="card gm-card d-none d-xl-block" aria-labelledby="gm-members-title">
                  <div class="card-body">
                    <h2 id="gm-members-title">Members</h2>
                    <div v-for="member in members" :key="member.id" class="gm-member">
                      <div class="gm-member-info">
                        <strong>{{ member.name }}</strong>
                        <small class="gm-help d-block">
                          <span v-if="member.isOwner">Owner</span>
                          <span v-if="member.isViewer"> · You</span>
                          <span v-if="member.scheduleStatus !== 'complete'"> · Calendar incomplete</span>
                        </small>
                      </div>
                    </div>
                  </div>
                </section>

                <!-- Invite -->
                <!-- Create group -->
                <section class="card gm-card" aria-labelledby="gm-create-title">
                  <div class="card-body">
                    <h2 id="gm-create-title">Create another group</h2>
                    <label for="gm-new-group" class="form-label">Group name</label>
                    <input id="gm-new-group" v-model="newGroupName" class="form-control"
                      placeholder="e.g. Another project group" maxlength="80" />
                    <button type="button" class="btn btn-outline-secondary mt-3"
                      :disabled="busyAction === 'create'" @click="createGroup">
                      {{ busyAction === 'create' ? 'Creating...' : 'Create group' }}
                    </button>
                    <p v-if="newGroupError" class="text-danger gm-help mt-2 mb-0" role="alert">{{ newGroupError }}</p>
                    <p class="gm-help mt-2 mb-0">You become the owner of the group.</p>
                  </div>
                </section>

                <!-- Invite -->
                <section class="card gm-card gm-invite-panel" aria-labelledby="gm-invite-title">
                  <div class="card-body">
                    <h2 id="gm-invite-title">Invite people</h2>
                    <p class="gm-help">The account must already be registered. Pick the group the
                      invitation belongs to.</p>

                    <label for="gm-invite-group" class="form-label">Group</label>
                    <select id="gm-invite-group" v-model="inviteGroupId" class="form-select">
                      <option v-for="group in groups" :key="group.id" :value="group.id">
                        {{ group.name }}
                      </option>
                    </select>

                    <label for="gm-invite-recipient" class="form-label mt-3">Email address</label>
                    <input id="gm-invite-recipient" v-model="inviteEmail" class="form-control"
                      type="email" placeholder="teammate@smu.edu.sg" maxlength="160" />
                    <button type="button" class="btn btn-primary mt-3"
                      :disabled="busyAction === 'invite'" @click="sendInvitation">
                      {{ busyAction === 'invite' ? 'Sending...' : 'Send invitation' }}
                    </button>
                    <p v-if="inviteError" class="text-danger gm-help mt-2 mb-0" role="alert">{{ inviteError }}</p>
                    <p v-if="inviteNotice" class="text-success gm-help mt-2 mb-0" role="status">{{ inviteNotice }}</p>

                    <h3 class="gm-subheading mt-4">
                      Sent invitations in {{ inviteGroup?.name || 'this group' }}
                    </h3>
                    <p v-if="!sentInvitations.length" class="gm-help mb-0">
                      No invitations sent from this group yet.
                    </p>
                    <div v-for="invitation in sentInvitations" :key="invitation.id"
                      class="gm-sent-invitation" :data-invitation-id="invitation.id">
                      <div class="gm-member-info">
                        <strong>{{ invitation.toUserName }}</strong>
                        <small class="gm-help d-block">{{ formatDateTime(invitation.createdAt) }}</small>
                      </div>
                      <span class="badge rounded-pill text-capitalize"
                        :class="`gm-invitation-${invitation.status}`">{{ invitation.status }}</span>
                      <button v-if="invitation.status === 'pending'" type="button"
                        class="btn btn-sm btn-outline-secondary"
                        :disabled="busyAction === `cancel:${invitation.id}`"
                        @click="respond(invitation, 'cancel')">
                        Cancel
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </template>
        </template>
      </div>
    </main>

    <!-- Invitations, opened from the sidebar bell -->
    <div v-if="bellOpen" ref="bellPanel" class="gm-bell-panel" :style="bellPanelStyle"
      role="dialog" aria-labelledby="gm-bell-title">
      <div class="section-heading mb-2">
        <h2 id="gm-bell-title">Invitations</h2>
        <div class="d-flex align-items-center gap-2">
          <span class="badge rounded-pill"
            :class="pendingCount ? 'gm-invitation-pending' : 'gm-unknown'">
            {{ pendingCount }} awaiting response
          </span>
          <button type="button" class="gm-bell-close" aria-label="Close invitations"
            @click="bellOpen = false">×</button>
        </div>
      </div>

      <p v-if="!incomingInvitations.length" class="gm-help mb-0">
        No invitations yet. Someone needs to invite your account by email.
      </p>

      <article v-for="invitation in incomingInvitations" :key="invitation.id"
        class="gm-invitation-row" :data-invitation-id="invitation.id">
        <div class="gm-record">
          <strong>{{ invitation.groupName }}</strong>
          <p class="gm-help mb-1">
            {{ invitation.fromUserName }} invited you {{ formatDateTime(invitation.createdAt) }}.
          </p>
          <p v-if="invitation.respondedAt" class="gm-help mb-0">
            You responded {{ formatDateTime(invitation.respondedAt) }}.
          </p>
        </div>
        <span class="badge rounded-pill text-capitalize"
          :class="`gm-invitation-${invitation.status}`">{{ invitation.status }}</span>
        <div v-if="invitation.status === 'pending'" class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm btn-primary"
            :disabled="busyAction === `accept:${invitation.id}`"
            @click="respond(invitation, 'accept')">
            {{ busyAction === `accept:${invitation.id}` ? 'Accepting...' : 'Accept invitation' }}
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary"
            :disabled="busyAction === `decline:${invitation.id}`"
            @click="respond(invitation, 'decline')">
            Decline
          </button>
        </div>
      </article>

      <p class="gm-help mt-3 mb-0">
        Accepting adds you to the group.
      </p>
    </div>

    <!-- Confirmation for a booking that is not shared-free -->
    <div v-if="bookingConfirm" class="gm-modal-backdrop" @click.self="bookingConfirm = null"
      @keydown.esc="bookingConfirm = null">
      <div class="gm-modal" role="dialog" aria-modal="true" aria-labelledby="gm-confirm-title">
        <h2 id="gm-confirm-title">This time is not free for everyone</h2>
        <p class="gm-modal-time">
          {{ formatDay(sgDate(bookingConfirm.startAt)) }} ·
          {{ formatRange(bookingConfirm.startAt, bookingConfirm.endAt) }}
        </p>

        <p v-if="bookingConfirm.reason === 'busy'" class="mb-2">
          <strong>{{ confirmBusyNames }}</strong>
          {{ bookingConfirm.conflicts.length === 1 ? 'has' : 'have' }} no free time then — the
          calendar already shows something else.
        </p>
        <p v-else-if="bookingConfirm.reason === 'outside'" class="mb-2">
          This time is not one of the shared free slots from your last search, so it was never
          checked against everyone's calendar.
        </p>
        <p v-else class="mb-2">
          No search has been run for this group, so nobody's availability was checked at all.
        </p>

        <p class="gm-help mb-0">
          Book it anyway? Everyone in the group is still invited, and the overlap is marked on the
          meeting so the clash stays visible.
        </p>

        <div class="gm-modal-actions">
          <button ref="confirmButton" type="button" class="btn btn-primary"
            :disabled="bookingBusy" @click="confirmBooking">
            {{ bookingBusy ? 'Booking...' : 'Book anyway' }}
          </button>
          <button type="button" class="btn btn-outline-secondary" @click="bookingConfirm = null">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gm-sidebar a { color: rgba(255, 255, 255, .9); text-decoration: none; }
.gm-sidebar .disabled-link { cursor: default; opacity: .6; }

/* Sidebar invitation bell */
.gm-bell { position: relative; display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 10px; padding: 12px 14px; border: 0; border-radius: 12px; background: rgba(255, 255, 255, .12); color: #fff; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.gm-bell:hover { background: rgba(255, 255, 255, .22); }
.gm-bell.gm-bell-open, .gm-bell.gm-bell-open:hover { background: #fff; color: var(--brand); }
.gm-bell-icon { font-size: 1rem; line-height: 1; }
.gm-bell-dot { position: absolute; top: 9px; left: 27px; width: 10px; height: 10px; border-radius: 50%; background: #ff4d6d; box-shadow: 0 0 0 2px #6b5ce0; }
.gm-bell-open .gm-bell-dot { box-shadow: 0 0 0 2px #fff; }
.gm-bell-alert { font-weight: 750; }
.gm-bell-mobile { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.gm-bell-mobile .gm-bell-dot { position: static; box-shadow: none; margin-left: 2px; }

.gm-bell-panel { position: fixed; z-index: 1070; width: 380px; max-height: min(520px, calc(100vh - 40px)); overflow-y: auto; padding: 18px; border: 1px solid #e9ebf4; border-radius: 16px; background: #fff; box-shadow: 0 18px 48px rgba(18, 20, 45, .22); }
.gm-bell-panel h2 { margin: 0; font-size: 1.05rem; font-weight: 750; }
.gm-bell-close { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: #f1f2fa; color: #4e5673; font-size: 1.1rem; line-height: 1; cursor: pointer; }
.gm-bell-close:hover { background: #e4e6f5; color: var(--ink); }
.gm-bell-panel .gm-invitation-row:last-of-type { border-bottom: 0; }
@media (max-width: 1000px) { .gm-bell-panel { top: 72px !important; left: 12px; right: 12px; width: auto; max-height: calc(100vh - 96px); } }

.gm-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.gm-page { width: 100%; max-width: 1600px; margin: 0 auto; }
.gm-header h1 { font-size: clamp(1.8rem, 3vw, 2.45rem); font-weight: 750; letter-spacing: -.04em; }
.gm-eyebrow { color: var(--brand); font-size: .7rem; font-weight: 800; letter-spacing: .12em; }
.gm-phase, .gm-sample { background: #ececff; color: #4545ba; }
.gm-unknown { background: #eceefa; color: #555e79; }
.gm-invitation-pending { background: #fff3d6; color: #875800; }
.gm-invitation-accepted { background: #dcf8ef; color: #0a7a5a; }
.gm-invitation-declined, .gm-invitation-cancelled { background: #ffe9ee; color: #a32642; }
.gm-invitation-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 16px 0; border-bottom: 1px solid #e9ecf4; }
.gm-member-info { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
.gm-sent-invitation { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px; padding: 12px 0; border-bottom: 1px dashed #e4e6f5; }
.gm-subheading { font-size: .95rem; }
.gm-notifications .btn { min-height: 40px; }
.gm-phase { padding: .65rem .9rem; }
.gm-summary { padding: 1rem 1.15rem; border: 1px solid #e9ebf4; border-radius: 1rem; background: #fff; }
.gm-summary span, .gm-summary strong, .gm-summary small { display: block; }
.gm-summary span, .gm-summary small, .gm-help { color: #626a83; font-size: .85rem; }
.gm-summary strong { font-size: 1.4rem; margin: .3rem 0; }
.gm-column { min-width: 0; }
.gm-card h2 { font-size: 1.1rem; font-weight: 700; margin: 0 0 .5rem; }
.gm-source-list { display: grid; gap: 10px; }
.gm-source-item { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12px; padding: 14px; background: #f8f9fe; border-left: 4px solid var(--brand); border-radius: 12px; }
.gm-record { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.gm-time { color: #4e5673; font-size: .85rem; }
.gm-context { padding: 14px; background: #f6f7fd; border-radius: 12px; }
.gm-context strong { font-size: .9rem; }
.gm-text-link { display: inline-block; margin-top: 8px; color: #4545ba; }
.gm-empty { padding: 24px 12px; text-align: center; color: #626a83; }
.gm-empty strong { display: block; color: var(--ink); margin-bottom: 8px; }
.gm-pending { border: 1px dashed #d5d9e7; border-radius: 12px; background: #f8f9fe; }
.gm-member { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 0; border-bottom: 1px dashed #e4e6f5; }
.gm-card .form-label { font-size: .85rem; font-weight: 600; }
.gm-card input, .gm-card select { min-width: 0; min-height: 44px; }
.gm-card .btn { min-height: 40px; }
.gm-card :focus-visible, .gm-mobile-nav :focus-visible { outline: 3px solid var(--brand); outline-offset: 3px; }
.gm-best { padding: 16px; border-radius: 14px; background: linear-gradient(135deg, #ececff, #f4f0ff); border: 1px solid #ded9ff; }
.gm-best span { display: block; font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #5b53c9; }
.gm-best strong { display: block; font-size: 1.15rem; margin: 4px 0 2px; }
.gm-day { margin-top: 18px; }
.gm-day-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid #e9ecf4; }
.gm-block { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px; margin-top: 10px; background: #f8f9fe; border-left: 4px solid var(--green); border-radius: 12px; }
.gm-block-range strong { display: block; }
.gm-slot-list { display: flex; flex-wrap: wrap; gap: 8px; }
/* A start time is a button, and it says so: the time alone looked like a label. */
.gm-slot { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px 5px 12px; border: 1px solid #bfe8d8; border-radius: 99px; background: #fff; color: #0a7a5a; font-size: .8rem; font-weight: 700; cursor: pointer; }
.gm-slot:hover { background: #eafaf3; border-color: #8fd9bd; }
.gm-slot-time { font-variant-numeric: tabular-nums; }
.gm-slot-action { padding: 2px 7px; border-radius: 99px; background: #dcf8ef; color: #0a7a5a; font-size: .68rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.gm-slot:hover .gm-slot-action { background: #c3f2e2; }
.gm-slot-tight { border-color: #f0dcae; color: #875800; }
.gm-slot-tight .gm-slot-action { background: #fff3d6; color: #875800; }
.gm-slot-tight:hover { background: #fffaf0; border-color: #e8c987; }
.gm-slot-tight:hover .gm-slot-action { background: #ffe8b8; }
.gm-slot-picked, .gm-slot-picked:hover { background: var(--brand); border-color: var(--brand); color: #fff; }
.gm-slot-picked .gm-slot-action, .gm-slot-picked:hover .gm-slot-action { background: rgba(255, 255, 255, .22); color: #fff; }
.gm-slot-more { border: 0; background: #eceefa; color: #555e79; cursor: default; font-weight: 700; }

/* Result + booking live inside the search card */
.gm-result-area { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid #e9ecf4; scroll-margin-top: 1rem; }
.gm-result-area:focus, .gm-booking:focus { outline: none; }
.gm-booking { margin-top: 1.5rem; padding: 16px; border: 1px dashed #d5d9e7; border-radius: 14px; background: #f8f9fe; scroll-margin-top: 1rem; }
.gm-meeting-row { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; padding: 14px; margin-top: 10px; background: #f8f9fe; border-left: 4px solid var(--green); border-radius: 12px; }
.gm-meeting-time { min-width: 92px; }
.gm-meeting-time strong { display: block; font-size: 1rem; }
.gm-meeting-time small { color: #626a83; font-size: .78rem; }
.gm-meeting-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.gm-meetings { scroll-margin-top: 1rem; }
.gm-meetings:focus { outline: none; }

.gm-card-flash { animation: gm-flash 1.8s ease-out; }
@keyframes gm-flash {
  0% { box-shadow: 0 0 0 3px rgba(91, 91, 240, .6), 0 12px 28px rgba(91, 91, 240, .28); }
  100% { box-shadow: 0 0 0 3px rgba(91, 91, 240, 0); }
}
@media (prefers-reduced-motion: reduce) { .gm-card-flash { animation: none; } }

/* Confirmation dialog */
.gm-modal-backdrop { position: fixed; inset: 0; z-index: 1080; display: grid; place-items: center; padding: 20px; background: rgba(18, 20, 45, .45); }
.gm-modal { width: 100%; max-width: 520px; padding: 24px; border-radius: 18px; background: #fff; box-shadow: 0 24px 60px rgba(18, 20, 45, .28); }
.gm-modal h2 { margin: 0 0 .5rem; font-size: 1.15rem; font-weight: 750; letter-spacing: -.01em; }
.gm-modal p { color: var(--ink); font-size: .92rem; }
.gm-modal .gm-help { color: #626a83; font-size: .85rem; }
.gm-modal-time { padding: 10px 12px; border-radius: 10px; background: #fff3d6; color: #875800; font-weight: 700; font-size: .9rem !important; }
.gm-modal-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 1.25rem; }
.gm-modal-actions .btn { min-height: 42px; }
@media (max-width: 520px) { .gm-modal-actions .btn { flex: 1 1 100%; } }
@media (min-width: 1001px) { .gm-mobile-nav { display: none !important; } }
@media (max-width: 700px) { .app .gm-page { padding: 20px 12px; } .gm-source-item { padding: 12px; } }
</style>

