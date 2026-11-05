import { describe, expect, it } from 'vitest'
import {
  buildCalendarEvents,
  calendarDateKey,
  calendarInstant,
  calendarWeekStart,
  eventsForCalendarDay,
  isCalendarDate,
  layoutCalendarDay,
  shiftCalendarDate,
} from './calendarEvents'

describe('Overall calendar event model', () => {
  it('uses Singapore dates independently of the browser timezone', () => {
    expect(calendarDateKey('2026-11-04T17:00:00Z')).toBe('2026-11-05')
    expect(calendarDateKey('2026-11-05T00:00:00')).toBe('2026-11-05')
    expect(calendarInstant('2026-11-05T09:30').toISOString()).toBe('2026-11-05T01:30:00.000Z')
    expect(calendarWeekStart('2026-11-01')).toBe('2026-10-26')
    expect(shiftCalendarDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('rejects invalid dates rather than rolling them into another month', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(calendarInstant('2026-02-30T10:00:00+08:00')).toBeNull()
    expect(calendarInstant('not a date')).toBeNull()
  })

  it('retains the quiz deadline when both availability and due dates exist', () => {
    const { events } = buildCalendarEvents({
      quizzes: [
        {
          Id: 2,
          CourseId: 3,
          Name: 'SQL quiz',
          StartDate: '2026-11-03T09:00:00+08:00',
          DueDate: '2026-11-06T17:00:00+08:00',
        },
      ],
    })
    expect(events[0]).toMatchObject({
      key: 'quiz:3:2',
      point: true,
      pointLabel: 'Due',
      endAt: null,
    })
    expect(calendarDateKey(events[0].startAt)).toBe('2026-11-06')
    expect(events[0].to).toContain('type=quiz')
    expect(events[0].to).toContain('id=2')
    expect(layoutCalendarDay(eventsForCalendarDay(events, '2026-11-06'))).toHaveLength(0)
  })

  it('falls back to quiz availability without inventing a duration', () => {
    const { events } = buildCalendarEvents({
      quizzes: [{ Id: 1, CourseId: 1, Name: 'Quiz', StartDate: '2026-11-06T09:00:00+08:00' }],
    })
    expect(events[0]).toMatchObject({ pointLabel: 'Available', point: true, endAt: null })
  })

  it('counts undated and invalid ranges while preserving genuinely dated events', () => {
    const result = buildCalendarEvents({
      assignments: [
        { Id: 1, CourseId: 1, Name: 'Undated' },
        { Id: 2, CourseId: 1, Name: 'Valid', DueDate: '2026-11-05T17:00:00+08:00' },
      ],
      activities: [
        { id: 'bad', when: '2026-11-05T17:00:00+08:00', end: '2026-11-05T16:00:00+08:00' },
      ],
    })
    expect(result.unscheduled).toBe(2)
    expect(result.events.map((e) => e.title)).toEqual(['Valid'])
  })

  it('keeps confirmed meetings distinct from activities and deduplicates meeting IDs', () => {
    const meeting = {
      id: 'activity-m1',
      meetingId: 'm1',
      groupId: 'g1',
      source: 'group-meeting',
      title: 'Sync',
      when: '2026-11-05T15:00:00+08:00',
      end: '2026-11-05T16:00:00+08:00',
    }
    const { events } = buildCalendarEvents({ activities: [meeting, { ...meeting }] })
    expect(events).toHaveLength(1)
    expect(events[0].category).toBe('meetings')
    expect(events[0].to).toBe('/groupwork?group=g1&meeting=m1#meeting-m1')
  })

  it('splits overnight events across days and does not duplicate a midnight endpoint', () => {
    const { events } = buildCalendarEvents({
      activities: [
        {
          id: 'night',
          title: 'Hackathon',
          when: '2026-11-05T23:00:00+08:00',
          end: '2026-11-06T01:00:00+08:00',
        },
      ],
    })
    expect(eventsForCalendarDay(events, '2026-11-05')[0]).toMatchObject({
      startMinute: 1380,
      endMinute: 1440,
      continuesAfter: true,
    })
    expect(eventsForCalendarDay(events, '2026-11-06')[0]).toMatchObject({
      startMinute: 0,
      endMinute: 60,
      continuesBefore: true,
    })
    events[0].endAt = '2026-11-05T16:00:00.000Z'
    expect(eventsForCalendarDay(events, '2026-11-06')).toEqual([])
  })

  it('gives simultaneous events separate lanes and reuses lanes for touching events', () => {
    const rows = layoutCalendarDay([
      { key: 'a', point: false, startMinute: 540, endMinute: 600 },
      { key: 'b', point: false, startMinute: 570, endMinute: 630 },
      { key: 'c', point: false, startMinute: 600, endMinute: 660 },
      { key: 'd', point: false, startMinute: 660, endMinute: 690 },
    ])
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0])
    expect(rows.map((row) => row.lanes)).toEqual([2, 2, 2, 1])
  })
})
