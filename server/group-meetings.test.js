'use strict'

/*
 * Run with: node --test  (from the server folder)
 *
 * These tests cover the two pieces of behaviour that the Group Meetings screen
 * depends on: availability matching and the invitation state machine.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const gm = require('./group-meetings')

const SEED_FILE = path.join(
  __dirname,
  '..',
  'Student Activity Planner',
  'src',
  'data',
  'group-meetings.mock.json',
)
const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'))

const DEMO_GROUP = seed.groups.find((group) => group.id === 'mock-group-is216')

function windowFor(overrides = {}) {
  return gm.buildWindow({
    fromDate: '2026-10-26',
    toDate: '2026-10-26',
    startTime: '09:00',
    endTime: '18:00',
    durationMinutes: 60,
    ...overrides,
  })
}

test('mergeIntervals coalesces overlapping and touching intervals', () => {
  const merged = gm.mergeIntervals([
    { start: 0, end: 60 },
    { start: 60, end: 90 },
    { start: 20, end: 30 },
    { start: 200, end: 260 },
  ])

  assert.deepEqual(merged, [
    { start: 0, end: 90 },
    { start: 200, end: 260 },
  ])
})

test('buildWindow rejects impossible ranges and unsupported lengths', () => {
  assert.throws(() => windowFor({ startTime: '18:00', endTime: '09:00' }), /latest time/i)
  assert.throws(() => windowFor({ fromDate: '2026-10-27', toDate: '2026-10-26' }), /after its start/i)
  assert.throws(() => windowFor({ fromDate: '26-10-2026' }), /YYYY-MM-DD/i)
  assert.throws(() => windowFor({ durationMinutes: 45 }), /30, 60, 90/)
})

test('buildWindow repeats the same daily window for a multi-day range', () => {
  const window = windowFor({ toDate: '2026-10-27' })

  assert.equal(window.days.length, 2)
  assert.equal(gm.minutesBetween(window.days[1].start, window.days[1].end), 9 * 60)
})

test('findCommonTimes returns only slots that fit inside everyone\'s free time', () => {
  const window = windowFor({ toDate: '2026-10-27' })
  const result = gm.findCommonTimes({
    memberIds: DEMO_GROUP.memberIds,
    busyIntervals: seed.busyIntervals,
    window,
  })

  const starts = result.days.flatMap((day) =>
    day.blocks.flatMap((block) => block.slots.map((slot) => slot.startAt)),
  )

  // 26 Oct: everyone is busy 09:00-15:00, A has the seeded study meeting
  // 16:00-17:00 and C is busy from 16:30, so 15:00-16:00 is the only opening.
  // 27 Oct: the only common gap is 11:00-12:00.
  assert.deepEqual(starts, ['2026-10-26T07:00:00.000Z', '2026-10-27T03:00:00.000Z'])
  assert.equal(result.best.startAt, '2026-10-26T07:00:00.000Z')
})

test('no returned slot overlaps any selected member\'s busy interval', () => {
  const window = windowFor({ toDate: '2026-10-27', durationMinutes: 30 })
  const result = gm.findCommonTimes({
    memberIds: DEMO_GROUP.memberIds,
    busyIntervals: seed.busyIntervals,
    window,
  })

  const busy = gm.mergeIntervals(
    gm.normalizeIntervals(seed.busyIntervals).filter((item) =>
      DEMO_GROUP.memberIds.includes(item.userId),
    ),
  )
  const slots = result.days.flatMap((day) => day.blocks.flatMap((block) => block.slots))
  assert.ok(slots.length > 0)

  for (const slot of slots) {
    const start = Date.parse(slot.startAt)
    const end = Date.parse(slot.endAt)
    for (const block of busy) {
      assert.ok(end <= block.start || start >= block.end, `slot ${slot.startAt} overlaps busy time`)
    }
  }
})

test('a member\'s busy time booked in another group still counts', () => {
  // mock-user-a's study meeting lives in mock-group-study. Dropping that
  // meeting interval opens up extra slots in the demo group, which proves the
  // interval was counted for the member even though it belongs to another group.
  const window = windowFor({ durationMinutes: 60 })
  const withMeeting = gm.findCommonTimes({
    memberIds: DEMO_GROUP.memberIds,
    busyIntervals: seed.busyIntervals,
    window,
  })
  const withoutMeeting = gm.findCommonTimes({
    memberIds: DEMO_GROUP.memberIds,
    busyIntervals: seed.busyIntervals.filter((item) => item.sourceType !== 'meeting'),
    window,
  })

  assert.equal(withMeeting.totalSlots, 1)
  assert.equal(withoutMeeting.totalSlots, 3)
  assert.ok(
    withMeeting.days[0].blocks.every(
      (block) => Date.parse(block.endAt) <= Date.parse('2026-10-26T16:00:00+08:00'),
    ),
  )
})

test('an unshared or incomplete calendar blocks the calculation instead of counting as free', () => {
  const window = windowFor()

  const unshared = gm.evaluateReadiness({
    group: DEMO_GROUP,
    members: seed.members,
    shares: seed.availabilityShares.map((share) =>
      share.userId === 'mock-user-b' && share.groupId === DEMO_GROUP.id
        ? { ...share, enabled: false }
        : share,
    ),
    windowStart: window.start,
    windowEnd: window.end,
  })

  assert.equal(unshared.ready, false)
  assert.equal(unshared.blockers[0].reason, 'not_shared')

  const incomplete = gm.evaluateReadiness({
    group: DEMO_GROUP,
    members: seed.members.map((member) =>
      member.id === 'mock-user-c' ? { ...member, scheduleStatus: 'partial' } : member,
    ),
    shares: seed.availabilityShares,
    windowStart: window.start,
    windowEnd: window.end,
  })

  assert.equal(incomplete.ready, false)
  assert.equal(incomplete.blockers[0].reason, 'schedule_incomplete')
})

test('coverage shorter than the requested range blocks the calculation', () => {
  const window = windowFor({ toDate: '2026-10-27' })
  const readiness = gm.evaluateReadiness({
    group: DEMO_GROUP,
    members: seed.members.map((member) =>
      member.id === 'mock-user-a' ? { ...member, coverageEndAt: '2026-10-27T00:00:00+08:00' } : member,
    ),
    shares: seed.availabilityShares,
    windowStart: window.start,
    windowEnd: window.end,
  })

  assert.equal(readiness.ready, false)
  assert.equal(readiness.blockers[0].reason, 'coverage_partial')
})

test('a complete, fully shared group passes the readiness gate', () => {
  const window = windowFor({ toDate: '2026-10-27' })
  const readiness = gm.evaluateReadiness({
    group: DEMO_GROUP,
    members: seed.members,
    shares: seed.availabilityShares,
    windowStart: window.start,
    windowEnd: window.end,
  })

  assert.equal(readiness.ready, true)
  assert.deepEqual(readiness.blockers, [])
})

test('invitation guards reject self invites, existing members and duplicates', () => {
  const group = { id: 'g1', memberIds: ['a', 'b'] }
  const invitations = [{ id: 'i1', groupId: 'g1', toUserId: 'c', status: 'pending' }]

  assert.throws(
    () => gm.checkInvitationAllowed({ group, inviterId: 'a', targetUser: { id: 'a' }, invitations }),
    /invite yourself/i,
  )
  assert.throws(
    () => gm.checkInvitationAllowed({ group, inviterId: 'a', targetUser: { id: 'b' }, invitations }),
    /already a member/i,
  )
  assert.throws(
    () => gm.checkInvitationAllowed({ group, inviterId: 'a', targetUser: { id: 'c' }, invitations }),
    /already waiting/i,
  )
  assert.throws(
    () => gm.checkInvitationAllowed({ group, inviterId: 'z', targetUser: { id: 'c' }, invitations }),
    /current members/i,
  )
  assert.equal(
    gm.checkInvitationAllowed({ group, inviterId: 'a', targetUser: { id: 'd' }, invitations }),
    true,
  )
})

test('accepting an invitation adds membership, declining does not', () => {
  const group = { id: 'g1', memberIds: ['a'] }
  const accepted = { id: 'i1', groupId: 'g1', fromUserId: 'a', toUserId: 'c', status: 'pending' }

  gm.applyInvitationResponse({ invitation: accepted, group, actorId: 'c', action: 'accept' })
  assert.equal(accepted.status, 'accepted')
  assert.ok(accepted.respondedAt)
  assert.deepEqual(group.memberIds, ['a', 'c'])

  const declined = { id: 'i2', groupId: 'g1', fromUserId: 'a', toUserId: 'd', status: 'pending' }
  gm.applyInvitationResponse({ invitation: declined, group, actorId: 'd', action: 'decline' })
  assert.equal(declined.status, 'declined')
  assert.deepEqual(group.memberIds, ['a', 'c'])
})

test('only the invitee can answer and a terminal invitation cannot be re-answered', () => {
  const group = { id: 'g1', memberIds: ['a'] }
  const invitation = { id: 'i1', groupId: 'g1', fromUserId: 'a', toUserId: 'c', status: 'pending' }

  assert.throws(
    () => gm.applyInvitationResponse({ invitation, group, actorId: 'a', action: 'accept' }),
    /invited account/i,
  )

  gm.applyInvitationResponse({ invitation, group, actorId: 'c', action: 'accept' })
  assert.throws(
    () => gm.applyInvitationResponse({ invitation, group, actorId: 'c', action: 'accept' }),
    /already accepted/i,
  )
})

test('only the sender can cancel, and cancelling never adds a member', () => {
  const group = { id: 'g1', memberIds: ['a'] }
  const invitation = { id: 'i1', groupId: 'g1', fromUserId: 'a', toUserId: 'c', status: 'pending' }

  assert.throws(
    () => gm.applyInvitationResponse({ invitation, group, actorId: 'c', action: 'cancel' }),
    /Only the sender/i,
  )

  gm.applyInvitationResponse({ invitation, group, actorId: 'a', action: 'cancel' })
  assert.equal(invitation.status, 'cancelled')
  assert.deepEqual(group.memberIds, ['a'])
})

/* ------------------------------------------------------------------ *
 * Booking a meeting
 * ------------------------------------------------------------------ */

const BOOKING_NOW = Date.parse('2026-10-25T00:00:00+08:00')

function draftFor(overrides = {}) {
  return {
    title: 'IS216 project sync',
    startAt: '2026-10-26T15:00:00+08:00',
    endAt: '2026-10-26T16:00:00+08:00',
    ...overrides,
  }
}

test('a valid booking keeps the title, the window and every member as participant', () => {
  const draft = gm.validateBookingDraft({
    draft: draftFor(),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })

  assert.equal(draft.title, 'IS216 project sync')
  assert.equal(draft.durationMinutes, 60)
  assert.deepEqual(draft.participantIds, DEMO_GROUP.memberIds)
  assert.equal(new Date(draft.start).toISOString(), '2026-10-26T07:00:00.000Z')
})

test('a booking can name a subset of members but never an outsider', () => {
  const draft = gm.validateBookingDraft({
    draft: draftFor({ participantIds: ['mock-user-a', 'mock-user-a', 'mock-user-b'] }),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })
  assert.deepEqual(draft.participantIds, ['mock-user-a', 'mock-user-b'])

  assert.throws(
    () => gm.validateBookingDraft({
      draft: draftFor({ participantIds: ['mock-user-a', 'mock-user-d'] }),
      group: DEMO_GROUP,
      viewerId: 'mock-user-a',
      now: BOOKING_NOW,
    }),
    /member of this group/i,
  )
})

test('a booking rejects bad titles, backwards ranges, silly lengths and past times', () => {
  const base = { group: DEMO_GROUP, viewerId: 'mock-user-a', now: BOOKING_NOW }

  assert.throws(() => gm.validateBookingDraft({ ...base, draft: draftFor({ title: ' x ' }) }), /title/i)
  assert.throws(
    () => gm.validateBookingDraft({
      ...base,
      draft: draftFor({ endAt: '2026-10-26T14:00:00+08:00' }),
    }),
    /end after it starts/i,
  )
  assert.throws(
    () => gm.validateBookingDraft({
      ...base,
      draft: draftFor({ endAt: '2026-10-26T15:10:00+08:00' }),
    }),
    /at least 15 minutes/i,
  )
  assert.throws(
    () => gm.validateBookingDraft({
      ...base,
      draft: draftFor({ startAt: '2026-10-24T15:00:00+08:00', endAt: '2026-10-24T16:00:00+08:00' }),
    }),
    /already in the past/i,
  )
})

test('a booking is refused while a participant is busy, including by another meeting', () => {
  // 26 Oct 15:00-16:00 is free for everyone in the demo group.
  const free = gm.validateBookingDraft({
    draft: draftFor(),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })
  assert.deepEqual(
    gm.findBookingConflicts({
      participantIds: free.participantIds,
      start: free.start,
      end: free.end,
      busyIntervals: seed.busyIntervals,
      members: seed.members,
    }),
    [],
  )

  // 26 Oct 16:00-17:00 is the seeded study meeting for A and D.
  const clash = gm.validateBookingDraft({
    draft: draftFor({ startAt: '2026-10-26T16:00:00+08:00', endAt: '2026-10-26T17:00:00+08:00' }),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })
  const conflicts = gm.findBookingConflicts({
    participantIds: clash.participantIds,
    start: clash.start,
    end: clash.end,
    busyIntervals: seed.busyIntervals,
    members: seed.members,
  })

  // C is busy 16:30-18:00 and A's seeded study meeting runs 16:00-17:00.
  // D is not in the demo group, so their study meeting is not reported.
  assert.deepEqual(conflicts.map((item) => item.name).sort(), ['Demo Member A', 'Demo Member C'])
})

test('a booked meeting blocks the same slot on the next search', () => {
  const draft = gm.validateBookingDraft({
    draft: draftFor(),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })

  let counter = 0
  const { meeting, busyIntervals } = gm.buildMeetingRecords({
    draft,
    groupId: DEMO_GROUP.id,
    createdBy: 'mock-user-a',
    makeId: (prefix) => `${prefix}-${(counter += 1)}`,
  })

  assert.equal(meeting.status, 'booked')
  assert.equal(busyIntervals.length, DEMO_GROUP.memberIds.length)
  assert.ok(busyIntervals.every((item) => item.sourceMeetingId === meeting.id))

  const window = windowFor({ durationMinutes: 60 })
  const before = gm.findCommonTimes({
    memberIds: DEMO_GROUP.memberIds,
    busyIntervals: seed.busyIntervals,
    window,
  })
  const after = gm.findCommonTimes({
    memberIds: DEMO_GROUP.memberIds,
    busyIntervals: [...seed.busyIntervals, ...busyIntervals],
    window,
  })

  assert.ok(
    before.days[0].blocks.some((block) => block.slots.some((slot) => slot.startAt === meeting.startAt)),
  )
  assert.ok(
    after.days[0].blocks.every((block) => block.slots.every((slot) => slot.startAt !== meeting.startAt)),
  )
})

test('a booked meeting becomes a planner activity', () => {
  const draft = gm.validateBookingDraft({
    draft: draftFor(),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })
  const { meeting } = gm.buildMeetingRecords({
    draft,
    groupId: DEMO_GROUP.id,
    createdBy: 'mock-user-a',
    makeId: (prefix) => `${prefix}-x`,
  })
  const activity = gm.meetingToActivity(meeting, DEMO_GROUP.name)

  assert.equal(activity.title, 'IS216 project sync')
  assert.equal(activity.place, DEMO_GROUP.name)
  assert.equal(activity.source, 'group-meeting')
  assert.equal(activity.when, meeting.startAt)
  assert.equal(activity.end, meeting.endAt)
  assert.equal(activity.outdoor, false)
})

test('only the booker or the group owner can cancel a meeting', () => {
  const group = { id: 'g1', ownerId: 'owner', memberIds: ['owner', 'booker', 'other'] }
  const meeting = { id: 'm1', groupId: 'g1', createdBy: 'booker' }

  assert.equal(gm.checkMeetingCancellable({ meeting, group, actorId: 'booker' }), true)
  assert.equal(gm.checkMeetingCancellable({ meeting, group, actorId: 'owner' }), true)

  assert.throws(
    () => gm.checkMeetingCancellable({ meeting, group, actorId: 'other' }),
    /group owner can cancel/i,
  )
  assert.throws(
    () => gm.checkMeetingCancellable({ meeting, group, actorId: 'stranger' }),
    /not a member/i,
  )
  assert.throws(
    () => gm.checkMeetingCancellable({ meeting: null, group, actorId: 'owner' }),
    /does not exist/i,
  )
})

test('a forced booking is recorded as an overlap, a normal one is not', () => {
  const draft = gm.validateBookingDraft({
    draft: draftFor(),
    group: DEMO_GROUP,
    viewerId: 'mock-user-a',
    now: BOOKING_NOW,
  })
  const base = { draft, groupId: DEMO_GROUP.id, createdBy: 'mock-user-a', makeId: p => `${p}-1` }

  assert.equal(gm.buildMeetingRecords({ ...base }).meeting.forced, false)
  assert.equal(gm.buildMeetingRecords({ ...base, forced: true }).meeting.forced, true)
})
