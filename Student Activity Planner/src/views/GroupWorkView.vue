<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import PlannerNavigation from '@/components/PlannerNavigation.vue'
import PlannerIcon from '@/components/icons/PlannerIcon.vue'
import PlannerCompanion from '@/components/PlannerCompanion.vue'
import GroupAvailabilityGrid from '@/components/GroupAvailabilityGrid.vue'

// Availability is calculated on the server from all members' saved schedules.
// Only free/busy information reaches this page; personal calendar details stay private.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const TIME_ZONE = 'Asia/Singapore'
const route = useRoute()
const router = useRouter()
const pageHeading = ref(null)
const resultsAnchor = ref(null)
const meetingsSection = ref(null)
const bookingAnchor = ref(null)
const bellButton = ref(null)
const bellPanel = ref(null)
const cancelLeaveButton = ref(null)

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
  assignmentBufferMinutes: 60,
})
const matching = ref(false)
const matchError = ref('')
const matchResult = ref(null)
const selectedSlot = ref(null)
const lastUpdated = ref('')
const booking = reactive({ title: '' })
const bookingBusy = ref(false)
const bookingError = ref('')
const bookingNotice = ref('')
const confirmingMeetingId = ref('')
const busyAction = ref('')
const actionError = ref('')
const actionNotice = ref('')
const newGroupName = ref('')
const newGroupError = ref('')
const joinCode = ref('')
const joinError = ref('')
const joining = ref(false)
const copyNotice = ref('')
const inviteEmail = ref('')
const inviteGroupId = ref('')
const inviteError = ref('')
const inviteNotice = ref('')
const bellOpen = ref(false)
const confirmingLeave = ref(false)
const leaving = ref(false)
const leaveError = ref('')
let destroyed = false
let stateRequest = 0
let searchRequest = 0
let bookingRequest = 0
let refreshTimer

const groups = computed(() => state.value?.groups || [])
const selectedGroup = computed(
  () => groups.value.find((group) => group.id === selectedGroupId.value) || null,
)
const members = computed(() => selectedGroup.value?.members || [])
const incomingInvitations = computed(() => state.value?.incomingInvitations || [])
const pendingCount = computed(
  () => incomingInvitations.value.filter((invitation) => invitation.status === 'pending').length,
)
const inviteGroup = computed(
  () => groups.value.find((group) => group.id === inviteGroupId.value) || null,
)
const groupMeetings = computed(() =>
  (state.value?.meetings || []).filter((meeting) => meeting.groupId === selectedGroupId.value),
)
const canJoinDemo = computed(() => state.value?.demo?.canJoin === true)
const sources = computed(() => matchResult.value?.sources)
const suggestedSlots = computed(() => {
  if (matchResult.value?.status !== 'ok') return []
  const availableStarts = new Set(
    (matchResult.value.availability?.days || []).flatMap((day) =>
      day.cells.filter((cell) => cell.canBook).map((cell) => Date.parse(cell.startAt)),
    ),
  )
  const duration = Number(draft.durationMinutes) * 60000
  const picks = []
  for (const day of matchResult.value.days || []) {
    for (const block of day.blocks || []) {
      for (const slot of block.slots || []) {
        if (
          availableStarts.has(Date.parse(slot.startAt)) &&
          !picks.some(
            (pick) => Math.abs(Date.parse(pick.startAt) - Date.parse(slot.startAt)) < duration,
          )
        ) {
          picks.push({ ...slot, date: day.date })
          if (picks.length === 3) return picks
        }
      }
    }
  }
  return picks
})

function messageOf(error) {
  return (
    error?.response?.data?.message || error?.message || 'Something went wrong. Please try again.'
  )
}
function initials(name = '') {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  )
}
function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}
function formatRange(startAt, endAt) {
  return `${formatTime(startAt)} – ${formatTime(endAt)}`
}
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
function formatDay(dateText) {
  const date = new Date(`${dateText}T12:00:00+08:00`)
  if (Number.isNaN(date.getTime())) return dateText
  return date.toLocaleDateString('en-SG', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
function revealElement(element) {
  if (!element) return
  const rect = element.getBoundingClientRect()
  if (rect.top < 0 || rect.top > window.innerHeight * 0.35) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    element.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  element.focus?.({ preventScroll: true })
}
async function focusRequestedMeeting() {
  if (typeof route.query.meeting !== 'string') return
  await nextTick()
  document.getElementById('meeting-' + route.query.meeting)?.scrollIntoView?.({ block: 'center' })
}
function ensureSelection() {
  const requested = typeof route.query.group === 'string' ? route.query.group : ''
  selectedGroupId.value = groups.value.find((group) => String(group.id) === requested)?.id || ''
  if (!groups.value.some((group) => group.id === inviteGroupId.value))
    inviteGroupId.value = selectedGroupId.value
}
async function loadGroupState({ silent = false } = {}) {
  const request = ++stateRequest
  if (!silent || !state.value) loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get(`${API_URL}/group-meetings`, { withCredentials: true })
    if (destroyed || request !== stateRequest) return false
    state.value = data
    if (!draft.fromDate) {
      const defaults = data.defaults
      Object.assign(draft, {
        fromDate: defaults.fromDate,
        toDate: new Date(Date.parse(`${defaults.fromDate}T12:00:00Z`) + 6 * 86400000)
          .toISOString()
          .slice(0, 10),
        startTime: defaults.startTime,
        endTime: defaults.endTime,
        durationMinutes: String(defaults.durationMinutes),
      })
    }
    ensureSelection()
    return true
  } catch (error) {
    if (!destroyed && request === stateRequest) loadError.value = messageOf(error)
    return false
  } finally {
    if (!destroyed && request === stateRequest) {
      loading.value = false
      await focusRequestedMeeting()
    }
  }
}
async function openGroup(groupId) {
  if (!groups.value.some((group) => group.id === groupId)) return
  selectedGroupId.value = groupId
  const query = { ...route.query, group: groupId }
  delete query.meeting
  await router.push({ path: route.path, query, hash: '' })
  if (destroyed) return
  await nextTick()
  revealElement(pageHeading.value)
}
async function returnToGroups() {
  stateRequest++
  loading.value = false
  selectedGroupId.value = ''
  confirmingLeave.value = false
  const query = { ...route.query }
  delete query.group
  delete query.meeting
  await router.replace({ path: route.path, query, hash: '' })
  await nextTick()
  revealElement(pageHeading.value)
}
async function refreshSchedules() {
  const groupId = selectedGroupId.value
  if ((await loadGroupState({ silent: true })) && groupId && groupId === selectedGroupId.value) {
    await findCommonTime({ quiet: true })
  }
}

function invalidateAvailability() {
  searchRequest++
  clearTimeout(refreshTimer)
  matching.value = false
  selectedSlot.value = null
  matchResult.value = null
  matchError.value = ''
  lastUpdated.value = ''
}
watch(selectedGroupId, (groupId) => {
  invalidateAvailability()
  bookingRequest++
  bookingBusy.value = false
  booking.title = ''
  bookingError.value = ''
  bookingNotice.value = ''
  confirmingLeave.value = false
  confirmingMeetingId.value = ''
  copyNotice.value = ''
  inviteError.value = ''
  inviteNotice.value = ''
  inviteGroupId.value = groupId
  if (groupId) findCommonTime({ quiet: true })
})
watch(
  () => Object.values(draft),
  () => {
    invalidateAvailability()
    if (selectedGroupId.value) {
      matching.value = true
      refreshTimer = setTimeout(() => findCommonTime({ quiet: true }), 400)
    }
  },
)
watch(
  () => [route.query.group, route.query.meeting],
  () => {
    if (!state.value) return
    ensureSelection()
    focusRequestedMeeting()
  },
)
async function findCommonTime({ quiet = false } = {}) {
  clearTimeout(refreshTimer)
  const request = ++searchRequest
  const groupId = selectedGroupId.value
  selectedSlot.value = null
  matchError.value = ''
  matchResult.value = null
  if (!groupId || destroyed) {
    matching.value = false
    return
  }
  matching.value = true
  try {
    const { data } = await axios.post(
      `${API_URL}/group-meetings/common-time`,
      {
        groupId,
        fromDate: draft.fromDate,
        toDate: draft.toDate,
        startTime: draft.startTime,
        endTime: draft.endTime,
        durationMinutes: Number(draft.durationMinutes),
        assignmentBufferMinutes: Number(draft.assignmentBufferMinutes),
      },
      { withCredentials: true },
    )
    if (destroyed || request !== searchRequest || groupId !== selectedGroupId.value) return
    matchResult.value = data
    lastUpdated.value = new Date().toLocaleTimeString('en-SG', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch (error) {
    if (destroyed || request !== searchRequest || groupId !== selectedGroupId.value) return
    matchError.value = messageOf(error)
  } finally {
    if (!destroyed && request === searchRequest && groupId === selectedGroupId.value) {
      matching.value = false
      if (!quiet) {
        await nextTick()
        revealElement(resultsAnchor.value)
      }
    }
  }
}
async function pickSlot(date, slot) {
  if (matching.value || bookingBusy.value || matchResult.value?.status !== 'ok') return
  const cell = matchResult.value.availability?.days
    .find((day) => day.date === date)
    ?.cells.find((item) => item.canBook && Date.parse(item.startAt) === Date.parse(slot.startAt))
  if (!cell) return
  selectedSlot.value = {
    date,
    startAt: cell.startAt,
    endAt: new Date(Date.parse(cell.startAt) + Number(draft.durationMinutes) * 60000).toISOString(),
    request: searchRequest,
  }
  bookingError.value = ''
  bookingNotice.value = ''
  await nextTick()
  const bookingBounds = bookingAnchor.value?.getBoundingClientRect()
  if (
    window.innerWidth < 1100 ||
    (bookingBounds && (bookingBounds.bottom < 0 || bookingBounds.top > window.innerHeight))
  ) {
    revealElement(bookingAnchor.value)
  }
  document.getElementById('gm-meeting-title')?.focus({ preventScroll: true })
}
async function bookMeeting() {
  if (bookingBusy.value || matching.value) return
  bookingError.value = ''
  bookingNotice.value = ''
  const groupId = selectedGroupId.value
  const slot = selectedSlot.value
  if (!groupId || !slot || slot.request !== searchRequest) {
    bookingError.value = 'Choose a shared time on the grid first.'
    return
  }
  const title = booking.title.trim()
  if (title.length < 2) {
    bookingError.value = 'Give the meeting a title of at least 2 characters.'
    return
  }
  const request = ++bookingRequest
  const payload = {
    groupId,
    title,
    startAt: slot.startAt,
    endAt: slot.endAt,
    assignmentBufferMinutes: Number(draft.assignmentBufferMinutes),
  }
  const isCurrent = () =>
    !destroyed && request === bookingRequest && groupId === selectedGroupId.value
  bookingBusy.value = true
  try {
    const preview = await axios.post(`${API_URL}/group-meetings/meetings/preview`, payload, {
      withCredentials: true,
    })
    if (!isCurrent() || slot.request !== searchRequest) return
    if (preview.data.conflicts?.length) {
      bookingError.value =
        'A calendar changed and this time is no longer free. Choose another shared time.'
      selectedSlot.value = null
      await findCommonTime({ quiet: true })
      return
    }
    const { data } = await axios.post(
      `${API_URL}/group-meetings/meetings`,
      {
        ...payload,
        force: false,
      },
      { withCredentials: true },
    )
    if (!isCurrent()) return
    selectedSlot.value = null
    booking.title = ''
    bookingNotice.value = `“${data.meeting.title}” is booked for ${formatDay(sgDate(data.meeting.startAt))}, ${formatRange(data.meeting.startAt, data.meeting.endAt)}. It is on everyone’s dashboard calendar now.`
    await loadGroupState({ silent: true })
    if (!isCurrent()) return
    await findCommonTime({ quiet: true })
    if (!isCurrent()) return
    await nextTick()
    revealElement(meetingsSection.value)
  } catch (error) {
    if (!isCurrent()) return
    bookingError.value = messageOf(error)
    if (error?.response?.status === 409) {
      selectedSlot.value = null
      await findCommonTime({ quiet: true })
    }
  } finally {
    if (isCurrent()) bookingBusy.value = false
  }
}
function canCancelMeeting(meeting) {
  return meeting.isMine === true || selectedGroup.value?.isOwner === true
}
async function cancelMeeting(meeting) {
  const groupId = selectedGroupId.value
  const action = `cancel-meeting:${meeting.id}`
  if (busyAction.value === action) return
  actionError.value = ''
  actionNotice.value = ''
  busyAction.value = action
  try {
    await axios.delete(`${API_URL}/group-meetings/meetings/${encodeURIComponent(meeting.id)}`, {
      withCredentials: true,
    })
    if (destroyed) return
    bookingNotice.value = ''
    actionNotice.value = `“${meeting.title}” was cancelled and removed from the team's dashboard calendars.`
    confirmingMeetingId.value = ''
    await loadGroupState({ silent: true })
    if (groupId === selectedGroupId.value) await findCommonTime({ quiet: true })
  } catch (error) {
    if (!destroyed) actionError.value = messageOf(error)
  } finally {
    if (busyAction.value === action) busyAction.value = ''
  }
}

function trapDialogTab(event, dialog) {
  if (event.key !== 'Tab') return
  const controls = [
    ...dialog.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)',
    ),
  ]
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (
    !first ||
    (event.shiftKey && document.activeElement === first) ||
    (!event.shiftKey && document.activeElement === last)
  ) {
    event.preventDefault()
    if (first) (event.shiftKey ? last : first).focus()
  }
}
function toggleBell() {
  bellOpen.value = !bellOpen.value
}
function onInvitationKeydown(event) {
  if (!bellOpen.value || !bellPanel.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    bellOpen.value = false
  } else trapDialogTab(event, bellPanel.value)
}
watch(bellOpen, async (open) => {
  if (open) {
    document.addEventListener('keydown', onInvitationKeydown)
    await nextTick()
    bellPanel.value?.querySelector('button:not(:disabled)')?.focus()
  } else {
    document.removeEventListener('keydown', onInvitationKeydown)
    await nextTick()
    bellButton.value?.focus()
  }
})
function closeLeaveDialog() {
  if (leaving.value) return
  confirmingLeave.value = false
  nextTick(() => document.getElementById('gm-leave-group')?.focus())
}
function onLeaveDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeLeaveDialog()
  } else trapDialogTab(event, event.currentTarget)
}
watch(confirmingLeave, async (open) => {
  if (open) {
    leaveError.value = ''
    await nextTick()
    cancelLeaveButton.value?.focus()
  }
})
async function leaveGroup() {
  if (leaving.value || !selectedGroup.value) return
  const group = selectedGroup.value
  leaving.value = true
  leaveError.value = ''
  actionError.value = ''
  actionNotice.value = ''
  try {
    const { data } = await axios.post(
      `${API_URL}/group-meetings/groups/${encodeURIComponent(group.id)}/leave`,
      {},
      { withCredentials: true },
    )
    if (destroyed) return
    if (group.id === selectedGroupId.value) await returnToGroups()
    await loadGroupState({ silent: true })
    actionNotice.value =
      `You left ${group.name}.` + (data.deleted ? ' The empty group was closed.' : '')
  } catch (error) {
    if (!destroyed) leaveError.value = messageOf(error)
  } finally {
    leaving.value = false
  }
}
async function respond(invitation, action) {
  const pending = `${action}:${invitation.id}`
  if (busyAction.value === pending) return
  actionError.value = ''
  actionNotice.value = ''
  busyAction.value = pending
  try {
    await axios.post(
      `${API_URL}/group-meetings/invitations/${encodeURIComponent(invitation.id)}/${action}`,
      {},
      { withCredentials: true },
    )
    if (destroyed) return
    const labels = {
      accept: `You joined ${invitation.groupName}.`,
      decline: `You declined the invitation to ${invitation.groupName}.`,
      cancel: `Invitation to ${invitation.toUserName} cancelled.`,
    }
    if (action === 'accept') bellOpen.value = false
    if ((await loadGroupState({ silent: true })) && action === 'accept')
      await openGroup(invitation.groupId)
    actionNotice.value = labels[action]
  } catch (error) {
    if (!destroyed) actionError.value = messageOf(error)
  } finally {
    if (busyAction.value === pending) busyAction.value = ''
  }
}
async function sendInvitation() {
  if (busyAction.value === 'invite') return
  inviteError.value = ''
  inviteNotice.value = ''
  const email = inviteEmail.value.trim()
  const groupId = inviteGroupId.value
  const name = inviteGroup.value?.name || 'the group'
  if (!groupId) {
    inviteError.value = 'Choose the group to invite into.'
    return
  }
  if (!email) {
    inviteError.value = 'Enter the email address of a classmate who has an account.'
    return
  }
  busyAction.value = 'invite'
  try {
    await axios.post(
      `${API_URL}/group-meetings/invitations`,
      { groupId, email },
      { withCredentials: true },
    )
    if (destroyed) return
    if (groupId === inviteGroupId.value) {
      inviteNotice.value = `Invitation sent to ${email} for ${name}. They become a member after accepting.`
      inviteEmail.value = ''
    }
    await loadGroupState({ silent: true })
  } catch (error) {
    if (!destroyed && groupId === inviteGroupId.value) inviteError.value = messageOf(error)
  } finally {
    if (busyAction.value === 'invite') busyAction.value = ''
  }
}
async function createGroup() {
  if (busyAction.value === 'create') return
  newGroupError.value = ''
  actionError.value = ''
  const name = newGroupName.value.trim()
  if (name.length < 2) {
    newGroupError.value = 'Give the group a name of at least 2 characters.'
    return
  }
  busyAction.value = 'create'
  try {
    const { data } = await axios.post(
      `${API_URL}/group-meetings/groups`,
      { name },
      { withCredentials: true },
    )
    if (destroyed) return
    newGroupName.value = ''
    if (await loadGroupState({ silent: true })) await openGroup(data.group.id)
    actionNotice.value = `${name} created. Share the group code or invite teammates to get started.`
  } catch (error) {
    if (!destroyed) newGroupError.value = messageOf(error)
  } finally {
    if (busyAction.value === 'create') busyAction.value = ''
  }
}
async function joinWithCode() {
  if (joining.value) return
  joinError.value = ''
  actionNotice.value = ''
  actionError.value = ''
  const code = joinCode.value.trim().toUpperCase()
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    joinError.value = 'Enter the 8-character group code from your teammate.'
    return
  }
  joining.value = true
  try {
    const { data } = await axios.post(
      `${API_URL}/group-meetings/groups/join`,
      { code },
      { withCredentials: true },
    )
    if (destroyed) return
    if (await loadGroupState({ silent: true })) await openGroup(data.group.id)
    joinCode.value = ''
    actionNotice.value = `You joined ${data.group.name}.`
  } catch (error) {
    if (!destroyed) joinError.value = messageOf(error)
  } finally {
    joining.value = false
  }
}
async function copyGroupCode() {
  const group = selectedGroup.value
  if (!group) return
  copyNotice.value = ''
  try {
    await navigator.clipboard.writeText(group.joinCode)
    if (!destroyed && selectedGroupId.value === group.id) copyNotice.value = 'Code copied.'
  } catch {
    if (!destroyed && selectedGroupId.value === group.id)
      copyNotice.value = 'Select the code above and copy it to share with a teammate.'
  }
}
async function joinDemoGroup() {
  if (busyAction.value === 'demo') return
  actionError.value = ''
  busyAction.value = 'demo'
  try {
    const { data } = await axios.post(
      `${API_URL}/group-meetings/demo-group/join`,
      {},
      { withCredentials: true },
    )
    if (destroyed) return
    if (await loadGroupState({ silent: true })) await openGroup(data.group.id)
    actionNotice.value = 'You joined the demo group.'
  } catch (error) {
    if (!destroyed) actionError.value = messageOf(error)
  } finally {
    if (busyAction.value === 'demo') busyAction.value = ''
  }
}
onMounted(() => loadGroupState())
onBeforeUnmount(() => {
  destroyed = true
  stateRequest++
  searchRequest++
  bookingRequest++
  clearTimeout(refreshTimer)
  document.removeEventListener('keydown', onInvitationKeydown)
})
</script>

<template>
  <div class="app gm-app">
    <PlannerNavigation active="/groupwork" />
    <main class="main gm-main">
      <div class="gm-wrap">
        <PlannerNavigation active="/groupwork" mobile />
        <nav class="gm-topbar" aria-label="Group navigation">
          <div class="gm-backlinks">
            <button
              v-if="selectedGroup"
              type="button"
              class="gm-text-button"
              @click="returnToGroups"
            >
              <PlannerIcon name="left" /> Back to groups
            </button>
            <RouterLink to="/dashboard" class="gm-text-button">Back to dashboard</RouterLink>
          </div>
          <button
            ref="bellButton"
            type="button"
            class="gm-notification-button"
            :aria-expanded="bellOpen"
            @click="toggleBell"
          >
            <PlannerIcon name="bell" /> Invitations
            <span v-if="pendingCount" class="gm-count">{{ pendingCount }}</span>
          </button>
        </nav>

        <header class="gm-hero" :class="{ 'gm-hero-detail': selectedGroup }">
          <div class="gm-hero-copy">
            <p class="gm-kicker">
              {{
                selectedGroup
                  ? 'YOUR PEOPLE. ONE PERFECT TIME.'
                  : 'LESS BACK-AND-FORTH. MORE TOGETHER.'
              }}
            </p>
            <h1 ref="pageHeading" tabindex="-1">{{ selectedGroup?.name || 'Group Meetings' }}</h1>
            <p class="gm-intro">
              {{
                selectedGroup
                  ? 'Your schedules, already compared. Find the overlap and make it a date.'
                  : 'Good things happen when your calendars align. Bring your people, we’ll find the time.'
              }}
            </p>
            <div v-if="selectedGroup" class="gm-hero-meta">
              <span class="gm-dot"></span>{{ members.length }}
              {{ members.length === 1 ? 'member' : 'members' }}<span>/</span>Singapore time · UTC+8
            </div>
            <div v-else class="gm-journey">
              <span><b>01</b> Gather your people</span><i></i><span><b>02</b> Find the overlap</span
              ><i></i><span><b>03</b> Make a plan</span>
            </div>
          </div>
          <div v-if="!selectedGroup" class="gm-hero-art" aria-hidden="true">
            <div class="gm-orbit gm-orbit-one"></div>
            <div class="gm-orbit gm-orbit-two"></div>
            <div class="gm-mini-calendar">
              <span class="gm-mini-dots">● ● ●</span><strong>A little room for everyone.</strong>
              <div>
                <i
                  v-for="n in 28"
                  :key="n"
                  :class="{ free: [3, 4, 9, 10, 11, 16, 17, 18, 24, 25].includes(n) }"
                ></i>
              </div>
              <small><span></span> That’s your sweet spot.</small>
            </div>
            <span class="gm-art-spark">✳</span>
          </div>
          <div v-else class="gm-share-card">
            <span>INVITE YOUR PEOPLE</span>
            <div>
              <code class="gm-group-code" aria-label="Group join code">{{
                selectedGroup.joinCode
              }}</code
              ><button type="button" class="gm-copy-button" @click="copyGroupCode">
                Copy code
              </button>
            </div>
            <small role="status">{{
              copyNotice || 'Share the code. Their calendar does the rest.'
            }}</small>
          </div>
        </header>
        <PlannerCompanion character="mint" message="Good plans are better together." />

        <div v-if="actionNotice" class="gm-message gm-success" role="status">
          {{ actionNotice }}
        </div>
        <div v-if="actionError || loadError" class="gm-message gm-error" role="alert">
          {{ actionError || loadError
          }}<button v-if="loadError" type="button" @click="refreshSchedules">Try again</button>
        </div>
        <div v-if="loading" class="gm-loading" role="status">
          <span class="gm-spinner"></span> Gathering your groups…
        </div>

        <template v-else-if="state">
          <template v-if="!selectedGroup">
            <section class="gm-circles" aria-labelledby="gm-groups-title">
              <div class="gm-section-heading">
                <div>
                  <p class="gm-kicker">BETTER WITH YOUR PEOPLE</p>
                  <h2 id="gm-groups-title">
                    Your groups <span>{{ groups.length }}</span>
                  </h2>
                </div>
                <span class="gm-soft-label">A shared space for every team</span>
              </div>
              <ul v-if="groups.length" class="gm-group-list">
                <li
                  v-for="(group, index) in groups"
                  :key="group.id"
                  class="gm-group-card"
                  :class="`gm-tone-${index % 3}`"
                >
                  <div class="gm-group-card-top">
                    <span class="gm-group-mark"><PlannerIcon name="users" /></span
                    ><span class="gm-role">{{
                      group.isOwner ? 'You’re the owner' : 'Member'
                    }}</span>
                  </div>
                  <h3>{{ group.name }}</h3>
                  <p>
                    {{ group.members.length }}
                    {{ group.members.length === 1 ? 'member' : 'members' }} · Your next plan starts
                    here
                  </p>
                  <div class="gm-group-card-footer">
                    <div class="gm-avatars" aria-hidden="true">
                      <span
                        v-for="(member, i) in group.members.slice(0, 4)"
                        :key="member.id"
                        :class="`gm-avatar-${i % 4}`"
                        >{{ initials(member.name) }}</span
                      ><span v-if="group.members.length > 4">+{{ group.members.length - 4 }}</span>
                    </div>
                    <button
                      type="button"
                      class="gm-open-button"
                      :aria-label="`Open ${group.name}`"
                      @click="openGroup(group.id)"
                    >
                      Open group <PlannerIcon name="arrow" />
                    </button>
                  </div>
                </li>
              </ul>
              <div v-else class="gm-empty-team">
                <span class="gm-empty-mark"><PlannerIcon name="users" /></span>
                <h3>A good plan starts with a few good people.</h3>
                <p>Create your first group below, or jump in with a teammate’s code.</p>
              </div>
            </section>
            <div class="gm-entry-grid">
              <section class="gm-panel gm-create-panel" aria-labelledby="gm-start-title">
                <span class="gm-entry-icon">+</span>
                <p class="gm-kicker">MAKE ROOM FOR YOUR TEAM</p>
                <h2 id="gm-start-title">
                  {{ groups.length ? 'Create a group' : 'Start a group' }}
                </h2>
                <p>A project crew, a study circle, or your next big idea. Give it a home.</p>
                <form @submit.prevent="createGroup">
                  <label for="gm-first-group">Group name</label>
                  <div class="gm-input-action">
                    <input
                      id="gm-first-group"
                      v-model="newGroupName"
                      placeholder="e.g. The deadline dream team"
                      maxlength="80"
                    /><button class="gm-button gm-primary" :disabled="busyAction === 'create'">
                      {{ busyAction === 'create' ? 'Creating…' : 'Create group' }}
                    </button>
                  </div>
                </form>
                <p v-if="newGroupError" class="gm-inline-error" role="alert">{{ newGroupError }}</p>
                <small>You’ll get a code to share as soon as you create it.</small>
              </section>
              <section class="gm-panel gm-join-panel" aria-labelledby="gm-join-title">
                <span class="gm-entry-icon">↗</span>
                <p class="gm-kicker">YOUR PEOPLE ARE WAITING</p>
                <h2 id="gm-join-title">Join with code</h2>
                <p>Already have an invite? Eight characters and you’re part of the plan.</p>
                <form @submit.prevent="joinWithCode">
                  <label for="gm-join-code">Group code</label>
                  <div class="gm-input-action">
                    <input
                      id="gm-join-code"
                      v-model.trim="joinCode"
                      class="gm-code-input"
                      placeholder="e.g. ABCD2345"
                      maxlength="10"
                      autocomplete="off"
                      autocapitalize="characters"
                      :spellcheck="false"
                      :disabled="joining"
                      :aria-invalid="Boolean(joinError)"
                      :aria-describedby="joinError ? 'gm-join-error' : undefined"
                    /><button class="gm-button gm-dark" :disabled="joining">
                      {{ joining ? 'Joining…' : 'Join group' }}
                    </button>
                  </div>
                </form>
                <p v-if="joinError" id="gm-join-error" class="gm-inline-error" role="alert">
                  {{ joinError }}
                </p>
                <small>Availability fills itself from your saved schedule.</small>
              </section>
            </div>
            <button
              v-if="canJoinDemo"
              class="gm-demo-button"
              :disabled="busyAction === 'demo'"
              @click="joinDemoGroup"
            >
              Just exploring? Try a demo group <PlannerIcon name="arrow" />
            </button>
          </template>

          <template v-else>
            <div class="gm-group-toolbar">
              <div>
                <label for="gm-group">YOUR GROUP</label
                ><select
                  id="gm-group"
                  :value="selectedGroupId"
                  @change="openGroup($event.target.value)"
                >
                  <option v-for="group in groups" :key="group.id" :value="group.id">
                    {{ group.name }}
                  </option>
                </select>
              </div>
              <div class="gm-toolbar-actions">
                <button
                  type="button"
                  class="gm-text-button"
                  :disabled="matching"
                  @click="refreshSchedules"
                >
                  <span class="gm-refresh-symbol">↻</span> Refresh schedules</button
                ><button
                  id="gm-leave-group"
                  type="button"
                  class="gm-leave-button"
                  @click="confirmingLeave = true"
                >
                  Leave group
                </button>
              </div>
            </div>
            <div v-if="members.length === 1" class="gm-solo-note">
              <span>✳</span>
              <p>
                Just you for now. <strong>Share your group code</strong> to find a time with your
                team.
              </p>
            </div>
            <div class="gm-planner-layout">
              <div class="gm-planner-main">
                <section
                  ref="resultsAnchor"
                  tabindex="-1"
                  class="gm-panel gm-availability-panel"
                  aria-labelledby="gm-availability-title"
                >
                  <div class="gm-section-heading">
                    <div>
                      <p class="gm-kicker">THE SWEET SPOT</p>
                      <h2 id="gm-availability-title">
                        Find your overlap <span class="gm-live-pill">Auto-filled</span>
                      </h2>
                    </div>
                    <span class="gm-timezone">SGT / UTC+8</span>
                  </div>
                  <p class="gm-panel-description">
                    Activities, deadlines, and existing meetings are already taken into account.
                  </p>
                  <form class="gm-search-form" @submit.prevent="findCommonTime()">
                    <div class="gm-date-row">
                      <div>
                        <label for="gm-from">From</label
                        ><input id="gm-from" v-model="draft.fromDate" type="date" />
                      </div>
                      <span class="gm-date-arrow">→</span>
                      <div>
                        <label for="gm-to">To</label
                        ><input id="gm-to" v-model="draft.toDate" type="date" />
                      </div>
                      <fieldset class="gm-duration-picker">
                        <legend>Meeting length</legend>
                        <div>
                          <button
                            v-for="duration in [30, 60, 90]"
                            :key="duration"
                            type="button"
                            :class="{ active: Number(draft.durationMinutes) === duration }"
                            :aria-pressed="Number(draft.durationMinutes) === duration"
                            @click="draft.durationMinutes = String(duration)"
                          >
                            {{ duration }}<small> min</small>
                          </button>
                        </div>
                      </fieldset>
                    </div>
                    <details class="gm-preferences">
                      <summary>
                        Hours &amp; deadline buffer
                        <span
                          >{{ draft.startTime }}–{{ draft.endTime }} ·
                          {{ draft.assignmentBufferMinutes }} min buffer</span
                        >
                      </summary>
                      <div class="gm-preferences-fields">
                        <div>
                          <label for="gm-start">Earliest time</label
                          ><input id="gm-start" v-model="draft.startTime" type="time" />
                        </div>
                        <div>
                          <label for="gm-end">Latest time</label
                          ><input id="gm-end" v-model="draft.endTime" type="time" />
                        </div>
                        <div>
                          <label for="gm-buffer">Before unfinished deadlines</label
                          ><select id="gm-buffer" v-model.number="draft.assignmentBufferMinutes">
                            <option
                              v-for="buffer in [0, 30, 60, 90, 120]"
                              :key="buffer"
                              :value="buffer"
                            >
                              {{ buffer ? `${buffer} minutes` : 'No buffer' }}
                            </option>
                          </select>
                        </div>
                      </div>
                      <p>
                        We reserve this time before each unfinished assignment or quiz deadline.
                        Completed work is excluded. All times are in Singapore time.
                      </p>
                    </details>
                  </form>
                  <div v-if="matchError" class="gm-message gm-error" role="alert">
                    {{ matchError
                    }}<button type="button" @click="findCommonTime()">Try again</button>
                  </div>
                  <div
                    v-else-if="matchResult?.status === 'blocked'"
                    class="gm-blocked"
                    role="status"
                  >
                    <h3>A few calendars need a little attention.</h3>
                    <p>We’ll show shared times once the missing schedule information is ready.</p>
                    <ul>
                      <li v-for="blocker in matchResult.blockers" :key="blocker.userId">
                        {{ blocker.message }}
                      </li>
                    </ul>
                  </div>
                  <template v-else
                    ><div class="gm-grid-heading">
                      <b>{{
                        matching
                          ? 'Checking your calendars…'
                          : matchResult
                            ? `${matchResult.totalSlots}${matchResult.truncated ? '+' : ''} possible starting times`
                            : 'Getting your calendars ready…'
                      }}</b
                      ><small v-if="lastUpdated && !matching">Updated {{ lastUpdated }}</small>
                    </div>
                    <GroupAvailabilityGrid
                      :availability="matchResult?.availability || null"
                      :members="matchResult?.members || members"
                      :loading="matching"
                      :selected-start="selectedSlot?.startAt || ''"
                      :duration-minutes="Number(draft.durationMinutes)"
                      @select="(slot) => pickSlot(slot.date, slot)"
                    />
                    <div
                      v-if="matchResult?.status === 'ok' && !matchResult.totalSlots"
                      class="gm-no-overlap"
                      role="status"
                    >
                      <strong>No overlap in this window.</strong>
                      <p>Try 30 minutes, a wider time range, or a smaller deadline buffer.</p>
                    </div></template
                  >
                  <div v-if="sources" class="gm-source-strip">
                    <span class="gm-dot"></span>{{ sources.activities }} activities ·
                    {{ (sources.assignments || 0) + (sources.quizzes || 0) }} unfinished deadlines ·
                    {{ sources.meetings }} meetings checked
                  </div>
                </section>
                <section
                  v-if="suggestedSlots.length && !matching"
                  class="gm-suggestions"
                  aria-labelledby="gm-suggestions-title"
                >
                  <div class="gm-section-heading">
                    <h2 id="gm-suggestions-title">A few good moments</h2>
                    <span>All {{ members.length }} members free</span>
                  </div>
                  <div class="gm-suggestion-list">
                    <button
                      v-for="(slot, index) in suggestedSlots"
                      :key="slot.startAt"
                      type="button"
                      :class="{ picked: selectedSlot?.startAt === slot.startAt }"
                      :aria-pressed="selectedSlot?.startAt === slot.startAt"
                      @click="pickSlot(slot.date, slot)"
                    >
                      <span class="gm-suggestion-label">{{
                        index === 0 ? 'EARLIEST MATCH' : 'ANOTHER GOOD FIT'
                      }}</span
                      ><strong>{{ formatDay(slot.date) }}</strong
                      ><span>{{ formatRange(slot.startAt, slot.endAt) }}</span
                      ><i>Choose this time <PlannerIcon name="arrow" /></i>
                    </button>
                  </div>
                </section>
                <section
                  ref="meetingsSection"
                  tabindex="-1"
                  class="gm-panel gm-meetings"
                  aria-labelledby="gm-meetings-title"
                >
                  <div class="gm-section-heading">
                    <div>
                      <p class="gm-kicker">IT’S A DATE</p>
                      <h2 id="gm-meetings-title">
                        On the calendar <span>{{ groupMeetings.length }}</span>
                      </h2>
                    </div>
                    <RouterLink to="/dashboard" class="gm-text-button"
                      >Your dashboard <PlannerIcon name="arrow"
                    /></RouterLink>
                  </div>
                  <p v-if="!groupMeetings.length" class="gm-meeting-empty">
                    Nothing booked just yet. Pick a green time and turn an overlap into a plan.
                  </p>
                  <article
                    v-for="meeting in groupMeetings"
                    :id="'meeting-' + meeting.id"
                    :key="meeting.id"
                    class="gm-meeting-row"
                    :class="{ 'gm-requested-meeting': String(meeting.id) === route.query.meeting }"
                  >
                    <div class="gm-meeting-date">
                      <span>{{
                        new Date(meeting.startAt).toLocaleDateString('en-SG', {
                          timeZone: TIME_ZONE,
                          weekday: 'short',
                        })
                      }}</span
                      ><strong>{{
                        new Date(meeting.startAt).toLocaleDateString('en-SG', {
                          timeZone: TIME_ZONE,
                          day: 'numeric',
                        })
                      }}</strong>
                    </div>
                    <div class="gm-meeting-copy">
                      <h3>{{ meeting.title }}</h3>
                      <p>
                        {{ formatDay(sgDate(meeting.startAt)) }} ·
                        {{ formatRange(meeting.startAt, meeting.endAt) }}
                      </p>
                      <small
                        >{{ meeting.participantIds.length }} calendars ·
                        {{
                          Date.parse(meeting.endAt) < Date.now() ? 'Past meeting' : 'Group meeting'
                        }}</small
                      >
                    </div>
                    <div v-if="canCancelMeeting(meeting)" class="gm-meeting-actions">
                      <template v-if="confirmingMeetingId === meeting.id"
                        ><button
                          type="button"
                          class="gm-leave-button"
                          :disabled="busyAction === `cancel-meeting:${meeting.id}`"
                          @click="cancelMeeting(meeting)"
                        >
                          Confirm cancel</button
                        ><button
                          type="button"
                          class="gm-text-button"
                          @click="confirmingMeetingId = ''"
                        >
                          Keep
                        </button></template
                      ><button
                        v-else
                        type="button"
                        class="gm-text-button"
                        :aria-label="`Cancel ${meeting.title}`"
                        @click="confirmingMeetingId = meeting.id"
                      >
                        Cancel
                      </button>
                    </div>
                  </article>
                </section>
              </div>
              <aside class="gm-planner-aside">
                <section
                  ref="bookingAnchor"
                  tabindex="-1"
                  class="gm-booking-panel"
                  aria-labelledby="gm-booking-title"
                >
                  <span class="gm-booking-spark" aria-hidden="true">✳</span>
                  <p class="gm-kicker">FROM “MAYBE” TO “SEE YOU”</p>
                  <h2 id="gm-booking-title">Make it a date.</h2>
                  <p class="gm-booking-intro">One plan, on everyone’s calendar.</p>
                  <div v-if="selectedSlot" class="gm-chosen-time">
                    <span>YOUR SHARED TIME</span><strong>{{ formatDay(selectedSlot.date) }}</strong
                    ><b>{{ formatRange(selectedSlot.startAt, selectedSlot.endAt) }}</b
                    ><small
                      >{{ draft.durationMinutes }} minutes · {{ members.length }}/{{
                        members.length
                      }}
                      members free</small
                    >
                  </div>
                  <div v-else class="gm-pick-prompt">
                    <PlannerIcon name="calendar" /><strong>Your time goes here.</strong>
                    <p>Select a green slot on the grid or a suggested time below it.</p>
                  </div>
                  <form @submit.prevent="bookMeeting">
                    <label for="gm-meeting-title">What’s the plan?</label
                    ><input
                      id="gm-meeting-title"
                      v-model="booking.title"
                      placeholder="e.g. Project catch-up"
                      maxlength="80"
                      :disabled="bookingBusy"
                    /><button
                      type="submit"
                      class="gm-button gm-primary gm-book-button"
                      :disabled="!selectedSlot || bookingBusy || matching"
                    >
                      {{ bookingBusy ? 'Adding to calendars…' : 'Add to everyone’s calendar'
                      }}<PlannerIcon v-if="!bookingBusy" name="arrow" />
                    </button>
                  </form>
                  <p v-if="bookingError" class="gm-inline-error" role="alert">{{ bookingError }}</p>
                  <div v-if="bookingNotice" class="gm-booked-notice" role="status">
                    <strong>You’re all set.</strong>
                    <p>{{ bookingNotice }}</p>
                    <RouterLink to="/dashboard">View your dashboard →</RouterLink>
                  </div>
                  <small class="gm-booking-footnote"
                    >We’ll check everyone’s schedule once more before saving.</small
                  >
                  <div class="gm-room-option">
                    <h3>Need a room?</h3>
                    <p>Find and book a project meeting room through SMU.</p>
                    <a
                      class="gm-button gm-secondary"
                      href="https://fbs.intranet.smu.edu.sg/home"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Book a meeting room on SMU’s booking site (opens in a new tab)"
                    >
                      Book a meeting room <span aria-hidden="true">↗</span>
                    </a>
                    <small>Opens SMU’s booking site in a new tab.</small>
                  </div>
                </section>
                <section class="gm-panel gm-members-panel" aria-labelledby="gm-members-title">
                  <div class="gm-section-heading">
                    <h2 id="gm-members-title">The people</h2>
                    <span class="gm-member-count">{{ members.length }}</span>
                  </div>
                  <ul>
                    <li v-for="(member, index) in members" :key="member.id">
                      <span class="gm-avatar" :class="`gm-avatar-${index % 4}`">{{
                        initials(member.name)
                      }}</span>
                      <div>
                        <strong
                          >{{ member.name }}<small v-if="member.isViewer"> (you)</small></strong
                        ><span>{{ member.isOwner ? 'Group owner' : 'Team member' }}</span>
                      </div>
                      <span
                        class="gm-member-status"
                        :class="{ incomplete: member.scheduleStatus !== 'complete' }"
                        :title="
                          member.scheduleStatus === 'complete'
                            ? 'Calendar connected'
                            : 'Calendar needs attention'
                        "
                        :aria-label="
                          member.scheduleStatus === 'complete'
                            ? 'Calendar connected'
                            : 'Calendar needs attention'
                        "
                      ></span>
                    </li>
                  </ul>
                  <p>Availability is shared. The details in each calendar stay private.</p>
                  <details class="gm-email-invite">
                    <summary>Prefer an email invite?</summary>
                    <form @submit.prevent="sendInvitation">
                      <label for="gm-invite-group">Group</label
                      ><select id="gm-invite-group" v-model="inviteGroupId">
                        <option v-for="group in groups" :key="group.id" :value="group.id">
                          {{ group.name }}
                        </option></select
                      ><label for="gm-invite-recipient">Registered email</label
                      ><input
                        id="gm-invite-recipient"
                        v-model="inviteEmail"
                        type="email"
                        placeholder="teammate@smu.edu.sg"
                        required
                      /><button class="gm-button gm-secondary" :disabled="busyAction === 'invite'">
                        Send invitation
                      </button>
                    </form>
                    <p v-if="inviteError" class="gm-inline-error" role="alert">{{ inviteError }}</p>
                    <p v-if="inviteNotice" role="status">{{ inviteNotice }}</p>
                  </details>
                </section>
                <div class="gm-how-it-works">
                  <span>↗</span>
                  <div>
                    <strong>Your schedules do the talking.</strong>
                    <p>
                      Saved activities block busy time. Unfinished deadlines get a little breathing
                      room. Green means the whole team can make it.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </template>
        </template>
        <footer class="gm-footer">
          <span>Less scheduling. More doing things together.</span
          ><span>All times in Singapore · UTC+8</span>
        </footer>
      </div>
    </main>
    <div
      v-if="confirmingLeave && selectedGroup"
      class="gm-modal-backdrop"
      @click.self="closeLeaveDialog"
    >
      <div
        class="gm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gm-leave-title"
        aria-describedby="gm-leave-description"
        @keydown="onLeaveDialogKeydown"
      >
        <h2 id="gm-leave-title">Leave {{ selectedGroup.name }}?</h2>
        <p id="gm-leave-description">
          You will be removed from this group's meetings and availability matching.
        </p>
        <p v-if="members.length === 1">
          You are the last member. Leaving will close the group and remove its meetings.
        </p>
        <p v-else-if="selectedGroup.isOwner">
          Ownership will pass to another member so the group can keep meeting.
        </p>
        <p v-if="leaveError" class="gm-inline-error" role="alert">{{ leaveError }}</p>
        <div class="gm-modal-actions">
          <button
            ref="cancelLeaveButton"
            type="button"
            class="gm-button gm-secondary"
            :disabled="leaving"
            @click="closeLeaveDialog"
          >
            Stay in group</button
          ><button
            id="gm-confirm-leave"
            type="button"
            class="gm-button gm-danger"
            :disabled="leaving"
            @click="leaveGroup"
          >
            {{ leaving ? 'Leaving…' : 'Leave group' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="bellOpen" class="gm-modal-backdrop" @click.self="bellOpen = false">
      <div
        ref="bellPanel"
        class="gm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gm-invitations-title"
        @keydown.esc="bellOpen = false"
      >
        <div class="gm-section-heading">
          <h2 id="gm-invitations-title">Your invitations</h2>
          <button
            type="button"
            class="gm-text-button"
            aria-label="Close invitations"
            @click="bellOpen = false"
          >
            ✕
          </button>
        </div>
        <p v-if="!incomingInvitations.length">
          No invitations yet. Join a group with a code, or ask a teammate to invite your email.
        </p>
        <article
          v-for="invitation in incomingInvitations"
          :key="invitation.id"
          class="gm-invitation-row"
        >
          <h3>{{ invitation.groupName }}</h3>
          <p>{{ invitation.fromUserName }} invited you to the group.</p>
          <div v-if="invitation.status === 'pending'" class="gm-modal-actions">
            <button
              class="gm-button gm-primary"
              :disabled="busyAction === `accept:${invitation.id}`"
              @click="respond(invitation, 'accept')"
            >
              Accept invitation</button
            ><button
              class="gm-button gm-secondary"
              :disabled="busyAction === `decline:${invitation.id}`"
              @click="respond(invitation, 'decline')"
            >
              Decline
            </button>
          </div>
          <small v-else>{{ invitation.status }}</small>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gm-app {
  --gm-paper: #f7f8f5;
  --gm-ink: #243e3b;
  --gm-muted: #6d7c76;
  --gm-line: #e2e8e1;
  --gm-purple: #7153ad;
  background: var(--gm-paper);
  color: var(--gm-ink);
}
.app .gm-main {
  padding: 26px 34px;
}
.gm-wrap {
  max-width: 1500px;
  margin: auto;
}
.gm-app button,
.gm-app input,
.gm-app select {
  font: inherit;
}
.gm-app button {
  cursor: pointer;
}
.gm-app button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.gm-app :is(button, a, input, select, summary):focus-visible {
  outline: 3px solid #a58ad5;
  outline-offset: 3px;
}
.gm-app :is(h1, section):focus {
  outline: none;
}
.gm-topbar,
.gm-backlinks,
.gm-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.gm-topbar {
  justify-content: space-between;
  margin-bottom: 26px;
}
.gm-text-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--gm-muted);
  font-size: 0.78rem !important;
  text-decoration: none;
}
.gm-text-button:hover {
  color: var(--gm-purple);
}
.gm-notification-button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 13px;
  border: 1px solid var(--gm-line);
  border-radius: 99px;
  background: white;
  color: var(--gm-ink);
  font-size: 0.76rem !important;
}
.gm-notification-button :deep(svg) {
  width: 19px;
  height: 19px;
}
.gm-count {
  padding: 2px 6px;
  background: var(--gm-purple);
  border-radius: 50%;
  color: white;
  font-size: 0.65rem;
}
.gm-hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  overflow: hidden;
  padding: 36px 40px;
  margin-bottom: 30px;
  border: 1px solid #e4deed;
  border-radius: 26px;
  background: linear-gradient(118deg, #eee9fa, #f5eff6 54%, #fbf1e2);
}
.gm-hero-copy {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}
.gm-kicker {
  margin: 0 0 10px;
  color: var(--gm-purple);
  font-size: 0.61rem;
  font-weight: 750;
  letter-spacing: 0.13em;
}
.gm-app .gm-hero h1 {
  font-size: clamp(2.1rem, 3.5vw, 3.5rem);
  font-weight: 700;
  letter-spacing: -0.065em;
  margin: 0 0 16px;
  overflow-wrap: anywhere;
}
.gm-intro {
  max-width: 480px;
  margin: 0;
  color: #64716c;
  font-size: 0.9rem;
  line-height: 1.8;
}
.gm-journey {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 27px;
  font-size: 0.67rem;
  color: #6f697d;
}
.gm-journey span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.gm-journey b {
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  border: 1px solid #dcd2e9;
  border-radius: 50%;
  font-size: 0.6rem;
}
.gm-journey i {
  width: 20px;
  height: 1px;
  background: #cfc6dc;
}
.gm-hero-art {
  position: relative;
  flex: 0 0 270px;
  height: 208px;
  margin: 0 30px 0 8px;
}
.gm-orbit {
  position: absolute;
  border-radius: 50%;
}
.gm-orbit-one {
  width: 168px;
  height: 168px;
  background: #dfcfee;
  right: -25px;
  top: -15px;
}
.gm-orbit-two {
  width: 115px;
  height: 115px;
  background: #d3e9d9;
  left: -20px;
  bottom: -18px;
}
.gm-mini-calendar {
  position: relative;
  width: 250px;
  padding: 14px 18px;
  border: 1px solid white;
  border-radius: 16px;
  transform: rotate(-6deg);
  background: #fffffff0;
  box-shadow: 0 14px 30px #674a7c13;
}
.gm-mini-dots {
  display: block;
  color: #b7a6ce;
  letter-spacing: 3px;
  font-size: 0.4rem;
  margin-bottom: 12px;
}
.gm-mini-calendar strong {
  display: block;
  font-size: 0.73rem;
  margin-bottom: 12px;
}
.gm-mini-calendar > div {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 5px;
}
.gm-mini-calendar i {
  height: 15px;
  border-radius: 4px;
  background: #eeeaf2;
}
.gm-mini-calendar i.free {
  background: #8bc5a9;
}
.gm-mini-calendar small {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: #73816c;
  font-size: 0.6rem;
}
.gm-mini-calendar small span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5ca686;
}
.gm-art-spark {
  position: absolute;
  right: -15px;
  bottom: 15px;
  font-size: 3.7rem;
  line-height: 1;
  color: #ae83be;
}
.gm-hero-detail {
  padding: 28px 32px;
}
.gm-hero-detail h1 {
  font-size: clamp(1.9rem, 3vw, 2.9rem) !important;
}
.gm-hero-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 18px;
  color: #6a736b;
  font-size: 0.7rem;
}
.gm-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: #65a48a;
}
.gm-share-card {
  flex: 0 0 auto;
  padding: 19px 22px;
  border: 1px solid #ffffffaa;
  border-radius: 16px;
  background: #ffffff91;
}
.gm-share-card > span {
  font-size: 0.57rem;
  letter-spacing: 0.12em;
  color: #7c718c;
  font-weight: 700;
}
.gm-share-card > div {
  display: flex;
  align-items: center;
  gap: 15px;
  margin: 10px 0;
}
.gm-group-code {
  font:
    700 1.25rem ui-monospace,
    monospace;
  letter-spacing: 0.15em;
  color: #7153ad;
  user-select: all;
}
.gm-copy-button {
  border: 1px solid #d6cce5;
  border-radius: 8px;
  background: #fff9;
  padding: 7px 10px;
  color: #7153ad;
  font-size: 0.67rem !important;
}
.gm-share-card small {
  display: block;
  max-width: 280px;
  color: #82758b;
  font-size: 0.64rem;
}
.gm-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 16px;
}
.gm-app .gm-section-heading h2 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  font-size: 1.17rem;
}
.gm-section-heading h2 > span:not(.gm-live-pill) {
  display: grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: 7px;
  background: #f0f2ed;
  color: #6e7b70;
  font-size: 0.7rem;
}
.gm-section-heading .gm-kicker {
  margin-bottom: 6px;
}
.gm-soft-label {
  color: var(--gm-muted);
  font-size: 0.72rem;
}
.gm-circles {
  margin-bottom: 28px;
}
.gm-group-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 285px), 1fr));
  gap: 18px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.gm-group-card {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--gm-line);
  border-radius: 19px;
  background: white;
  transition:
    transform 0.18s,
    box-shadow 0.18s;
}
.gm-group-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 25px #354b3910;
}
.gm-group-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 22px;
}
.gm-group-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #eee8fa;
}
.gm-tone-1 .gm-group-mark {
  background: #e6f2ed;
}
.gm-tone-2 .gm-group-mark {
  background: #fbefda;
}
.gm-role {
  font-size: 0.62rem;
  color: #8a8592;
}
.gm-app .gm-group-card h3 {
  margin: 0 0 7px;
  font-size: 1.09rem;
  letter-spacing: -0.025em;
}
.gm-group-card > p {
  color: var(--gm-muted);
  font-size: 0.7rem;
  margin-bottom: 24px;
}
.gm-group-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
}
.gm-avatars {
  display: flex;
  padding-left: 3px;
}
.gm-avatars > span,
.gm-avatar {
  display: grid;
  place-items: center;
  width: 31px;
  height: 31px;
  flex: 0 0 31px;
  border: 2px solid white;
  border-radius: 50%;
  background: #e7e6ee;
  color: #746485;
  font-size: 0.59rem;
  font-weight: 750;
}
.gm-avatars > span {
  margin-left: -3px;
}
.gm-avatars .gm-avatar-1,
.gm-avatar-1 {
  background: #e1eee4;
  color: #4e7a60;
}
.gm-avatars .gm-avatar-2,
.gm-avatar-2 {
  background: #f6e8d9;
  color: #9b7751;
}
.gm-avatars .gm-avatar-3,
.gm-avatar-3 {
  background: #e3e9f5;
  color: #667aa0;
}
.gm-open-button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 35px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--gm-purple);
  font-size: 0.72rem !important;
  font-weight: 700 !important;
}
.gm-open-button :deep(svg) {
  width: 16px;
}
.gm-empty-team {
  padding: 30px;
  text-align: center;
  border: 1px dashed #cfdccc;
  border-radius: 20px;
  background: #eef4ed;
}
.gm-empty-mark {
  display: grid;
  place-items: center;
  margin: 0 auto 12px;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  background: white;
}
.gm-empty-team p {
  margin: 7px 0 0;
  font-size: 0.78rem;
  color: var(--gm-muted);
}
.gm-panel {
  min-width: 0;
  background: white;
  border: 1px solid var(--gm-line);
  border-radius: 20px;
  padding: 25px;
}
.gm-entry-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
}
.gm-entry-grid .gm-panel {
  position: relative;
  padding: 28px;
  overflow: hidden;
}
.gm-create-panel {
  background: #f2eef9;
  border-color: #e6dff0;
}
.gm-join-panel {
  background: #edf4ed;
  border-color: #dee8dd;
}
.gm-entry-icon {
  position: absolute;
  right: 28px;
  top: 22px;
  font: 300 2.4rem/1 system-ui;
  color: #ab94c1;
}
.gm-join-panel .gm-entry-icon {
  color: #8aa487;
}
.gm-entry-grid h2 {
  margin-bottom: 9px;
  font-size: 1.3rem;
}
.gm-entry-grid .gm-panel > p:not(.gm-kicker):not(.gm-inline-error) {
  max-width: 360px;
  color: var(--gm-muted);
  font-size: 0.76rem;
  line-height: 1.75;
  margin-bottom: 24px;
}
.gm-entry-grid small {
  display: block;
  margin-top: 12px;
  color: #89858c;
  font-size: 0.65rem;
}
.gm-app label,
.gm-duration-picker legend {
  display: block;
  margin: 0 0 7px;
  color: #52645a;
  font-size: 0.69rem;
  font-weight: 650;
}
.gm-app input,
.gm-app select {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  min-height: 43px;
  border: 1px solid #dce3da;
  border-radius: 9px;
  background: white;
  padding: 9px 11px;
  font-size: 0.76rem;
  color: var(--gm-ink);
}
.gm-app input::placeholder {
  color: #a19cab;
  font-size: 0.73rem;
}
.gm-input-action {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 9px;
}
.gm-input-action input {
  flex: 1 1 170px;
}
.gm-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 43px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 11px 16px;
  font-size: 0.73rem !important;
  font-weight: 650 !important;
  text-decoration: none;
  transition:
    background 0.18s,
    transform 0.18s;
}
.gm-button:hover:not(:disabled) {
  transform: translateY(-1px);
}
.gm-primary {
  background: #7153ad;
  color: white;
}
.gm-primary:hover:not(:disabled) {
  background: #604393;
}
.gm-dark {
  background: #355d4e;
  color: white;
}
.gm-dark:hover:not(:disabled) {
  background: #264c3e;
}
.gm-secondary {
  background: white;
  border-color: var(--gm-line);
  color: #667265;
}
.gm-danger {
  background: #ad495b;
  color: white;
}
.gm-code-input {
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
.gm-demo-button {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: none;
  color: var(--gm-muted);
  font-size: 0.72rem !important;
  margin: 24px auto;
}
.gm-group-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 23px;
}
.gm-group-toolbar > div:first-child {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.gm-group-toolbar label {
  margin: 0;
  font-size: 0.57rem;
  letter-spacing: 0.1em;
  color: #859085;
}
.gm-group-toolbar select {
  width: auto;
  min-height: 36px;
  max-width: 100%;
  background: transparent;
  border-color: #dce3d9;
  padding: 6px 30px 6px 10px;
  font-size: 0.72rem;
}
.gm-refresh-symbol {
  font: 400 1.3rem/1 system-ui;
}
.gm-leave-button {
  min-height: 34px;
  padding: 5px 10px;
  border: 1px solid #e4d5d7;
  border-radius: 8px;
  background: transparent;
  color: #9d6770;
  font-size: 0.7rem !important;
}
.gm-solo-note {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 17px;
  background: #faf2df;
  border: 1px solid #ede2c8;
  border-radius: 12px;
  margin: 0 0 22px;
  color: #8b7449;
}
.gm-solo-note > span {
  font-size: 1.4rem;
}
.gm-solo-note p {
  margin: 0;
  font-size: 0.74rem;
}
.gm-planner-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}
.gm-planner-main,
.gm-planner-aside {
  min-width: 0;
}
.gm-planner-main > section + section {
  margin-top: 24px;
}
.gm-planner-aside {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.gm-availability-panel {
  padding: 25px 22px 15px;
}
.gm-availability-panel .gm-section-heading {
  margin-bottom: 8px;
}
.gm-panel-description {
  margin: 0 0 24px;
  color: var(--gm-muted);
  font-size: 0.74rem;
  line-height: 1.7;
}
.gm-live-pill {
  padding: 5px 8px;
  border-radius: 6px;
  color: #52806a;
  background: #edf5ee;
  font-size: 0.55rem;
  letter-spacing: 0.01em;
}
.gm-date-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 15px minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}
.gm-date-arrow {
  padding-bottom: 13px;
  color: #a4aaa1;
  font-size: 0.8rem;
}
.gm-date-row input {
  font-size: 0.7rem;
  padding-left: 8px;
  padding-right: 7px;
}
.gm-duration-picker {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.gm-duration-picker legend {
  float: none;
  width: auto;
}
.gm-duration-picker > div {
  display: flex;
  padding: 4px;
  border: 1px solid #e3e7de;
  border-radius: 10px;
  background: #f6f7f2;
}
.gm-duration-picker button {
  min-height: 33px;
  padding: 6px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #8b9085;
  font-size: 0.7rem !important;
}
.gm-duration-picker button.active {
  background: white;
  color: #7051a6;
  box-shadow: 0 1px 5px #343b2410;
  font-weight: 700;
}
.gm-duration-picker small {
  font-size: 0.58rem;
}
.gm-preferences {
  margin: 15px 0 21px;
}
.gm-preferences summary {
  color: #73816d;
  font-size: 0.68rem;
  cursor: pointer;
}
.gm-preferences summary > span {
  float: right;
  font-size: 0.62rem;
  color: #939b8d;
}
.gm-preferences-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr;
  gap: 12px;
  padding-top: 16px;
}
.gm-preferences p {
  margin: 10px 0 0;
  color: var(--gm-muted);
  font-size: 0.65rem;
  line-height: 1.7;
}
.gm-grid-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
  padding-top: 17px;
  border-top: 1px solid #edf0e9;
  font-size: 0.7rem;
}
.gm-grid-heading b {
  font-weight: 600;
  color: #526856;
}
.gm-grid-heading small {
  color: #98a18f;
  font-size: 0.58rem;
}
.gm-timezone {
  color: #909c88;
  font-size: 0.58rem;
  white-space: nowrap;
}
.gm-source-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 16px;
  padding-top: 13px;
  border-top: 1px solid #edf0e9;
  color: #89947f;
  font-size: 0.59rem;
}
.gm-blocked,
.gm-no-overlap {
  padding: 20px;
  border-radius: 13px;
  background: #fbf3e3;
  color: #8b754a;
  font-size: 0.76rem;
}
.gm-blocked p,
.gm-no-overlap p {
  margin-bottom: 0;
}
.gm-blocked ul {
  padding-left: 17px;
  margin-bottom: 0;
}
.gm-no-overlap {
  margin-top: 13px;
  background: #f4f5f0;
}
.gm-suggestions .gm-section-heading {
  margin-bottom: 12px;
}
.gm-suggestions .gm-section-heading > span {
  font-size: 0.65rem;
  color: #85927a;
}
.gm-suggestion-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
}
.gm-suggestion-list > button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  padding: 17px 14px;
  border: 1px solid #dce5d9;
  border-radius: 14px;
  background: #eff5eb;
  color: #45654e;
  text-align: left;
  transition:
    border-color 0.15s,
    transform 0.15s;
}
.gm-suggestion-list > button:hover {
  border-color: #8cac8a;
  transform: translateY(-2px);
}
.gm-suggestion-list > button.picked {
  background: #e6ddf5;
  border-color: #ad94ce;
  color: #6b5191;
}
.gm-suggestion-label {
  font-size: 0.48rem;
  letter-spacing: 0.08em;
  color: #829676;
}
.gm-suggestion-list strong {
  font-size: 0.83rem;
}
.gm-suggestion-list > button > span:not(.gm-suggestion-label) {
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
}
.gm-suggestion-list i {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  font-size: 0.58rem;
  font-style: normal;
}
.gm-suggestion-list :deep(svg) {
  width: 14px;
  height: 14px;
}
.gm-booking-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid #e3d9ee;
  border-radius: 20px;
  padding: 26px 22px 22px;
  background: linear-gradient(155deg, #f0eaf9, #f5f0fb 65%, #f7f3fa);
  scroll-margin-top: 18px;
}
.gm-booking-spark {
  position: absolute;
  top: 18px;
  right: 16px;
  font-size: 2.7rem;
  line-height: 1;
  color: #c6b0df;
  transform: rotate(12deg);
}
.gm-booking-panel .gm-kicker {
  max-width: 180px;
  font-size: 0.53rem;
}
.gm-app .gm-booking-panel h2 {
  margin: 13px 0 8px;
  color: #594277;
  font-size: 1.75rem;
  letter-spacing: -0.05em;
}
.gm-booking-intro {
  font-size: 0.71rem;
  color: #8c7e9c;
  margin-bottom: 22px;
}
.gm-pick-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 25px 13px;
  border: 1px dashed #d3c5e4;
  border-radius: 12px;
  background: #ffffff61;
  text-align: center;
}
.gm-pick-prompt :deep(svg) {
  width: 32px;
  height: 32px;
  margin-bottom: 12px;
  opacity: 0.65;
}
.gm-pick-prompt strong {
  font-size: 0.78rem;
  color: #82708f;
}
.gm-pick-prompt p {
  margin: 7px 0 0;
  max-width: 190px;
  color: #998ba7;
  font-size: 0.68rem;
  line-height: 1.7;
}
.gm-booking-panel form {
  margin-top: 23px;
}
.gm-booking-panel label {
  color: #827190;
}
.gm-booking-panel input {
  border-color: #e0d6eb;
  background: #fffc;
}
.gm-book-button {
  width: 100%;
  margin-top: 12px;
  justify-content: space-between;
  font-size: 0.67rem !important;
  padding: 13px 12px;
}
.gm-book-button :deep(svg) {
  flex-shrink: 0;
  width: 16px;
}
.gm-booking-footnote {
  display: block;
  margin-top: 13px;
  color: #a091ab;
  font-size: 0.61rem;
  text-align: center;
  line-height: 1.6;
}
.gm-chosen-time {
  padding: 20px;
  border: 1px solid #d3d2cb;
  border-radius: 12px;
  background: #fffdf6;
}
.gm-chosen-time > span {
  display: block;
  font-size: 0.49rem;
  letter-spacing: 0.12em;
  color: #9a977a;
}
.gm-chosen-time strong {
  display: block;
  margin-top: 10px;
  font-size: 1rem;
  color: #526c53;
}
.gm-chosen-time b {
  display: block;
  margin: 6px 0 10px;
  color: #526c53;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.035em;
}
.gm-chosen-time small {
  font-size: 0.6rem;
  color: #92a181;
}
.gm-booked-notice {
  padding: 16px;
  margin-top: 16px;
  border: 1px solid #d0e2ce;
  border-radius: 12px;
  background: #eef7ec;
  color: #50724d;
  font-size: 0.72rem;
}
.gm-booked-notice p {
  margin: 7px 0;
  line-height: 1.7;
}
.gm-booked-notice a {
  color: #3b6c50;
  font-size: 0.68rem;
}
.gm-room-option {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #dfd4eb;
}
.gm-room-option h3 {
  margin: 0 0 6px;
  color: #705a85;
  font-size: 0.85rem;
}
.gm-room-option p {
  margin: 0 0 12px;
  color: #8a7b96;
  font-size: 0.7rem;
  line-height: 1.7;
}
.gm-room-option a {
  width: 100%;
  justify-content: space-between;
  color: #7153ad;
}
.gm-room-option small {
  display: block;
  margin-top: 8px;
  color: #8a7b96;
  font-size: 0.62rem;
}
.gm-members-panel {
  padding: 22px;
}
.gm-member-count {
  background: #f1f4ee;
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 0.65rem;
  color: #88917e;
}
.gm-members-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.gm-members-panel li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 0;
}
.gm-members-panel .gm-avatar {
  width: 35px;
  height: 35px;
  flex-basis: 35px;
  font-size: 0.65rem;
}
.gm-members-panel li > div {
  flex: 1;
  min-width: 0;
}
.gm-members-panel li strong {
  display: block;
  font-size: 0.73rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.gm-members-panel li strong small {
  font-weight: 400;
  color: #a2a398;
  font-size: 0.64rem;
}
.gm-members-panel li > div > span {
  color: #a1a69a;
  font-size: 0.59rem;
}
.gm-member-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #78af8d;
}
.gm-member-status.incomplete {
  background: #c9ad72;
}
.gm-members-panel > p {
  border-top: 1px solid #edf0e8;
  padding-top: 15px;
  margin: 12px 0 0;
  color: #9aa18f;
  font-size: 0.62rem;
  line-height: 1.7;
}
.gm-email-invite {
  padding-top: 14px;
}
.gm-email-invite summary {
  color: #8c7c9a;
  font-size: 0.64rem;
  cursor: pointer;
}
.gm-email-invite form {
  padding-top: 14px;
}
.gm-email-invite input,
.gm-email-invite select {
  margin-bottom: 12px;
}
.gm-email-invite p {
  font-size: 0.68rem;
}
.gm-how-it-works {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 2px 10px;
  color: #8a977f;
}
.gm-how-it-works > span {
  font-size: 1.5rem;
  line-height: 1;
  color: #a3b498;
}
.gm-how-it-works strong {
  font-size: 0.69rem;
  color: #73836c;
}
.gm-how-it-works p {
  margin: 7px 0 0;
  font-size: 0.65rem;
  line-height: 1.8;
}
.gm-meetings .gm-section-heading {
  margin-bottom: 20px;
}
.gm-meeting-empty {
  padding: 18px 0 5px;
  color: #929b86;
  font-size: 0.76rem;
  line-height: 1.8;
}
.gm-meeting-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 18px 0;
  border-top: 1px solid #edf0e8;
  scroll-margin-top: 24px;
}
.gm-meeting-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 55px;
  border-radius: 10px;
  background: #f1edf7;
  color: #9a84b1;
}
.gm-meeting-date span {
  font-size: 0.52rem;
  text-transform: uppercase;
}
.gm-meeting-date strong {
  font-size: 1.2rem;
  color: #79618f;
  font-weight: 600;
}
.gm-meeting-copy {
  flex: 1;
  min-width: 140px;
}
.gm-meeting-copy h3 {
  margin: 0 0 4px;
  font-size: 0.83rem;
}
.gm-meeting-copy p {
  margin: 0 0 3px;
  color: #849178;
  font-size: 0.67rem;
}
.gm-meeting-copy small {
  color: #a5ad9b;
  font-size: 0.59rem;
}
.gm-meeting-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.gm-requested-meeting {
  outline: 2px solid #ad96c9;
  outline-offset: 5px;
  border-radius: 10px;
}
.gm-message {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 15px 19px;
  margin-bottom: 20px;
  border: 1px solid;
  border-radius: 12px;
  font-size: 0.77rem;
}
.gm-success {
  border-color: #d3e5d2;
  background: #eaf5e8;
  color: #4d7752;
}
.gm-error {
  border-color: #ead0d5;
  background: #fcf0f0;
  color: #a15c68;
}
.gm-message button {
  background: transparent;
  border: 0;
  color: inherit;
  text-decoration: underline;
  font-size: inherit;
}
.gm-inline-error {
  color: #aa5968;
  font-size: 0.73rem;
  line-height: 1.7;
  margin: 10px 0 0;
}
.gm-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 90px 20px;
  color: #89917e;
  font-size: 0.8rem;
}
.gm-spinner {
  width: 19px;
  height: 19px;
  border: 2px solid #ded5ed;
  border-top-color: #9273b7;
  border-radius: 50%;
  animation: gm-spin 1s linear infinite;
}
@keyframes gm-spin {
  to {
    transform: rotate(360deg);
  }
}
.gm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 32px 0 8px;
  color: #a5ad9b;
  font-size: 0.61rem;
}
.gm-modal-backdrop {
  position: fixed;
  z-index: 1070;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 22px;
  background: #2a293e69;
  backdrop-filter: blur(5px);
}
.gm-modal {
  width: min(100%, 450px);
  max-height: calc(100dvh - 44px);
  overflow-y: auto;
  padding: 30px;
  border: 1px solid #ede7ef;
  border-radius: 23px;
  background: #fffdfd;
  box-shadow: 0 24px 80px #27203730;
  color: #514560;
}
.gm-modal h2 {
  font-size: 1.2rem;
  margin: 0 0 16px;
}
.gm-modal p {
  font-size: 0.8rem;
  line-height: 1.8;
  color: #8b7d96;
}
.gm-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 23px;
}
.gm-invitation-row {
  padding: 18px 0;
  border-top: 1px solid #ece6f0;
}
.gm-invitation-row p {
  margin-bottom: 0;
}
.gm-invitation-row .gm-modal-actions {
  margin-top: 13px;
}
.gm-invitation-row small {
  color: #8a9c7c;
  text-transform: capitalize;
}
@media (min-width: 1700px) {
  .gm-planner-layout {
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 28px;
  }
  .gm-booking-panel {
    padding: 30px;
  }
}
@media (max-width: 1250px) {
  .app .gm-main {
    padding: 22px;
  }
  .gm-planner-layout {
    grid-template-columns: minmax(0, 1fr) 265px;
    gap: 17px;
  }
  .gm-availability-panel {
    padding: 22px 16px 15px;
  }
  .gm-date-row {
    grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr);
  }
  .gm-duration-picker {
    grid-column: 1/-1;
    display: flex;
    align-items: center;
    gap: 15px;
    margin-top: 4px;
  }
  .gm-duration-picker legend {
    float: left;
    margin: 0;
  }
  .gm-duration-picker > div {
    flex: 1;
    justify-content: space-around;
  }
  .gm-hero-art {
    margin-right: 0;
    flex-basis: 240px;
  }
  .gm-share-card {
    padding: 16px;
  }
  .gm-share-card > div {
    gap: 9px;
  }
  .gm-group-code {
    font-size: 1.1rem;
  }
}
@media (max-width: 1099px) {
  .gm-planner-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .gm-planner-aside {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }
  .gm-how-it-works {
    grid-column: 1/-1;
  }
  .gm-hero {
    padding: 30px;
  }
  .gm-hero-art {
    flex-basis: 205px;
    transform: scale(0.9);
    transform-origin: right center;
  }
  .gm-mini-calendar {
    width: 225px;
  }
  .gm-preferences summary > span {
    float: none;
    margin-left: 10px;
  }
  .gm-date-row {
    grid-template-columns: minmax(0, 1fr) 15px minmax(0, 1fr) auto;
  }
  .gm-duration-picker {
    grid-column: auto;
    display: block;
    margin-top: 0;
  }
  .gm-duration-picker legend {
    float: none;
    margin-bottom: 7px;
  }
}
@media (max-width: 767px) {
  .app .gm-main {
    padding: 18px 16px;
  }
  .gm-topbar {
    gap: 10px;
    margin-bottom: 20px;
  }
  .gm-backlinks {
    gap: 11px;
  }
  .gm-topbar .gm-text-button {
    font-size: 0.68rem !important;
  }
  .gm-notification-button {
    min-height: 35px;
    padding: 6px 10px;
    font-size: 0.65rem !important;
  }
  .gm-notification-button :deep(svg) {
    width: 17px;
  }
  .gm-hero {
    padding: 28px 24px;
    border-radius: 21px;
    gap: 15px;
  }
  .gm-hero-art {
    display: none;
  }
  .gm-app .gm-hero h1 {
    font-size: 2.25rem;
  }
  .gm-intro {
    font-size: 0.8rem;
  }
  .gm-kicker {
    font-size: 0.55rem;
  }
  .gm-journey {
    row-gap: 10px;
    font-size: 0.58rem;
  }
  .gm-journey b {
    width: 20px;
    height: 20px;
    font-size: 0.5rem;
  }
  .gm-journey i {
    display: none;
  }
  .gm-hero-detail {
    align-items: flex-start;
    flex-direction: column;
  }
  .gm-hero-detail .gm-intro {
    max-width: 100%;
  }
  .gm-share-card {
    width: 100%;
    margin-top: 5px;
  }
  .gm-share-card > div {
    justify-content: space-between;
  }
  .gm-share-card small {
    max-width: 100%;
  }
  .gm-group-code {
    font-size: 1.25rem;
  }
  .gm-entry-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .gm-entry-grid .gm-panel {
    padding: 25px;
  }
  .gm-group-list {
    gap: 13px;
  }
  .gm-group-card {
    padding: 22px;
  }
  .gm-soft-label {
    display: none;
  }
  .gm-planner-aside {
    display: flex;
  }
  .gm-group-toolbar {
    gap: 12px;
  }
  .gm-toolbar-actions {
    flex: 1 1 100%;
    justify-content: space-between;
  }
  .gm-planner-main > section + section {
    margin-top: 20px;
  }
  .gm-availability-panel {
    padding: 22px 14px 14px;
  }
  .gm-app .gm-availability-panel h2 {
    font-size: 1.07rem;
  }
  .gm-live-pill {
    font-size: 0.5rem;
  }
  .gm-panel-description {
    font-size: 0.68rem;
  }
  .gm-date-row {
    grid-template-columns: minmax(0, 1fr) 10px minmax(0, 1fr);
    gap: 6px;
  }
  .gm-date-row input {
    padding: 9px 5px;
    font-size: 0.68rem;
  }
  .gm-duration-picker {
    display: flex;
    grid-column: 1/-1;
    align-items: center;
    gap: 15px;
    margin-top: 10px;
  }
  .gm-duration-picker legend {
    float: left;
    margin: 0;
    font-size: 0.65rem;
  }
  .gm-duration-picker > div {
    flex: 1;
  }
  .gm-preferences summary {
    font-size: 0.63rem;
  }
  .gm-preferences summary > span {
    display: block;
    margin: 7px 0 0;
    font-size: 0.59rem;
  }
  .gm-preferences-fields {
    grid-template-columns: 1fr 1fr;
  }
  .gm-preferences-fields > div:last-child {
    grid-column: 1/-1;
  }
  .gm-preferences p {
    font-size: 0.63rem;
  }
  .gm-grid-heading {
    font-size: 0.65rem;
  }
  .gm-grid-heading small {
    display: none;
  }
  .gm-timezone {
    font-size: 0.52rem;
  }
  .gm-source-strip {
    font-size: 0.56rem;
  }
  .gm-suggestion-list {
    grid-template-columns: 1fr;
  }
  .gm-suggestion-list > button {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 6px 10px;
    padding: 17px;
  }
  .gm-suggestion-list .gm-suggestion-label {
    grid-column: 1/-1;
  }
  .gm-suggestion-list i {
    grid-column: 1/-1;
    margin-top: 5px;
  }
  .gm-suggestion-list strong {
    font-size: 0.9rem;
  }
  .gm-panel {
    padding: 22px;
  }
  .gm-meeting-row {
    gap: 12px;
  }
  .gm-meeting-actions {
    margin-left: auto;
  }
  .gm-booking-panel {
    padding: 27px 24px 24px;
  }
  .gm-book-button {
    font-size: 0.75rem !important;
  }
  .gm-footer {
    font-size: 0.56rem;
    line-height: 1.7;
  }
  .gm-modal {
    padding: 25px;
  }
  .gm-modal-actions > button {
    flex: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .gm-group-card,
  .gm-button,
  .gm-suggestion-list > button {
    transition: none;
  }
  .gm-spinner {
    animation: none;
  }
}
</style>
