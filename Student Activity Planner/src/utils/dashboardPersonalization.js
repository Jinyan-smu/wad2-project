import { computed, reactive, watch } from 'vue'

export const dashboardStorageKey = (userId) =>
  'student-planner:dashboard:v1:' + encodeURIComponent(userId)
const legacyFields = ['sessions', 'timer', 'focusDraft', 'prioritySteps']
const validTime = (value) =>
  Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime())
const defaults = () => ({
  preferences: {
    filter: 'all',
    agendaMode: 'day',
    sortBy: 'deadline',
    announcementsOpen: false,
    progressOpen: false,
    conflictsOpen: false,
    forecastOpen: false,
    weatherMode: 'auto',
  },
  priorities: [],
  completions: {},
})

function sanitize(raw) {
  const result = defaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  const prefs = raw.preferences || {}
  for (const [name, options] of Object.entries({
    filter: ['all', 'assignment', 'quiz', 'activity'],
    agendaMode: ['day', 'upcoming'],
    sortBy: ['deadline', 'course'],
    weatherMode: ['auto', 'expanded', 'compact'],
  }))
    if (options.includes(prefs[name])) result.preferences[name] = prefs[name]
  for (const name of ['announcementsOpen', 'progressOpen', 'conflictsOpen', 'forecastOpen']) {
    if (typeof prefs[name] === 'boolean') result.preferences[name] = prefs[name]
  }
  if (Array.isArray(raw.priorities))
    result.priorities = [...new Set(raw.priorities.filter((key) => typeof key === 'string'))].slice(
      0,
      3,
    )
  if (raw.completions && typeof raw.completions === 'object') {
    for (const [key, entry] of Object.entries(raw.completions)) {
      if (
        (key.startsWith('assignment:') || key.startsWith('quiz:')) &&
        entry &&
        validTime(entry.at) &&
        typeof entry.title === 'string'
      )
        result.completions[key] = { at: entry.at, title: entry.title }
    }
  }
  return result
}

function readStored(userId) {
  const value = localStorage.getItem(dashboardStorageKey(userId))
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
function read(userId) {
  return userId === null || userId === undefined ? defaults() : sanitize(readStored(userId))
}
function write(userId, value) {
  const previous = readStored(userId)
  // Keep old session notes on disk without loading them into dashboard state.
  const legacy = {}
  for (const key of legacyFields) {
    if (Object.hasOwn(previous, key)) legacy[key] = previous[key]
  }
  localStorage.setItem(
    dashboardStorageKey(userId),
    JSON.stringify({
      version: 2,
      ...legacy,
      preferences: value.preferences,
      priorities: value.priorities,
      completions: value.completions,
    }),
  )
}

export function recordCourseworkCompletion(userId, item, done, at = Date.now()) {
  if (userId === null || userId === undefined) return
  try {
    const value = read(userId)
    if (done) {
      value.completions[item.key] = { title: item.title, at }
      value.priorities = value.priorities.filter((key) => key !== item.key)
    } else delete value.completions[item.key]
    write(userId, value)
  } catch {
    /* Coursework still saves on the server when local storage is unavailable. */
  }
}

export function createDashboardPersonalization() {
  const state = reactive({
    ...defaults(),
    accountId: null,
    hydrated: false,
    storageAvailable: true,
  })
  let hydrating = false
  let disposed = false
  function apply(value) {
    hydrating = true
    Object.assign(state.preferences, value.preferences)
    state.priorities = value.priorities
    state.completions = value.completions
    hydrating = false
  }
  function refresh() {
    if (state.accountId === null || !state.storageAvailable) return
    try {
      apply(read(state.accountId))
    } catch {
      state.storageAvailable = false
    }
  }
  function save() {
    if (hydrating || !state.hydrated || disposed || state.accountId === null) return
    try {
      write(state.accountId, state)
      state.storageAvailable = true
    } catch {
      state.storageAvailable = false
    }
  }
  function loadAccount(id) {
    state.hydrated = false
    state.accountId = id === undefined || id === null ? null : String(id)
    state.storageAvailable = true
    try {
      apply(read(state.accountId))
    } catch {
      apply(defaults())
      state.storageAvailable = false
    }
    state.hydrated = true
  }
  function savePreferences(values, previous) {
    if (hydrating || !state.hydrated || disposed || state.accountId === null) return
    if (!state.storageAvailable) {
      save()
      return
    }
    try {
      const latest = read(state.accountId)
      // Only merge this tab's edits so stale preferences cannot replace another tab's changes.
      for (const key of Object.keys(latest.preferences)) {
        if (values[key] !== previous?.[key]) latest.preferences[key] = values[key]
      }
      write(state.accountId, latest)
    } catch {
      state.storageAvailable = false
    }
  }
  const stopPreferences = watch(
    () => JSON.stringify(state.preferences),
    (value, previous) => savePreferences(JSON.parse(value), previous ? JSON.parse(previous) : {}),
    { flush: 'sync' },
  )
  function onStorage(event) {
    if (
      state.accountId !== null &&
      (event.key === dashboardStorageKey(state.accountId) || event.key === null)
    )
      refresh()
  }
  window.addEventListener('storage', onStorage)

  function togglePriority(key) {
    refresh()
    if (state.priorities.includes(key))
      state.priorities = state.priorities.filter((item) => item !== key)
    else if (state.priorities.length < 3) state.priorities.push(key)
    else return false
    save()
    return true
  }
  function reconcile(items) {
    refresh()
    const keys = new Set(items.filter((item) => !item.done).map((item) => item.key))
    state.priorities = state.priorities.filter((key) => keys.has(key))
    save()
  }
  function recordCompletion(item, done) {
    refresh()
    if (done) {
      state.completions[item.key] = { title: item.title, at: Date.now() }
      state.priorities = state.priorities.filter((key) => key !== item.key)
    } else delete state.completions[item.key]
    save()
  }
  function dispose() {
    disposed = true
    stopPreferences()
    window.removeEventListener('storage', onStorage)
  }
  const storageMessage = computed(() =>
    state.accountId === null
      ? 'Sign in again to save your dashboard choices.'
      : state.storageAvailable
        ? 'Your priorities, preferences, and completion history are saved for this account on this browser.'
        : 'Browser storage is unavailable. Your dashboard choices will last until you leave this page.',
  )
  return {
    state,
    loadAccount,
    togglePriority,
    reconcile,
    recordCompletion,
    dispose,
    storageMessage,
  }
}
