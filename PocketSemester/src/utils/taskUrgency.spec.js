import { describe, it, expect } from 'vitest'
import { getTaskUrgency } from './taskUrgency'

// Local dates match the function's calendar-day comparisons in every timezone.
const now = new Date(2026, 10, 5, 12)

describe('getTaskUrgency', () => {
  it('marks an unfinished task with a past deadline as overdue', () => {
    const result = getTaskUrgency(new Date(2026, 10, 5, 11), { now })
    expect(result).toEqual({ level: 'overdue', label: 'Overdue' })
  })

  it('marks a deadline later today as urgent', () => {
    const result = getTaskUrgency(new Date(2026, 10, 5, 18), { now })
    expect(result).toEqual({ level: 'urgent', label: 'Due today' })
  })

  it('recognizes tomorrow across midnight rather than waiting 24 hours', () => {
    const result = getTaskUrgency(new Date(2026, 10, 6, 0), { now })
    expect(result).toEqual({ level: 'urgent', label: 'Due tomorrow' })
  })

  it('marks a deadline three days away as soon', () => {
    const result = getTaskUrgency(new Date(2026, 10, 8, 12), { now })
    expect(result).toEqual({ level: 'soon', label: 'Due in 3 days' })
  })

  it('marks a deadline seven days away as within the week', () => {
    const result = getTaskUrgency(new Date(2026, 10, 12, 12), { now })
    expect(result).toEqual({ level: 'week', label: 'Due in 7 days' })
  })

  it('does not show urgency for completed tasks or deadlines beyond a week', () => {
    expect(getTaskUrgency(new Date(2026, 10, 4), { now, done: true })).toBe(null)
    expect(getTaskUrgency(new Date(2026, 10, 13, 12), { now })).toBe(null)
  })

  it('handles missing and invalid dates without showing a misleading deadline', () => {
    expect(getTaskUrgency(null, { now })).toBe(null)
    expect(getTaskUrgency('invalid', { now })).toBe(null)
    expect(getTaskUrgency(new Date(2026, 10, 6), { now: 'invalid' })).toBe(null)
  })

  it('distinguishes an activity in progress from one that has ended', () => {
    const start = new Date(2026, 10, 5, 11)
    expect(getTaskUrgency(start, { now, prefix: 'Starts', end: new Date(2026, 10, 5, 13) }))
      .toEqual({ level: 'active', label: 'In progress' })
    expect(getTaskUrgency(start, { now, prefix: 'Starts', end: now })).toBe(null)
  })
})
