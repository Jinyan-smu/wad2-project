export const CALENDAR_TIME_ZONE = 'Asia/Singapore'

export function calendarInstant(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value) : null
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(raw) && !isCalendarDate(raw.slice(0, 10))) return null
  const zoned = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
      ? `${raw}+08:00`
      : raw
  const date = new Date(zoned)
  return Number.isFinite(date.getTime()) ? date : null
}

export function calendarDateKey(value = new Date()) {
  const date = calendarInstant(value)
  if (!date) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CALENDAR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function shiftCalendarDate(key, days) {
  const date = new Date(`${key}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function calendarWeekStart(key) {
  const date = new Date(`${key}T12:00:00Z`)
  return shiftCalendarDate(key, -((date.getUTCDay() + 6) % 7))
}

export function calendarMinutes(value) {
  const date = calendarInstant(value)
  if (!date) return 0
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CALENDAR_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return (
    Number(parts.find((p) => p.type === 'hour').value) * 60 +
    Number(parts.find((p) => p.type === 'minute').value)
  )
}

export function formatCalendarTime(value) {
  const date = calendarInstant(value)
  return date
    ? date.toLocaleTimeString('en-SG', {
        timeZone: CALENDAR_TIME_ZONE,
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''
}

export function formatCalendarDate(
  key,
  options = { weekday: 'short', day: 'numeric', month: 'short' },
) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-SG', {
    timeZone: CALENDAR_TIME_ZONE,
    ...options,
  })
}

export function buildCalendarEvents(data = {}) {
  const events = []
  let unscheduled = 0
  function add(event, start, end = null) {
    const startAt = calendarInstant(start)
    const endAt = calendarInstant(end)
    if (!startAt || (!event.point && (!endAt || endAt <= startAt))) {
      unscheduled++
      return
    }
    events.push({
      ...event,
      startAt: startAt.toISOString(),
      endAt: event.point ? null : endAt.toISOString(),
    })
  }
  for (const [kind, items] of [
    ['assignment', data.assignments],
    ['quiz', data.quizzes],
  ]) {
    for (const item of Array.isArray(items) ? items : []) {
      const date =
        kind === 'quiz'
          ? item.DueDate || item.StartDate || item.EventDate
          : item.DueDate || item.EventDate
      const query = new URLSearchParams({
        course: String(item.CourseId),
        search: item.Name || '',
        type: kind,
        id: String(item.Id),
      })
      add(
        {
          key: `${kind}:${item.CourseId}:${item.Id}`,
          category: 'deadlines',
          type: kind,
          title: item.Name || (kind === 'quiz' ? 'Untitled quiz' : 'Untitled assignment'),
          point: true,
          done: Boolean(item.Done),
          pointLabel: kind === 'quiz' && !item.DueDate ? 'Available' : 'Due',
          course: item.CourseName || '',
          location: '',
          description:
            kind === 'quiz'
              ? 'A coursework date, not a reserved study session. Open the quiz details to confirm its availability and deadline.'
              : 'Submission deadline only. Plan your preparation time separately.',
          to: `/assignments?${query}`,
          action: 'Open coursework',
        },
        date,
      )
    }
  }
  const seenMeetings = new Set()
  for (const item of Array.isArray(data.activities) ? data.activities : []) {
    const meeting = item.source === 'group-meeting'
    const meetingId = item.meetingId || item.id
    if (meeting && seenMeetings.has(String(meetingId))) continue
    if (meeting) seenMeetings.add(String(meetingId))
    add(
      {
        key: `${meeting ? 'meeting' : 'activity'}:${meeting ? meetingId : item.id}`,
        category: meeting ? 'meetings' : 'activities',
        type: meeting ? 'meeting' : 'activity',
        title: item.title || (meeting ? 'Group meeting' : 'Untitled activity'),
        point: false,
        done: Boolean(item.done),
        location: item.place || '',
        course: '',
        description:
          item.notes ||
          (meeting
            ? 'A confirmed meeting on your group schedule.'
            : item.outdoor
              ? 'Outdoor activity. Check the forecast before heading out.'
              : 'Your saved activity.'),
        to: meeting
          ? `/groupwork?${new URLSearchParams({ group: String(item.groupId || ''), meeting: String(meetingId) })}#meeting-${encodeURIComponent(meetingId)}`
          : `/activities?edit=${encodeURIComponent(item.id)}`,
        action: meeting ? 'Open group meeting' : 'Open activity',
      },
      item.when,
      item.end,
    )
  }
  for (const item of Array.isArray(data.classSessions) ? data.classSessions : []) {
    add(
      {
        key: `class:${item.id}`,
        category: 'classes',
        type: 'class',
        point: false,
        done: false,
        title: item.title || item.courseName || 'Class',
        course: item.courseName || '',
        location: item.location || '',
        description: 'Your scheduled class session.',
        to: null,
      },
      item.startAt,
      item.endAt,
    )
  }
  const unique = new Map(events.map((event) => [event.key, event]))
  return {
    events: [...unique.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    unscheduled,
  }
}

// Timed events are clipped to each Singapore day. Endpoints are half-open, so
// an event ending at midnight does not appear again on the following day.
export function eventsForCalendarDay(events, key) {
  const dayStart = Date.parse(`${key}T00:00:00+08:00`)
  const dayEnd = dayStart + 86400000
  return events
    .flatMap((event) => {
      const start = Date.parse(event.startAt)
      if (event.point)
        return start >= dayStart && start < dayEnd
          ? [{ ...event, segmentStart: start, segmentEnd: start }]
          : []
      const end = Date.parse(event.endAt)
      if (start >= dayEnd || end <= dayStart) return []
      return [
        {
          ...event,
          segmentStart: Math.max(start, dayStart),
          segmentEnd: Math.min(end, dayEnd),
          startMinute: (Math.max(start, dayStart) - dayStart) / 60000,
          endMinute: (Math.min(end, dayEnd) - dayStart) / 60000,
          continuesBefore: start < dayStart,
          continuesAfter: end > dayEnd,
        },
      ]
    })
    .sort((a, b) => a.segmentStart - b.segmentStart)
}

export function layoutCalendarDay(events) {
  const timed = events.filter((event) => !event.point).map((event) => ({ ...event }))
  let group = []
  let groupEnd = -Infinity
  const finish = () => {
    const lanes = []
    for (const event of group) {
      let lane = lanes.findIndex((end) => end <= event.startMinute)
      if (lane === -1) lane = lanes.length
      lanes[lane] = event.endMinute
      event.lane = lane
    }
    for (const event of group) event.lanes = lanes.length
  }
  for (const event of timed) {
    if (event.startMinute >= groupEnd) {
      finish()
      group = []
      groupEnd = -Infinity
    }
    group.push(event)
    groupEnd = Math.max(groupEnd, event.endMinute)
  }
  finish()
  return timed
}
