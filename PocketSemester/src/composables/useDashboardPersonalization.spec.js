import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useDashboardPersonalization,
  dashboardStorageKey,
  recordCourseworkCompletion,
} from './useDashboardPersonalization'

let stores = []
const item = (key = 'assignment:1:1') => ({
  key,
  title: 'Project proposal',
  type: 'assignment',
  done: false,
})
function create(user = 'alex') {
  const store = useDashboardPersonalization()
  stores.push(store)
  store.loadAccount(user)
  return store
}
function stored(user = 'alex') {
  return JSON.parse(localStorage.getItem(dashboardStorageKey(user)))
}
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 4, 9))
})
afterEach(() => {
  stores.forEach((store) => store.dispose())
  stores = []
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Dashboard personalization', () => {
  it('restores preferences and pins for the correct account and rejects a fourth priority', () => {
    const first = create()
    first.state.preferences.agendaMode = 'upcoming'
    first.state.preferences.announcementsOpen = true
    for (let i = 1; i <= 3; i++) expect(first.togglePriority('assignment:1:' + i)).toBe(true)
    expect(first.togglePriority('assignment:1:4')).toBe(false)
    const restored = create()
    expect(restored.state.preferences.agendaMode).toBe('upcoming')
    expect(restored.state.preferences.announcementsOpen).toBe(true)
    expect(restored.state.priorities).toHaveLength(3)
    const other = create('other-student')
    expect(other.state.preferences.agendaMode).toBe('day')
    expect(other.state.priorities).toEqual([])
    other.togglePriority('assignment:2:1')
    expect(stored().priorities).toEqual(first.state.priorities)
    expect(stored('other-student').priorities).toEqual(['assignment:2:1'])
  })

  it('reconciles deleted and completed priorities without erasing completion history', () => {
    const store = create()
    store.togglePriority(item().key)
    store.togglePriority('quiz:1:2')
    store.togglePriority('assignment:1:3')
    store.recordCompletion(item(), true)
    store.reconcile([{ ...item('quiz:1:2'), type: 'quiz' }])
    expect(store.state.priorities).toEqual(['quiz:1:2'])
    store.reconcile([{ ...item('quiz:1:2'), type: 'quiz', done: true }])
    expect(store.state.priorities).toEqual([])
    expect(store.state.completions[item().key]).toEqual({
      title: 'Project proposal',
      at: Date.now(),
    })
  })

  it('uses completion time rather than the due date and supports undo from the coursework page', () => {
    recordCourseworkCompletion('alex', { ...item(), when: new Date('2026-10-01') }, true)
    const store = create()
    expect(store.state.completions[item().key].at).toBe(Date.now())
    recordCourseworkCompletion('alex', item(), false)
    window.dispatchEvent(new StorageEvent('storage', { key: dashboardStorageKey('alex') }))
    expect(store.state.completions).toEqual({})
  })

  it('merges stale tabs’ preference edits without replacing newer priorities or completion history', () => {
    const first = create()
    const second = create()
    first.state.preferences.agendaMode = 'upcoming'
    first.togglePriority('assignment:1:2')
    first.recordCompletion(item(), true)
    second.state.preferences.announcementsOpen = true
    const restored = create()
    expect(restored.state.preferences).toMatchObject({
      agendaMode: 'upcoming',
      announcementsOpen: true,
    })
    expect(restored.state.priorities).toEqual(['assignment:1:2'])
    expect(restored.state.completions[item().key].title).toBe('Project proposal')
    window.dispatchEvent(new StorageEvent('storage', { key: dashboardStorageKey('alex') }))
    expect(first.state.preferences.announcementsOpen).toBe(true)
    expect(second.state.preferences.agendaMode).toBe('upcoming')
    expect(second.state.priorities).toEqual(['assignment:1:2'])
  })

  it('recovers from malformed data and validates preferences, pins, and completion timestamps', () => {
    localStorage.setItem(dashboardStorageKey('alex'), '{broken')
    const store = create()
    expect(store.state.priorities).toEqual([])
    localStorage.setItem(
      dashboardStorageKey('alex'),
      JSON.stringify({
        preferences: {
          filter: 'not-a-filter',
          weatherMode: 'expanded',
          sortBy: 'course',
          announcementsOpen: 'yes',
          dashboardTab: 'focus',
        },
        priorities: ['a', 'a', 7, 'b', 'c', 'd'],
        completions: {
          'assignment:1:1': { title: 'Valid completion', at: Date.now() },
          'assignment:1:2': { title: 'Invalid date', at: 9e15 },
          'quiz:1:3': { title: 'Invalid timestamp', at: -1 },
          'activity:1:4': { title: 'Unsupported completion type', at: Date.now() },
        },
      }),
    )
    store.loadAccount('alex')
    expect(store.state.preferences).toMatchObject({
      filter: 'all',
      weatherMode: 'expanded',
      sortBy: 'course',
      announcementsOpen: false,
    })
    expect(store.state.preferences).not.toHaveProperty('dashboardTab')
    expect(store.state.priorities).toEqual(['a', 'b', 'c'])
    expect(store.state.completions).toEqual({
      'assignment:1:1': { title: 'Valid completion', at: Date.now() },
    })
  })

  it('keeps local choices usable when writes are blocked and never saves anonymous state', () => {
    const store = create()
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    expect(store.togglePriority(item().key)).toBe(true)
    store.state.preferences.sortBy = 'course'
    store.recordCompletion(item('quiz:1:2'), true)
    expect(store.state.storageAvailable).toBe(false)
    expect(store.storageMessage.value).toContain('unavailable')
    expect(store.state.priorities).toEqual([item().key])
    expect(store.state.preferences.sortBy).toBe('course')
    expect(store.state.completions['quiz:1:2'].title).toBe('Project proposal')
    store.loadAccount(null)
    const attempts = writes.mock.calls.length
    expect(store.state.priorities).toEqual([])
    store.togglePriority(item().key)
    store.state.preferences.agendaMode = 'upcoming'
    recordCourseworkCompletion(null, item(), true)
    expect(writes).toHaveBeenCalledTimes(attempts)
    expect(localStorage.getItem(dashboardStorageKey('null'))).toBeNull()
  })

  it('uses in-memory defaults and edits when browser storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    const store = create()
    expect(store.state.storageAvailable).toBe(false)
    expect(store.togglePriority(item().key)).toBe(true)
    store.recordCompletion(item('assignment:1:2'), true)
    store.state.preferences.weatherMode = 'compact'
    expect(store.state.priorities).toEqual([item().key])
    expect(store.state.completions['assignment:1:2'].at).toBe(Date.now())
    expect(store.state.preferences.weatherMode).toBe('compact')
    expect(() => recordCourseworkCompletion('alex', item(), true)).not.toThrow()
  })

  it('preserves legacy focus JSON through preference, priority, reconcile, and coursework saves without exposing it', () => {
    const legacy = {
      sessions: [
        { id: 'saved-session', goal: 'Keep this goal', notes: 'Saved notes. '.repeat(500) },
        null,
      ],
      timer: {
        id: 'old-timer',
        status: 'running',
        endsAt: Date.now() - 60000,
        notes: 'An unfinished draft must stay saved.',
        customField: ['keep', 'unchanged'],
      },
      focusDraft: { taskKey: item().key, goal: 'Unstarted goal', notes: 'Draft notes', minutes: 0 },
      prioritySteps: { [item().key]: 'Keep the original next step', deleted: 'Keep this too' },
    }
    localStorage.setItem(
      dashboardStorageKey('alex'),
      JSON.stringify({
        ...legacy,
        preferences: { dashboardTab: 'focus' },
        priorities: [item().key],
        completions: {},
      }),
    )
    const beforeLoad = localStorage.getItem(dashboardStorageKey('alex'))
    const store = create()
    expect(localStorage.getItem(dashboardStorageKey('alex'))).toBe(beforeLoad)
    for (const key of Object.keys(legacy)) expect(store.state).not.toHaveProperty(key)
    expect(store.state.preferences).not.toHaveProperty('dashboardTab')
    expect(Object.keys(store).sort()).toEqual([
      'dispose',
      'loadAccount',
      'reconcile',
      'recordCompletion',
      'state',
      'storageMessage',
      'togglePriority',
    ])
    const expectPreserved = () => {
      const saved = stored()
      for (const [key, value] of Object.entries(legacy)) expect(saved[key]).toEqual(value)
      expect(saved.preferences).not.toHaveProperty('dashboardTab')
    }
    store.state.preferences.agendaMode = 'upcoming'
    expectPreserved()
    store.togglePriority(item().key)
    expectPreserved()
    store.recordCompletion(item(), true)
    expectPreserved()
    store.reconcile([])
    expectPreserved()
    recordCourseworkCompletion('alex', item(), false)
    expectPreserved()
    recordCourseworkCompletion('alex', item(), true)
    expectPreserved()
    create('other-student').togglePriority('assignment:2:1')
    for (const key of Object.keys(legacy)) expect(stored('other-student')).not.toHaveProperty(key)
  })

  it('syncs matching account storage events, ignores other accounts, and resets when storage is cleared', () => {
    const store = create()
    localStorage.setItem(
      dashboardStorageKey('alex'),
      JSON.stringify({
        preferences: { weatherMode: 'expanded' },
        priorities: [item().key],
        completions: { 'quiz:1:2': { title: 'Quiz', at: Date.now() } },
        timer: { status: 'running', notes: 'Stay inert' },
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: dashboardStorageKey('other-student') }))
    expect(store.state.priorities).toEqual([])
    window.dispatchEvent(new StorageEvent('storage', { key: dashboardStorageKey('alex') }))
    expect(store.state.preferences.weatherMode).toBe('expanded')
    expect(store.state.priorities).toEqual([item().key])
    expect(store.state.completions['quiz:1:2'].title).toBe('Quiz')
    expect(store.state).not.toHaveProperty('timer')
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(store.state.preferences.weatherMode).toBe('auto')
    expect(store.state.priorities).toEqual([])
    expect(store.state.completions).toEqual({})
  })

  it('stops saving preferences and responding to storage events after disposal', () => {
    const store = create()
    store.togglePriority(item().key)
    const before = localStorage.getItem(dashboardStorageKey('alex'))
    store.dispose()
    store.state.preferences.agendaMode = 'upcoming'
    expect(localStorage.getItem(dashboardStorageKey('alex'))).toBe(before)
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(store.state.priorities).toEqual([item().key])
  })
})
