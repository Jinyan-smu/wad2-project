'use strict'

const { randomInt } = require('node:crypto')

/*
 * Group Meetings domain logic.
 *
 * Four independent pieces of behaviour live here, kept free of Express and
 * of file I/O so they can be unit tested directly:
 *
 *   1. Availability matching  -> buildWindow() + evaluateReadiness() + findCommonTimes()
 *   2. Booking a meeting       -> validateBookingDraft() + findBookingConflicts()
 *   3. Invitation state machine -> checkInvitationAllowed() + applyInvitationResponse()
 *   4. Group membership        -> joinGroupByCode() + leaveGroup() + removeGroupMember()
 *
 * Time conventions used everywhere in this module:
 *   - Timestamps are epoch milliseconds internally, ISO 8601 UTC strings at the edges.
 *   - Intervals are half open: [startAt, endAt). Two intervals that only touch
 *     (10:00-11:00 and 11:00-12:00) do NOT overlap and are merged into one block.
 *   - A calendar day is expressed in Singapore wall clock (UTC+8, no DST), so
 *     "09:00" always means 09:00 at SMU.
 */

const TIME_ZONE = 'Asia/Singapore'
const SG_OFFSET = '+08:00'
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const STEP_MINUTES = 15
const ALLOWED_DURATIONS = [30, 60, 90]
const ALLOWED_ASSIGNMENT_BUFFERS = [0, 30, 60, 90, 120]
const MAX_RANGE_DAYS = 31
const MAX_SLOTS = 240
const MAX_GROUP_MEMBERS = 12
const MAX_GROUP_NAME = 80
const GROUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GROUP_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/

const MIN_MEETING_MINUTES = 15
const MAX_MEETING_MINUTES = 8 * 60
const MAX_MEETING_TITLE = 80

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code || 'error'
  }
}

class ValidationError extends HttpError {
  constructor(message) {
    super(400, message, 'invalid_input')
    this.name = 'ValidationError'
  }
}

/* ------------------------------------------------------------------ *
 * Date and time helpers
 * ------------------------------------------------------------------ */

function requireDate(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = DATE_PATTERN.exec(text)
  if (!match) {
    throw new ValidationError(`${field} must use the YYYY-MM-DD format.`)
  }

  const [, year, month, day] = match
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const check = new Date(stamp)
  if (
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day)
  ) {
    throw new ValidationError(`${field} is not a real calendar date.`)
  }

  return text
}

function requireTime(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!TIME_PATTERN.test(text)) {
    throw new ValidationError(`${field} must use the 24-hour HH:MM format.`)
  }

  return text
}

/** Singapore wall clock -> absolute instant. */
function sgInstant(dateText, timeText = '00:00') {
  const stamp = Date.parse(`${dateText}T${timeText}:00${SG_OFFSET}`)
  if (Number.isNaN(stamp)) {
    throw new ValidationError(`Could not read the date and time "${dateText} ${timeText}".`)
  }

  return stamp
}

function shiftDate(dateText, days) {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) + days * DAY).toISOString().slice(0, 10)
}

function toIso(stamp) {
  return new Date(stamp).toISOString()
}

function minutesBetween(start, end) {
  return Math.round((end - start) / MINUTE)
}

function validateAssignmentBuffer(value) {
  const minutes = value === undefined ? 60 : Number(value)
  if ((value !== undefined && !['number', 'string'].includes(typeof value)) ||
      (typeof value === 'string' && value.trim() === '') || !ALLOWED_ASSIGNMENT_BUFFERS.includes(minutes)) {
    throw new ValidationError('Assignment buffer must be 0, 30, 60, 90, or 120 minutes.')
  }
  return minutes
}

/**
 * Turns the four form inputs into concrete per-day search windows.
 * Multi-day ranges repeat the same daily window (e.g. 09:00-18:00 every day)
 * instead of becoming one long overnight interval.
 */
function buildWindow(input = {}) {
  const fromDate = requireDate(input.fromDate, 'From date')
  const toDate = requireDate(input.toDate, 'To date')
  const startTime = requireTime(input.startTime, 'Earliest time')
  const endTime = requireTime(input.endTime, 'Latest time')

  if (startTime >= endTime) {
    throw new ValidationError('The latest time must be later than the earliest time.')
  }
  if (sgInstant(fromDate, startTime) > sgInstant(toDate, endTime)) {
    throw new ValidationError('The end of the range must come after its start.')
  }

  const daySpan = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY) + 1
  if (daySpan > MAX_RANGE_DAYS) {
    throw new ValidationError(`Choose a range of ${MAX_RANGE_DAYS} days or fewer.`)
  }

  const durationMinutes = Number(input.durationMinutes)
  if (!ALLOWED_DURATIONS.includes(durationMinutes)) {
    throw new ValidationError(
      `Meeting length must be one of ${ALLOWED_DURATIONS.join(', ')} minutes.`,
    )
  }

  const days = []
  for (let index = 0; index < daySpan; index += 1) {
    const date = shiftDate(fromDate, index)
    days.push({ date, start: sgInstant(date, startTime), end: sgInstant(date, endTime) })
  }

  return {
    fromDate,
    toDate,
    startTime,
    endTime,
    durationMinutes,
    assignmentBufferMinutes: validateAssignmentBuffer(input.assignmentBufferMinutes),
    stepMinutes: STEP_MINUTES,
    days,
    start: days[0].start,
    end: days[days.length - 1].end,
  }
}

/* ------------------------------------------------------------------ *
 * Interval algebra
 * ------------------------------------------------------------------ */

/** Keeps well formed intervals only; malformed records never become "free". */
function normalizeIntervals(intervals) {
  const normalized = []
  for (const item of Array.isArray(intervals) ? intervals : []) {
    if (!item || typeof item !== 'object') continue

    const start = Date.parse(item.startAt)
    const end = Date.parse(item.endAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue

    normalized.push({ userId: item.userId, start, end })
  }

  return normalized
}

/** Sorts and coalesces overlapping or touching intervals into disjoint blocks. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged = []

  for (const item of sorted) {
    const last = merged[merged.length - 1]
    if (last && item.start <= last.end) {
      if (item.end > last.end) last.end = item.end
    } else {
      merged.push({ start: item.start, end: item.end })
    }
  }

  return merged
}

/** window minus busy -> the free gaps inside [windowStart, windowEnd). */
function freeGaps(windowStart, windowEnd, busyMerged) {
  const gaps = []
  let cursor = windowStart

  for (const block of busyMerged) {
    if (block.end <= cursor) continue
    if (block.start >= windowEnd) break

    if (block.start > cursor) {
      gaps.push({ start: cursor, end: Math.min(block.start, windowEnd) })
    }

    cursor = Math.max(cursor, block.end)
    if (cursor >= windowEnd) break
  }

  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd })
  }

  return gaps
}

/** Rounds up to the next point of the day grid (origin = day window start). */
function alignUp(value, origin, step) {
  if (value <= origin) return origin
  return origin + Math.ceil((value - origin) / step) * step
}

/* ------------------------------------------------------------------ *
 * 1. Availability matching
 * ------------------------------------------------------------------ */

/**
 * The readiness gate. Matching is only meaningful when every selected member has
 * (a) a complete schedule and (b) calendar coverage that actually spans the
 * requested range. Sharing is no longer a separate step: group members are
 * always included in matching, so there is no "not shared" blocker.
 *
 * Missing information is UNKNOWN, never FREE, so any failed check blocks the
 * whole calculation instead of silently treating the gap as free time.
 */
function evaluateReadiness({ group, members, shares, windowStart, windowEnd }) {
  const blockers = []

  for (const userId of group.memberIds) {
    const member = members.find((item) => item.id === userId)
    const name = member?.name || userId

    if (!member) {
      blockers.push({
        userId,
        name,
        reason: 'unknown_member',
        message: `${name} has no profile in this group yet.`,
      })
      continue
    }

    if (member.scheduleStatus !== 'complete') {
      blockers.push({
        userId,
        name,
        reason: 'schedule_incomplete',
        message: `${name}'s calendar is not marked as complete.`,
      })
      continue
    }

    const coverageStart = member.coverageStartAt ? Date.parse(member.coverageStartAt) : NaN
    const coverageEnd = member.coverageEndAt ? Date.parse(member.coverageEndAt) : NaN

    if (Number.isFinite(coverageStart) && coverageStart > windowStart) {
      blockers.push({
        userId,
        name,
        reason: 'coverage_partial',
        message: `${name}'s calendar only starts at ${toIso(coverageStart)}.`,
      })
      continue
    }

    if (Number.isFinite(coverageEnd) && coverageEnd < windowEnd) {
      blockers.push({
        userId,
        name,
        reason: 'coverage_partial',
        message: `${name}'s calendar ends before the requested range.`,
      })
    }
  }

  return { ready: blockers.length === 0, blockers }
}

/**
 * Core matching algorithm.
 *
 *   busy      = union of every busy interval of every selected member
 *               (a member's other groups count as busy too, so only the
 *               group controls WHO is included, never WHICH intervals)
 *   free      = per day: [dayStart, dayEnd) minus busy
 *   feasible  = every point on the 15 minute grid where [t, t + duration)
 *               fits entirely inside one free gap
 *
 * Because the result is derived from the union, "free for everyone" is exact:
 * a slot is emitted only when it overlaps nobody's busy interval.
 */
function findCommonTimes({ memberIds, busyIntervals, window, now = -Infinity }) {
  const selected = new Set(memberIds)
  const relevant = normalizeIntervals(busyIntervals).filter((item) => selected.has(item.userId))
  const busyMerged = mergeIntervals(relevant)

  const durationMs = window.durationMinutes * MINUTE
  const stepMs = window.stepMinutes * MINUTE
  const days = []
  let totalSlots = 0
  let best = null
  let truncated = false

  for (const day of window.days) {
    const gaps = freeGaps(Math.max(day.start, now), day.end, busyMerged)
    const blocks = []
    let freeMinutes = 0

    for (const gap of gaps) {
      freeMinutes += minutesBetween(gap.start, gap.end)
      if (gap.end - gap.start < durationMs) continue

      const slots = []
      for (let start = alignUp(gap.start, day.start, stepMs); start + durationMs <= gap.end; start += stepMs) {
        if (totalSlots >= MAX_SLOTS) {
          truncated = true
          break
        }

        const slot = {
          startAt: toIso(start),
          endAt: toIso(start + durationMs),
          slackMinutes: minutesBetween(start + durationMs, gap.end),
          startsRightAfterBusy: start === gap.start,
        }

        slots.push(slot)
        totalSlots += 1
        if (!best) best = { ...slot, date: day.date }
      }

      if (slots.length) {
        blocks.push({
          startAt: toIso(gap.start),
          endAt: toIso(gap.end),
          lengthMinutes: minutesBetween(gap.start, gap.end),
          maxMeetings: Math.floor((gap.end - gap.start) / durationMs),
          slots,
        })
      }

      if (truncated) break
    }

    days.push({ date: day.date, freeMinutes, blocks })
    if (truncated) break
  }

  return {
    days, best, totalSlots, truncated,
    availability: buildAvailabilityGrid({ memberIds, busyIntervals, window, now }),
  }
}

/** The complete 15-minute grid is independent of the suggestion-list cap. */
function buildAvailabilityGrid({ memberIds, busyIntervals, window, now = -Infinity }) {
  const selected = new Set(memberIds)
  const relevant = normalizeIntervals(busyIntervals).filter(item => selected.has(item.userId))
  const stepMs = window.stepMinutes * MINUTE
  const durationMs = window.durationMinutes * MINUTE
  const days = window.days.map(day => {
    const cells = []
    for (let start = day.start; start < day.end; start += stepMs) {
      const end = Math.min(start + stepMs, day.end)
      const busy = new Set(relevant.filter(item => item.start < end && item.end > start).map(item => item.userId))
      const bookingEnd = start + durationMs
      cells.push({
        startAt: toIso(start),
        endAt: toIso(end),
        freeCount: selected.size - busy.size,
        totalCount: selected.size,
        busyMemberIds: memberIds.filter(userId => busy.has(userId)),
        canBook: selected.size > 0 && start >= now && bookingEnd <= day.end &&
          !relevant.some(item => item.start < bookingEnd && item.end > start),
      })
    }
    return { date: day.date, cells }
  })
  return { stepMinutes: window.stepMinutes, days }
}

/** Convert private planner records into intervals and aggregate counts only. */
function buildPlannerBusyIntervals({
  userId, activities = [], assignments = [], quizzes = [], progress = {},
  assignmentBufferMinutes = 60, rangeStart = -Infinity, rangeEnd = Infinity,
}) {
  const buffer = validateAssignmentBuffer(assignmentBufferMinutes)
  const busyIntervals = []
  const sourceKeys = { activities: new Set(), assignments: new Set(), quizzes: new Set() }
  const inactive = item => item.cancelled === true || item.Cancelled === true ||
    ['cancelled', 'canceled', 'completed', 'done'].includes(String(item.status ?? item.Status ?? '').toLowerCase())
  const append = (startValue, endValue) => {
    const start = Date.parse(startValue)
    const end = Date.parse(endValue)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= rangeEnd || end <= rangeStart) return false
    busyIntervals.push({ userId, startAt: toIso(start), endAt: toIso(end) })
    return true
  }
  for (const [index, activity] of activities.entries()) {
    if (inactive(activity) || activity.done === true || activity.Done === true) continue
    if (append(activity.when ?? activity.startAt, activity.end ?? activity.endAt)) {
      sourceKeys.activities.add(String(activity.id ?? activity.Id ?? `${userId}:activity:${index}`))
    }
  }
  for (const [kind, items] of [['assignment', assignments], ['quiz', quizzes]]) {
    for (const [index, item] of items.entries()) {
      const itemId = kind === 'quiz' ? item.QuizId ?? item.Id : item.Id
      const progressKey = `${kind}:${item.CourseId}:${itemId}`
      if (inactive(item) || (progress[progressKey] ?? item.Done ?? item.done ?? false)) continue
      let included = false
      for (const [startKey, endKey] of [
        ['startAt', 'endAt'], ['StartAt', 'EndAt'], ['ScheduledStartAt', 'ScheduledEndAt'], ['StartDate', 'EndDate'],
      ]) {
        if (append(item[startKey], item[endKey])) { included = true; break }
      }
      const due = Date.parse(item.DueDate)
      if (buffer > 0 && Number.isFinite(due)) {
        included = append(toIso(due - buffer * MINUTE), toIso(due)) || included
      }
      if (included) {
        sourceKeys[kind === 'assignment' ? 'assignments' : 'quizzes'].add(
          `${item.IsCustom ? 'custom' : 'reference'}:${item.CourseId ?? ''}:${itemId ?? `${userId}:${index}`}`,
        )
      }
    }
  }
  return {
    busyIntervals,
    sources: Object.fromEntries(Object.entries(sourceKeys).map(([kind, keys]) => [kind, keys.size])),
    // These keys are internal to server-side aggregation; HTTP responses expose counts only.
    sourceKeys: Object.fromEntries(Object.entries(sourceKeys).map(([kind, keys]) => [kind, [...keys]])),
  }
}

/* ------------------------------------------------------------------ *
 * 2. Booking a meeting
 * ------------------------------------------------------------------ */

/**
 * Turns a booking request into a checked draft.
 *
 * A booking is a commitment, not a suggestion, so it is validated harder than
 * a search: the title must be present, the end must come after the start, the
 * meeting must still be in the future, and every participant has to be a
 * current member. Participants default to the whole group because a group
 * meeting normally involves everyone.
 */
function validateBookingDraft({ draft = {}, group, viewerId, now = Date.now() }) {
  if (!group) {
    throw new HttpError(404, 'That group does not exist.', 'group_not_found')
  }
  if (!group.memberIds.includes(viewerId)) {
    throw new HttpError(403, 'You are not a member of that group.', 'not_a_member')
  }

  const title = typeof draft.title === 'string' ? draft.title.trim() : ''
  if (title.length < 2 || title.length > MAX_MEETING_TITLE) {
    throw new ValidationError(
      `Meeting title must be between 2 and ${MAX_MEETING_TITLE} characters.`,
    )
  }

  const start = Date.parse(draft.startAt)
  const end = Date.parse(draft.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new ValidationError('The meeting needs a valid start and end time.')
  }
  if (end <= start) {
    throw new ValidationError('The meeting must end after it starts.')
  }

  const durationMinutes = minutesBetween(start, end)
  if (durationMinutes < MIN_MEETING_MINUTES) {
    throw new ValidationError(`A meeting must last at least ${MIN_MEETING_MINUTES} minutes.`)
  }
  if (durationMinutes > MAX_MEETING_MINUTES) {
    throw new ValidationError(`A meeting can last at most ${MAX_MEETING_MINUTES / 60} hours.`)
  }

  if (start < now) {
    throw new HttpError(400, 'That time is already in the past.', 'meeting_in_past')
  }

  const requested = Array.isArray(draft.participantIds) && draft.participantIds.length
    ? [...new Set(draft.participantIds.map(String))]
    : [...group.memberIds]

  if (requested.some((userId) => !group.memberIds.includes(userId))) {
    throw new ValidationError('Every participant must be a member of this group.')
  }

  return {
    title, start, end, durationMinutes, participantIds: requested,
    assignmentBufferMinutes: validateAssignmentBuffer(draft.assignmentBufferMinutes),
  }
}

/**
 * Half open overlap test against every participant's busy intervals, which
 * already include previously booked meetings. Returns one entry per blocked
 * participant; only names are exposed, never event titles.
 */
function findBookingConflicts({ participantIds, start, end, busyIntervals, members }) {
  const wanted = new Set(participantIds)
  const clashes = []

  for (const item of normalizeIntervals(busyIntervals)) {
    if (!wanted.has(item.userId)) continue
    if (item.end <= start || item.start >= end) continue
    if (clashes.some((clash) => clash.userId === item.userId)) continue

    clashes.push({
      userId: item.userId,
      name: members?.find((member) => member.id === item.userId)?.name || item.userId,
    })
  }

  return clashes
}

/** The stored record plus the busy intervals that keep the slot blocked. */
function buildMeetingRecords({ draft, groupId, createdBy, makeId, forced = false }) {
  const startAt = toIso(draft.start)
  const endAt = toIso(draft.end)
  const meeting = {
    id: makeId('meeting'),
    groupId,
    title: draft.title,
    participantIds: draft.participantIds,
    startAt,
    endAt,
    status: 'booked',
    createdBy,
    createdAt: new Date().toISOString(),
    // Recorded so an intentional double booking stays visible in the list.
    forced: forced === true,
    assignmentBufferMinutes: draft.assignmentBufferMinutes,
  }

  const busyIntervals = draft.participantIds.map((userId) => ({
    id: makeId('busy'),
    userId,
    sourceType: 'meeting',
    sourceMeetingId: meeting.id,
    startAt,
    endAt,
  }))

  return { meeting, busyIntervals }
}

/** A booked meeting is an activity on the personal planner as well. */
function meetingToActivity(meeting, groupName) {
  return {
    id: `activity-${meeting.id}`,
    title: meeting.title,
    place: groupName || 'Group meeting',
    outdoor: false,
    when: meeting.startAt,
    end: meeting.endAt,
    done: false,
    source: 'group-meeting',
    groupId: meeting.groupId,
    meetingId: meeting.id,
  }
}

/**
 * Cancelling is destructive, so it is limited to the two people with standing:
 * whoever booked the meeting, and the group owner.
 */
function checkMeetingCancellable({ meeting, group, actorId }) {
  if (!meeting) {
    throw new HttpError(404, 'That meeting does not exist.', 'meeting_not_found')
  }
  if (!group) {
    throw new HttpError(404, 'The group for this meeting no longer exists.', 'group_not_found')
  }
  if (!group.memberIds.includes(actorId)) {
    throw new HttpError(403, 'You are not a member of that group.', 'not_a_member')
  }
  if (meeting.createdBy !== actorId && group.ownerId !== actorId) {
    throw new HttpError(
      403,
      'Only the person who booked this meeting or the group owner can cancel it.',
      'not_allowed',
    )
  }

  return true
}

/* ------------------------------------------------------------------ *
 * Group join codes
 * ------------------------------------------------------------------ */

function normalizeGroupCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!GROUP_CODE_PATTERN.test(code)) {
    throw new ValidationError('Enter the 8-character group code using letters and numbers.')
  }
  return code
}

function createGroupCode(groups) {
  const used = new Set(groups.map(group => group.joinCode))
  let code
  do {
    code = Array.from({ length: 8 }, () =>
      GROUP_CODE_ALPHABET[randomInt(GROUP_CODE_ALPHABET.length)],
    ).join('')
  } while (used.has(code))
  return code
}

/** Existing groups receive a persistent code under the store's write lock. */
function ensureGroupCodes(groups) {
  for (const group of groups) {
    if (!group.joinCode) group.joinCode = createGroupCode(groups)
  }
}

function joinGroupByCode({ groups, invitations, code, userId, now = Date.now() }) {
  const normalized = normalizeGroupCode(code)
  const group = groups.find(item => item.joinCode === normalized)
  if (!group) {
    throw new HttpError(404, 'No group matches that code. Check it with your teammate.', 'invalid_group_code')
  }
  if (group.memberIds.includes(userId)) {
    throw new HttpError(409, 'You already belong to this group.', 'already_member')
  }
  if (group.memberIds.length >= MAX_GROUP_MEMBERS) {
    throw new HttpError(409, `A group can hold at most ${MAX_GROUP_MEMBERS} members.`, 'group_full')
  }

  group.memberIds.push(userId)
  // Joining fulfils any outstanding email invitations for the same group.
  for (const invitation of invitations) {
    if (invitation.groupId === group.id && invitation.toUserId === userId && invitation.status === 'pending') {
      applyInvitationResponse({ invitation, group, actorId: userId, action: 'accept', now })
    }
  }
  return group
}

/** Leaving also removes meeting commitments created by this group's membership. */
function leaveGroup({ state, groupId, userId, now = Date.now() }) {
  const group = state.groups.find(item => item.id === groupId)
  if (!group) {
    throw new HttpError(404, 'That group does not exist.', 'group_not_found')
  }
  if (!group.memberIds.includes(userId)) {
    throw new HttpError(403, 'You are not a member of that group.', 'not_a_member')
  }

  group.memberIds = group.memberIds.filter(id => id !== userId)
  const deleted = group.memberIds.length === 0
  const groupMeetingIds = new Set(
    state.meetings.filter(meeting => meeting.groupId === groupId).map(meeting => meeting.id),
  )
  const removedMeetingIds = new Set()

  if (deleted) {
    state.groups = state.groups.filter(item => item.id !== groupId)
    state.invitations = state.invitations.filter(item => item.groupId !== groupId)
    state.availabilityShares = state.availabilityShares.filter(item => item.groupId !== groupId)
    if (state.defaultGroupId === groupId) state.defaultGroupId = null
    for (const meetingId of groupMeetingIds) removedMeetingIds.add(meetingId)
  } else {
    if (group.ownerId === userId) group.ownerId = group.memberIds[0]
    state.availabilityShares = state.availabilityShares.filter(
      item => item.groupId !== groupId || item.userId !== userId,
    )
    for (const invitation of state.invitations) {
      if (invitation.groupId === groupId && invitation.fromUserId === userId && invitation.status === 'pending') {
        applyInvitationResponse({ invitation, group, actorId: userId, action: 'cancel', now })
      }
    }
    for (const meeting of state.meetings) {
      if (!groupMeetingIds.has(meeting.id) || !Array.isArray(meeting.participantIds)) continue
      if (!meeting.participantIds.includes(userId)) continue
      meeting.participantIds = meeting.participantIds.filter(id => id !== userId)
      // An empty meeting is cancelled using the same record-removal convention
      // as the normal meeting cancellation endpoint.
      if (meeting.participantIds.length === 0) removedMeetingIds.add(meeting.id)
    }
  }

  state.meetings = state.meetings.filter(meeting => !removedMeetingIds.has(meeting.id))
  state.busyIntervals = state.busyIntervals.filter(interval =>
    !removedMeetingIds.has(interval.sourceMeetingId) &&
    !(groupMeetingIds.has(interval.sourceMeetingId) && interval.userId === userId),
  )

  return {
    groupId,
    groupName: group.name,
    deleted,
    newOwnerId: deleted ? null : group.ownerId,
  }
}

/** Owners can remove another member, with the same commitment cleanup as leaving. */
function removeGroupMember({ state, groupId, actorId, memberId, now = Date.now() }) {
  const group = state.groups.find(item => item.id === groupId)
  if (!group) {
    throw new HttpError(404, 'That group does not exist.', 'group_not_found')
  }
  if (group.ownerId !== actorId || !group.memberIds.includes(actorId)) {
    throw new HttpError(403, 'Only the group owner can remove members.', 'not_group_owner')
  }
  if (memberId === group.ownerId) {
    throw new HttpError(409, 'Use Leave group if you want to leave your own group.', 'cannot_remove_owner')
  }
  if (!group.memberIds.includes(memberId)) {
    throw new HttpError(404, 'That person is no longer a member of this group.', 'member_not_found')
  }

  const result = leaveGroup({ state, groupId, userId: memberId, now })
  // A pending invitation must not restore membership after the owner removes it.
  for (const invitation of state.invitations) {
    if (invitation.groupId === groupId && invitation.toUserId === memberId && invitation.status === 'pending') {
      invitation.status = 'cancelled'
      invitation.respondedAt = new Date(now).toISOString()
    }
  }
  return { ...result, removedMemberId: memberId }
}

/* ------------------------------------------------------------------ *
 * 3. Invitation state machine
 * ------------------------------------------------------------------ */

const INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'cancelled']

/**
 * pending -> accepted  : invitee joins the group (membership only, no consent)
 * pending -> declined  : invitee refuses
 * pending -> cancelled : sender withdraws
 * accepted/declined/cancelled are terminal.
 */
function checkInvitationAllowed({ group, inviterId, targetUser, invitations }) {
  if (!group) throw new HttpError(404, 'That group does not exist.', 'group_not_found')

  if (!group.memberIds.includes(inviterId)) {
    throw new HttpError(403, 'Only current members can invite people into this group.', 'not_a_member')
  }

  if (!targetUser) {
    throw new HttpError(404, 'No account uses that email address.', 'user_not_found')
  }

  if (targetUser.id === inviterId) {
    throw new ValidationError('You cannot invite yourself.')
  }

  if (group.memberIds.includes(targetUser.id)) {
    throw new HttpError(409, 'That account is already a member of this group.', 'already_member')
  }

  if (group.memberIds.length >= MAX_GROUP_MEMBERS) {
    throw new HttpError(409, `A group can hold at most ${MAX_GROUP_MEMBERS} members.`, 'group_full')
  }

  const duplicate = (invitations || []).find(
    (item) =>
      item.groupId === group.id && item.toUserId === targetUser.id && item.status === 'pending',
  )

  if (duplicate) {
    throw new HttpError(
      409,
      'An invitation for that account is already waiting for a reply.',
      'invitation_pending',
    )
  }

  return true
}

/**
 * Applies accept / decline / cancel to a pending invitation and returns the
 * updated record. Accepting also adds the invitee to the group.
 */
const ACTION_TO_STATUS = {
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
}

function applyInvitationResponse({ invitation, group, actorId, action, now = Date.now() }) {
  if (!invitation) {
    throw new HttpError(404, 'That invitation does not exist.', 'invitation_not_found')
  }

  const status = ACTION_TO_STATUS[action]
  if (!status || !INVITATION_STATUSES.includes(status)) {
    throw new ValidationError('Unknown invitation action.')
  }

  if (action === 'cancel') {
    if (invitation.fromUserId !== actorId) {
      throw new HttpError(403, 'Only the sender can cancel this invitation.', 'not_sender')
    }
  } else if (invitation.toUserId !== actorId) {
    throw new HttpError(403, 'Only the invited account can answer this invitation.', 'not_invitee')
  }

  if (invitation.status !== 'pending') {
    throw new HttpError(
      409,
      `This invitation was already ${invitation.status}.`,
      'invitation_not_pending',
    )
  }

  if (
    status === 'accepted' &&
    group &&
    !group.memberIds.includes(invitation.toUserId) &&
    group.memberIds.length >= MAX_GROUP_MEMBERS
  ) {
    throw new HttpError(409, `A group can hold at most ${MAX_GROUP_MEMBERS} members.`, 'group_full')
  }

  invitation.status = status
  invitation.respondedAt = new Date(now).toISOString()

  if (status === 'accepted' && group && !group.memberIds.includes(invitation.toUserId)) {
    group.memberIds.push(invitation.toUserId)
  }

  return invitation
}

/** The invitee must still be reachable when the invitation is answered. */
function assertGroupStillExists(group) {
  if (!group) throw new HttpError(404, 'The group for this invitation no longer exists.', 'group_not_found')
}

module.exports = {
  TIME_ZONE,
  HttpError,
  ValidationError,
  MAX_GROUP_MEMBERS,
  MAX_GROUP_NAME,
  normalizeGroupCode,
  createGroupCode,
  ensureGroupCodes,
  joinGroupByCode,
  leaveGroup,
  removeGroupMember,
  ALLOWED_DURATIONS,
  validateAssignmentBuffer,
  buildAvailabilityGrid,
  buildPlannerBusyIntervals,
  MIN_MEETING_MINUTES,
  MAX_MEETING_MINUTES,
  INVITATION_STATUSES,
  buildWindow,
  normalizeIntervals,
  mergeIntervals,
  freeGaps,
  evaluateReadiness,
  findCommonTimes,
  validateBookingDraft,
  findBookingConflicts,
  buildMeetingRecords,
  meetingToActivity,
  checkMeetingCancellable,
  checkInvitationAllowed,
  applyInvitationResponse,
  assertGroupStillExists,
  minutesBetween,
  toIso,
}
