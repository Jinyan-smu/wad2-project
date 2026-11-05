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
  'PocketSemester',
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

test('group codes are unique and upgrading existing groups preserves their codes', () => {
  const groups = [{ id: 'old', joinCode: 'ABCD2345' }, { id: 'new' }, { id: 'other' }]
  gm.ensureGroupCodes(groups)
  const codes = groups.map(group => group.joinCode)
  assert.equal(codes[0], 'ABCD2345')
  assert.equal(new Set(codes).size, groups.length)
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  gm.ensureGroupCodes(groups)
  assert.deepEqual(groups.map(group => group.joinCode), codes)
})

test('joining with a code accepts lowercase and surrounding spaces and resolves pending invitations', () => {
  const group = { id: 'g1', joinCode: 'ABCD2345', memberIds: ['owner'] }
  const invitations = [
    { id: 'pending', groupId: 'g1', toUserId: 'new', status: 'pending' },
    { id: 'other-group', groupId: 'g2', toUserId: 'new', status: 'pending' },
    { id: 'other-user', groupId: 'g1', toUserId: 'someone', status: 'pending' },
    { id: 'declined', groupId: 'g1', toUserId: 'new', status: 'declined' },
  ]
  const joined = gm.joinGroupByCode({ groups: [group], invitations, code: ' abcd2345 ', userId: 'new', now: 0 })
  assert.equal(joined, group)
  assert.deepEqual(group.memberIds, ['owner', 'new'])
  assert.equal(invitations[0].status, 'accepted')
  assert.equal(invitations[0].respondedAt, '1970-01-01T00:00:00.000Z')
  assert.equal(invitations[1].status, 'pending')
  assert.equal(invitations[2].status, 'pending')
  assert.equal(invitations[3].status, 'declined')
})

test('malformed and unknown codes do not add membership', () => {
  const group = { id: 'g1', joinCode: 'ABCD2345', memberIds: ['owner'] }
  for (const code of [null, {}, '', 'ABC', 'ABCD234!', 'ABCD2340', 'ABCDEFGHJ']) {
    assert.throws(() => gm.joinGroupByCode({ groups: [group], invitations: [], code, userId: 'new' }),
      error => error.statusCode === 400)
  }
  assert.throws(() => gm.joinGroupByCode({ groups: [group], invitations: [], code: 'ZZZZ9999', userId: 'new' }),
    error => error.statusCode === 404 && error.code === 'invalid_group_code')
  assert.deepEqual(group.memberIds, ['owner'])
})

test('joining rejects existing members and full groups without changing membership', () => {
  const group = { id: 'g1', joinCode: 'ABCD2345', memberIds: ['owner'] }
  assert.throws(() => gm.joinGroupByCode({ groups: [group], invitations: [], code: group.joinCode, userId: 'owner' }),
    error => error.code === 'already_member')
  group.memberIds = Array.from({ length: gm.MAX_GROUP_MEMBERS }, (_, i) => `user-${i}`)
  assert.throws(() => gm.joinGroupByCode({ groups: [group], invitations: [], code: group.joinCode, userId: 'new' }),
    error => error.code === 'group_full')
  assert.equal(group.memberIds.length, gm.MAX_GROUP_MEMBERS)
  assert.equal(group.memberIds.includes('new'), false)
})

function stateForLeaving() {
  return {
    defaultGroupId: 'g1',
    groups: [
      { id: 'g1', name: 'Project team', ownerId: 'owner', memberIds: ['owner', 'leaver', 'remaining'] },
      { id: 'g2', name: 'Other team', ownerId: 'leaver', memberIds: ['leaver'] },
    ],
    members: [{ id: 'leaver', name: 'Leaver' }],
    meetings: [
      { id: 'joint', groupId: 'g1', createdBy: 'owner', participantIds: ['owner', 'leaver'] },
      { id: 'solo', groupId: 'g1', participantIds: ['leaver'] },
      { id: 'others', groupId: 'g1', participantIds: ['remaining'] },
      { id: 'other-group', groupId: 'g2', participantIds: ['leaver'] },
    ],
    availabilityShares: [
      { groupId: 'g1', userId: 'leaver', enabled: true },
      { groupId: 'g1', userId: 'owner', enabled: true },
      { groupId: 'g2', userId: 'leaver', enabled: true },
    ],
    invitations: [
      { id: 'sent', groupId: 'g1', fromUserId: 'leaver', status: 'pending' },
      { id: 'accepted', groupId: 'g1', fromUserId: 'leaver', status: 'accepted' },
      { id: 'sent-by-owner', groupId: 'g1', fromUserId: 'owner', status: 'pending' },
      { id: 'other-group-invite', groupId: 'g2', fromUserId: 'leaver', status: 'pending' },
    ],
    busyIntervals: [
      { id: 'joint-leaver', sourceMeetingId: 'joint', userId: 'leaver' },
      { id: 'joint-owner', sourceMeetingId: 'joint', userId: 'owner' },
      { id: 'solo-leaver', sourceMeetingId: 'solo', userId: 'leaver' },
      { id: 'others-busy', sourceMeetingId: 'others', userId: 'remaining' },
      { id: 'other-group-busy', sourceMeetingId: 'other-group', userId: 'leaver' },
      { id: 'personal', sourceType: 'personal', userId: 'leaver' },
    ],
  }
}

test('leaving removes only that group membership and its meeting commitments', () => {
  const state = stateForLeaving()
  const result = gm.leaveGroup({ state, groupId: 'g1', userId: 'leaver', now: 0 })
  assert.deepEqual(result, { groupId: 'g1', groupName: 'Project team', deleted: false, newOwnerId: 'owner' })
  assert.deepEqual(state.groups[0].memberIds, ['owner', 'remaining'])
  assert.deepEqual(state.meetings.find(meeting => meeting.id === 'joint').participantIds, ['owner'])
  assert.deepEqual(state.meetings.map(meeting => meeting.id), ['joint', 'others', 'other-group'])
  assert.deepEqual(state.busyIntervals.map(interval => interval.id), ['joint-owner', 'others-busy', 'other-group-busy', 'personal'])
  assert.deepEqual(state.availabilityShares.map(share => [share.groupId, share.userId]), [['g1', 'owner'], ['g2', 'leaver']])
  assert.equal(state.invitations[0].status, 'cancelled')
  assert.equal(state.invitations[0].respondedAt, '1970-01-01T00:00:00.000Z')
  assert.equal(state.invitations[1].status, 'accepted')
  assert.equal(state.invitations[2].status, 'pending')
  assert.equal(state.invitations[3].status, 'pending')
  assert.deepEqual(state.groups[1].memberIds, ['leaver'])
})

test('an owner leaving transfers ownership to the first remaining member', () => {
  const state = stateForLeaving()
  const result = gm.leaveGroup({ state, groupId: 'g1', userId: 'owner' })
  assert.equal(result.newOwnerId, 'leaver')
  assert.equal(state.groups[0].ownerId, 'leaver')
  assert.deepEqual(state.groups[0].memberIds, ['leaver', 'remaining'])
  assert.equal(gm.checkMeetingCancellable({
    meeting: state.meetings.find(meeting => meeting.id === 'joint'), group: state.groups[0], actorId: 'leaver',
  }), true)
})

test('the last member leaving removes the group and all its related records', () => {
  const state = stateForLeaving()
  state.groups[0].memberIds = ['leaver']
  state.groups[0].ownerId = 'leaver'
  const result = gm.leaveGroup({ state, groupId: 'g1', userId: 'leaver' })
  assert.deepEqual(result, { groupId: 'g1', groupName: 'Project team', deleted: true, newOwnerId: null })
  assert.deepEqual(state.groups.map(group => group.id), ['g2'])
  assert.deepEqual(state.meetings.map(meeting => meeting.id), ['other-group'])
  assert.deepEqual(state.busyIntervals.map(interval => interval.id), ['other-group-busy', 'personal'])
  assert.deepEqual(state.availabilityShares.map(share => share.groupId), ['g2'])
  assert.deepEqual(state.invitations.map(invitation => invitation.id), ['other-group-invite'])
  assert.equal(state.defaultGroupId, null)
  assert.equal(state.members[0].id, 'leaver')
})

test('a missing group or non-member cannot change group state by leaving', () => {
  const state = stateForLeaving()
  const before = structuredClone(state)
  assert.throws(() => gm.leaveGroup({ state, groupId: 'missing', userId: 'leaver' }),
    error => error.statusCode === 404 && error.code === 'group_not_found')
  assert.throws(() => gm.leaveGroup({ state, groupId: 'g1', userId: 'outsider' }),
    error => error.statusCode === 403 && error.code === 'not_a_member')
  assert.deepEqual(state, before)
})

test('an owner removes a member and their group commitments without affecting other groups', () => {
  const state = stateForLeaving()
  state.invitations.push(
    { id: 'incoming', groupId: 'g1', fromUserId: 'owner', toUserId: 'leaver', status: 'pending' },
    { id: 'other-incoming', groupId: 'g2', fromUserId: 'owner', toUserId: 'leaver', status: 'pending' },
  )
  const result = gm.removeGroupMember({ state, groupId: 'g1', actorId: 'owner', memberId: 'leaver', now: 0 })
  assert.equal(result.removedMemberId, 'leaver')
  assert.equal(result.deleted, false)
  assert.equal(state.groups[0].ownerId, 'owner')
  assert.deepEqual(state.groups[0].memberIds, ['owner', 'remaining'])
  assert.deepEqual(state.groups[1].memberIds, ['leaver'])
  assert.deepEqual(state.meetings.find(meeting => meeting.id === 'joint').participantIds, ['owner'])
  assert.deepEqual(state.meetings.map(meeting => meeting.id), ['joint', 'others', 'other-group'])
  assert.deepEqual(state.busyIntervals.map(interval => interval.id), ['joint-owner', 'others-busy', 'other-group-busy', 'personal'])
  assert.deepEqual(state.availabilityShares.map(share => [share.groupId, share.userId]), [['g1', 'owner'], ['g2', 'leaver']])
  assert.equal(state.invitations.find(invite => invite.id === 'sent').status, 'cancelled')
  assert.equal(state.invitations.find(invite => invite.id === 'incoming').status, 'cancelled')
  assert.equal(state.invitations.find(invite => invite.id === 'incoming').respondedAt, '1970-01-01T00:00:00.000Z')
  assert.equal(state.invitations.find(invite => invite.id === 'other-incoming').status, 'pending')
  assert.equal(state.members[0].id, 'leaver')
})

test('removal rejects non-owners, the owner themselves, and missing groups or members without mutation', () => {
  const state = stateForLeaving()
  const before = structuredClone(state)
  for (const actorId of ['leaver', 'remaining', 'outsider']) {
    assert.throws(() => gm.removeGroupMember({ state, groupId: 'g1', actorId, memberId: 'leaver' }),
      error => error.statusCode === 403 && error.code === 'not_group_owner')
  }
  assert.throws(() => gm.removeGroupMember({ state, groupId: 'g1', actorId: 'owner', memberId: 'owner' }),
    error => error.statusCode === 409 && error.code === 'cannot_remove_owner')
  assert.throws(() => gm.removeGroupMember({ state, groupId: 'g1', actorId: 'owner', memberId: 'missing' }),
    error => error.statusCode === 404 && error.code === 'member_not_found')
  assert.throws(() => gm.removeGroupMember({ state, groupId: 'missing', actorId: 'owner', memberId: 'leaver' }),
    error => error.statusCode === 404 && error.code === 'group_not_found')
  assert.deepEqual(state, before)
})

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

test('deadline buffer defaults to an hour and only accepts the supported choices', () => {
  assert.equal(windowFor().assignmentBufferMinutes, 60)
  for (const value of [0, 30, 60, 90, 120, '30']) {
    assert.equal(gm.validateAssignmentBuffer(value), Number(value))
  }
  for (const value of [null, false, true, '', ' ', [], {}, 15, -30, 150]) {
    assert.throws(() => gm.validateAssignmentBuffer(value), /Assignment buffer/i)
  }
})

test('live planner intervals respect progress, finished activities and explicit scheduled coursework', () => {
  const result = gm.buildPlannerBusyIntervals({
    userId: 'member',
    activities: [
      { title: 'Private activity', when: '2026-10-26T09:00:00+08:00', end: '2026-10-26T10:00:00+08:00' },
      { done: true, when: '2026-10-26T10:00:00+08:00', end: '2026-10-26T11:00:00+08:00' },
      { status: 'cancelled', when: '2026-10-26T11:00:00+08:00', end: '2026-10-26T12:00:00+08:00' },
    ],
    assignments: [
      { Id: 'done', CourseId: 'course', DueDate: '2026-10-26T11:00:00+08:00' },
      { Id: 'reopened', CourseId: 'course', Done: true, DueDate: '2026-10-26T12:00:00+08:00' },
      { Id: 'custom', CourseId: 'course', IsCustom: true, DueDate: '2026-10-26T13:00:00+08:00' },
    ],
    quizzes: [
      { QuizId: 'quiz', CourseId: 'course', StartDate: '2026-10-01T09:00:00+08:00', DueDate: '2026-10-26T14:00:00+08:00' },
      { QuizId: 'scheduled', CourseId: 'course', StartDate: '2026-10-26T15:00:00+08:00', EndDate: '2026-10-26T16:00:00+08:00' },
      { QuizId: 'completed', CourseId: 'course', DueDate: '2026-10-26T17:00:00+08:00' },
    ],
    progress: { 'assignment:course:done': true, 'assignment:course:reopened': false, 'quiz:course:completed': true },
  })
  assert.deepEqual(result.sources, { activities: 1, assignments: 2, quizzes: 2 })
  assert.deepEqual(result.busyIntervals.map(item => [item.startAt, item.endAt]), [
    ['2026-10-26T01:00:00.000Z', '2026-10-26T02:00:00.000Z'],
    ['2026-10-26T03:00:00.000Z', '2026-10-26T04:00:00.000Z'],
    ['2026-10-26T04:00:00.000Z', '2026-10-26T05:00:00.000Z'],
    ['2026-10-26T05:00:00.000Z', '2026-10-26T06:00:00.000Z'],
    ['2026-10-26T07:00:00.000Z', '2026-10-26T08:00:00.000Z'],
  ])
  assert.equal(JSON.stringify(result).includes('Private activity'), false)
})

test('zero deadline buffer still includes an explicitly scheduled quiz interval', () => {
  const result = gm.buildPlannerBusyIntervals({
    userId: 'member', assignmentBufferMinutes: 0,
    assignments: [{ Id: 'deadline', CourseId: 'course', DueDate: '2026-10-26T12:00:00+08:00' }],
    quizzes: [{ QuizId: 'quiz', CourseId: 'course', StartAt: '2026-10-26T15:00:00+08:00', EndAt: '2026-10-26T16:00:00+08:00' }],
  })
  assert.deepEqual(result.sources, { activities: 0, assignments: 0, quizzes: 1 })
  assert.equal(result.busyIntervals.length, 1)
})

test('grid counts freedom per cell but only permits a fully free meeting duration', () => {
  const window = windowFor({ startTime: '09:00', endTime: '11:00' })
  const result = gm.findCommonTimes({
    memberIds: ['a', 'b'], window,
    busyIntervals: [{ userId: 'b', startAt: '2026-10-26T09:30:00+08:00', endAt: '2026-10-26T10:00:00+08:00' }],
  })
  const cells = result.availability.days[0].cells
  assert.equal(cells.length, 8)
  assert.equal(cells[0].freeCount, 2)
  assert.equal(cells[0].canBook, false)
  assert.equal(cells[2].freeCount, 1)
  assert.deepEqual(cells[2].busyMemberIds, ['b'])
  assert.equal(cells[4].canBook, true)
  assert.equal(cells[5].canBook, false)
})

test('a current-time cutoff excludes past suggestions without dropping past grid cells', () => {
  const window = windowFor({ startTime: '09:00', endTime: '11:00', durationMinutes: 30 })
  const result = gm.findCommonTimes({
    memberIds: ['a'], busyIntervals: [], window, now: Date.parse('2026-10-26T09:05:00+08:00'),
  })
  assert.equal(result.best.startAt, '2026-10-26T01:15:00.000Z')
  assert.equal(result.availability.days[0].cells.length, 8)
  assert.equal(result.availability.days[0].cells[0].canBook, false)
  assert.equal(result.availability.days[0].cells[1].canBook, true)
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

test('an incomplete calendar blocks the calculation, but sharing is no longer required', () => {
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

  // Sharing is no longer part of the gate: a disabled share does not block.
  assert.equal(unshared.ready, true)
  assert.deepEqual(unshared.blockers, [])

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

test('a group with complete calendars passes the readiness gate', () => {
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

  assert.throws(() => gm.validateBookingDraft({
    ...base, draft: draftFor(), now: Date.parse(draftFor().startAt) + 30 * 1000,
  }), /already in the past/i)

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
