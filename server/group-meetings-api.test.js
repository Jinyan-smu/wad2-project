'use strict'

const { test, before, beforeEach, after, mock } = require('node:test')
const assert = require('node:assert/strict')
const bcrypt = require('bcrypt')
const gm = require('./group-meetings')

// Replace the persistence boundary before loading the app, so these tests also
// run without a DATABASE_URL, local .env file, or database connection.
const databasePath = require.resolve('./database')
const originalDatabaseModule = require.cache[databasePath]
const database = { query() {}, withTransaction() {} }
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database }

process.env.SESSION_SECRET ||= 'group-code-test-session-secret'

// Exercise the real HTTP routes and login sessions against an isolated store.
// No test accounts or groups are written to the connected database.
const password = 'test-password'
const passwordHash = bcrypt.hashSync(password, 4)
const users = ['owner', 'teammate', 'third'].map(id => ({
  id, username: id, email: `${id}@example.test`, passwordHash,
}))
let storedState
let scheduleData
let failingScheduleUser
let server
let baseUrl

mock.method(database, 'query', async (sql, values) => {
  if (sql.includes('from planner_private.app_users')) {
    return { rows: values ? users.filter(user => user.email === values[0]) : users }
  }
  if (sql.includes('insert into planner_private.activities')) {
    const [id, owner_id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude] = values
    const row = { id, owner_id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude }
    scheduleData.activities.push(row)
    return { rows: [row] }
  }
  if (sql.includes('from planner_private.activities')) {
    if (values[0] === failingScheduleUser) throw new Error('Schedule read failed')
    const userId = sql.includes('where id = $1') ? values[1] : values[0]
    return { rows: scheduleData.activities.filter(row =>
      (row.owner_id == null || row.owner_id === userId) && (!sql.includes('where id = $1') || row.id === values[0]),
    ) }
  }
  if (sql.includes('insert into planner_private.custom_assignments')) {
    const [id, OwnerId, CourseId, Name, DueDate, CreatedAt] = values
    scheduleData.customAssignments.push({ id, OwnerId, CourseId, Name, DueDate, CreatedAt })
    return { rows: [] }
  }
  if (sql.includes('from planner_private.custom_assignments')) {
    if (sql.includes('select 1')) {
      return { rows: scheduleData.customAssignments.filter(row => row.CourseId === values[0] && row.id === values[1] && row.OwnerId === values[2]) }
    }
    return { rows: scheduleData.customAssignments.filter(row => row.OwnerId === values[0]) }
  }
  if (sql.includes('from planner_private.reference_assignments') || sql.includes('from planner_private.reference_quizzes')) {
    const kind = sql.includes('reference_assignments') ? 'assignments' : 'quizzes'
    const userId = sql.includes('select 1') ? values[2] : values[0]
    const rows = scheduleData[kind].filter(row => row.userId === userId)
    if (sql.includes('select 1')) {
      return { rows: rows.filter(row => row.course_id === values[0] && String(row.source.QuizId ?? row.source.Id) === values[1]) }
    }
    return { rows: rows.map(({ course_id, source }) => ({ course_id, source })) }
  }
  if (sql.includes('insert into planner_private.coursework_progress')) {
    const [user_id, kind, course_id, item_id, done] = values
    scheduleData.progress = scheduleData.progress.filter(row => !(row.user_id === user_id && row.kind === kind && row.course_id === course_id && row.item_id === item_id))
    scheduleData.progress.push({ user_id, kind, course_id, item_id, done })
    return { rows: [] }
  }
  if (sql.includes('from planner_private.coursework_progress')) {
    return { rows: scheduleData.progress.filter(row => row.user_id === values[0]) }
  }
  if (sql.includes('from planner_private.reference_courses')) {
    const userId = sql.includes('where c.course_id = $1') ? values[1] : values[0]
    return { rows: scheduleData.courses.filter(row => row.userId === userId && (!sql.includes('where c.course_id = $1') || row.course_id === values[0])) }
  }
  if (sql.includes('from planner_private.reference_announcements')) return { rows: [] }
  assert.fail(`Unexpected database query in API test: ${sql}`)
})
mock.method(database, 'withTransaction', async task => {
  let state = structuredClone(storedState)
  const result = await task({
    query: async (sql, values) => {
      if (sql.includes('select state from planner_private.group_meeting_state')) {
        return { rows: state ? [{ state }] : [] }
      }
      if (sql.includes('insert into planner_private.group_meeting_state')) {
        state ||= JSON.parse(values[0])
        return { rows: [] }
      }
      assert.match(sql, /update planner_private\.group_meeting_state/)
      state = JSON.parse(values[0])
      return { rows: [] }
    },
  })
  storedState = state
  return result
})

before(async () => {
  const app = require('./server')
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})
beforeEach(() => {
  failingScheduleUser = null
  scheduleData = {
    activities: [], assignments: [], quizzes: [], customAssignments: [], progress: [],
    courses: users.map(user => ({ userId: user.id, course_id: 'course-1', source: { Id: 'course-1', Name: 'Project module', Code: 'IS216' } })),
  }
  storedState = {
    groups: [], members: [], meetings: [], invitations: [], availabilityShares: [], busyIntervals: [],
    meetingPreferences: {
      fromDate: '2026-11-04', toDate: '2026-11-05', startTime: '09:00', endTime: '18:00', durationMinutes: 60,
    },
  }
})
after(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  mock.restoreAll()
  if (originalDatabaseModule) require.cache[databasePath] = originalDatabaseModule
  else delete require.cache[databasePath]
})

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  }
}
async function login(id) {
  const response = await request('/login', { method: 'POST', body: { email: `${id}@example.test`, password } })
  assert.equal(response.status, 200)
  assert.ok(response.cookie)
  return response.cookie
}
async function createGroup(cookie) {
  const response = await request('/group-meetings/groups', { method: 'POST', cookie, body: { name: 'Project team' } })
  assert.equal(response.status, 201)
  return response.data.group
}

test('a second logged-in account joins a created group and both accounts see persisted membership', async () => {
  const owner = await login('owner')
  const teammate = await login('teammate')
  const group = await createGroup(owner)
  assert.match(group.joinCode, /^[A-HJ-NP-Z2-9]{8}$/)
  const beforeJoin = await request('/group-meetings', { cookie: teammate })
  assert.deepEqual(beforeJoin.data.groups, [])

  storedState.meetings.push({ id: 'meeting-1', groupId: group.id, title: 'Project sync', participantIds: ['owner'] })
  const joined = await request('/group-meetings/groups/join', {
    method: 'POST', cookie: teammate, body: { code: ` ${group.joinCode.toLowerCase()} `, userId: 'third' },
  })
  assert.equal(joined.status, 201)
  assert.deepEqual(joined.data.group.memberIds, ['owner', 'teammate'])
  assert.ok(storedState.members.some(member => member.id === 'teammate' && member.isRegistered))
  assert.ok(storedState.availabilityShares.some(share => share.groupId === group.id && share.userId === 'teammate'))

  for (const cookie of [owner, teammate]) {
    const view = await request('/group-meetings', { cookie })
    assert.equal(view.status, 200)
    assert.equal(view.data.groups[0].joinCode, group.joinCode)
    assert.equal(view.data.groups[0].memberCount, 2)
    assert.deepEqual(view.data.groups[0].members.map(member => member.id), ['owner', 'teammate'])
    assert.equal(view.data.meetings[0].id, 'meeting-1')
  }
})

test('codes are assigned to legacy groups once and are hidden from non-members', async () => {
  storedState.groups.push({ id: 'legacy', name: 'Old group', ownerId: 'owner', memberIds: ['owner'] })
  const owner = await login('owner')
  const firstView = await request('/group-meetings', { cookie: owner })
  const code = firstView.data.groups[0].joinCode
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.equal(storedState.groups[0].joinCode, code)
  const nextView = await request('/group-meetings', { cookie: owner })
  assert.equal(nextView.data.groups[0].joinCode, code)
  const outsiderView = await request('/group-meetings', { cookie: await login('teammate') })
  assert.deepEqual(outsiderView.data.groups, [])
  assert.equal(JSON.stringify(outsiderView.data).includes(code), false)
})

test('a fresh group store seeds codes once before creating the first real group', async () => {
  storedState = null
  const cookie = await login('owner')
  const group = await createGroup(cookie)
  const codes = storedState.groups.map(item => item.joinCode)
  assert.equal(new Set(codes).size, storedState.groups.length)
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  const view = await request('/group-meetings', { cookie })
  assert.equal(view.data.groups.length, 1)
  assert.equal(view.data.groups[0].joinCode, group.joinCode)
  assert.deepEqual(storedState.groups.map(item => item.joinCode), codes)
})

test('joining requires login and rejects malformed or unknown codes', async () => {
  const anonymous = await request('/group-meetings/groups/join', { method: 'POST', body: { code: 'ABCD2345' } })
  assert.equal(anonymous.status, 401)
  const cookie = await login('teammate')
  const malformed = await request('/group-meetings/groups/join', { method: 'POST', cookie, body: { code: 'bad' } })
  assert.equal(malformed.status, 400)
  const unknown = await request('/group-meetings/groups/join', { method: 'POST', cookie, body: { code: 'ZZZZ9999' } })
  assert.equal(unknown.status, 404)
  assert.equal(storedState.groups.length, 0)
})

test('repeating a join does not duplicate membership', async () => {
  const owner = await login('owner')
  const group = await createGroup(owner)
  const response = await request('/group-meetings/groups/join', { method: 'POST', cookie: owner, body: { code: group.joinCode } })
  assert.equal(response.status, 409)
  assert.equal(response.data.code, 'already_member')
  assert.deepEqual(storedState.groups[0].memberIds, ['owner'])
})

test('two accounts racing for the last group place cannot exceed the member limit', async () => {
  const owner = await login('owner')
  const group = await createGroup(owner)
  storedState.groups[0].memberIds.push(...Array.from({ length: gm.MAX_GROUP_MEMBERS - 2 }, (_, i) => `member-${i}`))
  const teammate = await login('teammate')
  const third = await login('third')
  const responses = await Promise.all([teammate, third].map(cookie =>
    request('/group-meetings/groups/join', { method: 'POST', cookie, body: { code: group.joinCode } }),
  ))
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409])
  assert.equal(storedState.groups[0].memberIds.length, gm.MAX_GROUP_MEMBERS)
  assert.equal(responses.find(response => response.status === 409).data.code, 'group_full')
})

test('leaving removes only the signed-in member and their commitments in that group', async () => {
  const owner = await login('owner')
  const teammate = await login('teammate')
  const group = await createGroup(owner)
  const joined = await request('/group-meetings/groups/join', {
    method: 'POST', cookie: teammate, body: { code: group.joinCode },
  })
  assert.equal(joined.status, 201)
  storedState.groups.push({ id: 'other-group', name: 'Other group', ownerId: 'teammate', joinCode: 'ABCD2345', memberIds: ['teammate'] })
  storedState.meetings.push(
    { id: 'shared-meeting', groupId: group.id, title: 'Shared meeting', participantIds: ['owner', 'teammate'] },
    { id: 'other-meeting', groupId: 'other-group', title: 'Other meeting', participantIds: ['teammate'] },
  )
  storedState.busyIntervals.push(
    { id: 'departing-busy', userId: 'teammate', sourceMeetingId: 'shared-meeting' },
    { id: 'owner-busy', userId: 'owner', sourceMeetingId: 'shared-meeting' },
    { id: 'other-busy', userId: 'teammate', sourceMeetingId: 'other-meeting' },
    { id: 'personal-busy', userId: 'teammate', sourceType: 'class' },
  )
  storedState.availabilityShares.push({ groupId: 'other-group', userId: 'teammate', enabled: true })
  storedState.invitations.push(
    { id: 'departing-invite', groupId: group.id, fromUserId: 'teammate', toUserId: 'third', status: 'pending' },
    { id: 'owner-invite', groupId: group.id, fromUserId: 'owner', toUserId: 'third', status: 'pending' },
    { id: 'other-invite', groupId: 'other-group', fromUserId: 'teammate', toUserId: 'third', status: 'pending' },
  )

  const left = await request(`/group-meetings/groups/${group.id}/leave`, {
    method: 'POST', cookie: teammate, body: { userId: 'owner' },
  })
  assert.equal(left.status, 200)
  assert.equal(left.data.groupId, group.id)
  assert.equal(left.data.groupName, group.name)
  assert.equal(left.data.deleted, false)
  assert.deepEqual(storedState.groups.find(item => item.id === group.id).memberIds, ['owner'])
  assert.deepEqual(storedState.meetings.find(item => item.id === 'shared-meeting').participantIds, ['owner'])
  assert.deepEqual(storedState.busyIntervals.map(item => item.id), ['owner-busy', 'other-busy', 'personal-busy'])
  assert.ok(!storedState.availabilityShares.some(share => share.groupId === group.id && share.userId === 'teammate'))
  assert.ok(storedState.availabilityShares.some(share => share.groupId === 'other-group' && share.userId === 'teammate'))
  assert.equal(storedState.invitations.find(item => item.id === 'departing-invite').status, 'cancelled')
  assert.equal(storedState.invitations.find(item => item.id === 'owner-invite').status, 'pending')
  assert.equal(storedState.invitations.find(item => item.id === 'other-invite').status, 'pending')

  const departingView = await request('/group-meetings', { cookie: teammate })
  assert.deepEqual(departingView.data.groups.map(item => item.id), ['other-group'])
  assert.deepEqual(departingView.data.meetings.map(item => item.id), ['other-meeting'])
  const remainingView = await request('/group-meetings', { cookie: owner })
  assert.equal(remainingView.data.groups[0].memberCount, 1)
  assert.equal(remainingView.data.meetings[0].id, 'shared-meeting')
})

test('an owner can leave and ownership passes to a remaining member', async () => {
  const owner = await login('owner')
  const teammate = await login('teammate')
  const group = await createGroup(owner)
  await request('/group-meetings/groups/join', { method: 'POST', cookie: teammate, body: { code: group.joinCode } })
  const left = await request(`/group-meetings/groups/${group.id}/leave`, { method: 'POST', cookie: owner })
  assert.equal(left.status, 200)
  assert.equal(left.data.deleted, false)
  assert.equal(left.data.newOwnerId, 'teammate')
  assert.equal(storedState.groups[0].ownerId, 'teammate')
  assert.deepEqual(storedState.groups[0].memberIds, ['teammate'])
  const ownerView = await request('/group-meetings', { cookie: owner })
  assert.deepEqual(ownerView.data.groups, [])
  const teammateView = await request('/group-meetings', { cookie: teammate })
  assert.equal(teammateView.data.groups[0].isOwner, true)
  assert.equal(teammateView.data.groups[0].joinCode, group.joinCode)
})

test('the last member leaving removes the group and its related records, preserving other data', async () => {
  const owner = await login('owner')
  const group = await createGroup(owner)
  storedState.groups.push({ id: 'other-group', name: 'Other group', ownerId: 'third', joinCode: 'ABCD2345', memberIds: ['third'] })
  storedState.meetings.push(
    { id: 'removed-meeting', groupId: group.id, participantIds: ['owner'] },
    { id: 'other-meeting', groupId: 'other-group', participantIds: ['third'] },
  )
  storedState.busyIntervals.push(
    { id: 'removed-busy', userId: 'owner', sourceMeetingId: 'removed-meeting' },
    { id: 'other-busy', userId: 'third', sourceMeetingId: 'other-meeting' },
    { id: 'personal-busy', userId: 'owner', sourceType: 'class' },
  )
  storedState.availabilityShares.push({ groupId: 'other-group', userId: 'third', enabled: true })
  storedState.invitations.push(
    { id: 'removed-invite', groupId: group.id, fromUserId: 'owner', toUserId: 'teammate', status: 'pending' },
    { id: 'other-invite', groupId: 'other-group', fromUserId: 'third', toUserId: 'teammate', status: 'pending' },
  )
  const left = await request(`/group-meetings/groups/${group.id}/leave`, { method: 'POST', cookie: owner })
  assert.equal(left.status, 200)
  assert.equal(left.data.deleted, true)
  assert.equal(left.data.newOwnerId, null)
  assert.deepEqual(storedState.groups.map(item => item.id), ['other-group'])
  assert.deepEqual(storedState.meetings.map(item => item.id), ['other-meeting'])
  assert.deepEqual(storedState.busyIntervals.map(item => item.id), ['other-busy', 'personal-busy'])
  assert.deepEqual(storedState.availabilityShares.map(item => item.groupId), ['other-group'])
  assert.deepEqual(storedState.invitations.map(item => item.id), ['other-invite'])
  const oldCode = await request('/group-meetings/groups/join', { method: 'POST', cookie: owner, body: { code: group.joinCode } })
  assert.equal(oldCode.status, 404)
})

test('leaving rejects anonymous requests, non-members and missing groups without changing membership', async () => {
  const owner = await login('owner')
  const group = await createGroup(owner)
  const before = structuredClone(storedState)
  const anonymous = await request(`/group-meetings/groups/${group.id}/leave`, { method: 'POST' })
  assert.equal(anonymous.status, 401)
  const outsider = await request(`/group-meetings/groups/${group.id}/leave`, {
    method: 'POST', cookie: await login('teammate'), body: { userId: 'owner' },
  })
  assert.equal(outsider.status, 403)
  assert.equal(outsider.data.code, 'not_a_member')
  const missing = await request('/group-meetings/groups/missing/leave', { method: 'POST', cookie: owner })
  assert.equal(missing.status, 404)
  assert.equal(missing.data.code, 'group_not_found')
  assert.deepEqual(storedState, before)
})

const scheduleDate = '2099-01-05'
const at = time => new Date(`${scheduleDate}T${time}:00+08:00`).toISOString()
const searchFor = (groupId, extra = {}) => ({
  groupId, fromDate: scheduleDate, toDate: scheduleDate, startTime: '09:00', endTime: '18:00', durationMinutes: 60, ...extra,
})
const meetingFor = (groupId, start = '12:00', end = '13:00', extra = {}) => ({
  groupId, title: 'Project meeting', startAt: at(start), endAt: at(end), ...extra,
})
async function twoMemberGroup() {
  const owner = await login('owner')
  const teammate = await login('teammate')
  const group = await createGroup(owner)
  const joined = await request('/group-meetings/groups/join', { method: 'POST', cookie: teammate, body: { code: group.joinCode } })
  assert.equal(joined.status, 201)
  return { owner, teammate, group }
}

test('an owner can remove a member, persisting cleanup in group views and both planners', async () => {
  const { owner, teammate, group } = await twoMemberGroup()
  const otherGroup = await createGroup(teammate)
  const booking = await request('/group-meetings/meetings', { method: 'POST', cookie: teammate, body: meetingFor(group.id) })
  assert.equal(booking.status, 201)
  const otherBooking = await request('/group-meetings/meetings', {
    method: 'POST', cookie: teammate, body: meetingFor(otherGroup.id, '14:00', '15:00'),
  })
  assert.equal(otherBooking.status, 201)

  const removed = await request(`/group-meetings/groups/${group.id}/members/teammate`, {
    method: 'DELETE', cookie: owner,
  })
  assert.equal(removed.status, 200)
  assert.equal(removed.data.removedMemberId, 'teammate')
  assert.equal(removed.data.newOwnerId, 'owner')
  assert.deepEqual(storedState.groups.find(item => item.id === group.id).memberIds, ['owner'])
  assert.deepEqual(storedState.meetings.find(item => item.id === booking.data.meeting.id).participantIds, ['owner'])
  assert.ok(!storedState.busyIntervals.some(item => item.userId === 'teammate' && item.sourceMeetingId === booking.data.meeting.id))
  assert.ok(!storedState.availabilityShares.some(item => item.userId === 'teammate' && item.groupId === group.id))

  const ownerView = await request('/group-meetings', { cookie: owner })
  assert.equal(ownerView.data.groups[0].memberCount, 1)
  const teammateView = await request('/group-meetings', { cookie: teammate })
  assert.deepEqual(teammateView.data.groups.map(item => item.id), [otherGroup.id])
  const ownerPlanner = await request('/planner-data', { cookie: owner })
  assert.ok(ownerPlanner.data.activities.some(item => item.meetingId === booking.data.meeting.id))
  const teammatePlanner = await request('/planner-data', { cookie: teammate })
  assert.ok(!teammatePlanner.data.activities.some(item => item.meetingId === booking.data.meeting.id))
  assert.ok(teammatePlanner.data.activities.some(item => item.meetingId === otherBooking.data.meeting.id))
  const forbiddenSearch = await request('/group-meetings/common-time', {
    method: 'POST', cookie: teammate, body: searchFor(group.id),
  })
  assert.equal(forbiddenSearch.status, 403)
})

test('member removal requires the signed-in group owner and rejects invalid targets without saving changes', async () => {
  const { owner, teammate, group } = await twoMemberGroup()
  const outsider = await login('third')
  await createGroup(outsider)
  const before = structuredClone(storedState)
  const path = `/group-meetings/groups/${group.id}/members/teammate`
  assert.equal((await request(path, { method: 'DELETE' })).status, 401)
  for (const cookie of [teammate, outsider]) {
    const denied = await request(path, { method: 'DELETE', cookie, body: { actorId: 'owner', ownerId: 'owner' } })
    assert.equal(denied.status, 403)
    assert.equal(denied.data.code, 'not_group_owner')
  }
  const self = await request(`/group-meetings/groups/${group.id}/members/owner`, { method: 'DELETE', cookie: owner })
  assert.equal(self.status, 409)
  assert.equal(self.data.code, 'cannot_remove_owner')
  const missingMember = await request(`/group-meetings/groups/${group.id}/members/third`, { method: 'DELETE', cookie: owner })
  assert.equal(missingMember.status, 404)
  assert.equal(missingMember.data.code, 'member_not_found')
  const missingGroup = await request('/group-meetings/groups/missing/members/teammate', { method: 'DELETE', cookie: owner })
  assert.equal(missingGroup.status, 404)
  assert.deepEqual(storedState, before)
})

test('live member activities and unfinished coursework block matching and booking, and booked meetings reach both planners', async () => {
  const { owner, teammate, group } = await twoMemberGroup()
  const activity = await request('/activities', { method: 'POST', cookie: teammate, body: {
    title: 'Private teammate activity', when: at('09:00'), end: at('10:00'), outdoor: false,
  } })
  assert.equal(activity.status, 201)
  const assignment = await request('/assignments', { method: 'POST', cookie: owner, body: {
    name: 'Private owner custom deadline', courseId: 'course-1', dueDate: at('11:00'),
  } })
  assert.equal(assignment.status, 201)
  scheduleData.quizzes.push({ userId: 'teammate', course_id: 'course-1', source: {
    QuizId: 'quiz-1', Name: 'Private teammate quiz', DueDate: at('12:00'),
  } })
  scheduleData.assignments.push({ userId: 'owner', course_id: 'course-1', source: {
    Id: 'completed-assignment', Name: 'Private completed assignment', DueDate: at('13:00'), Done: false,
  } })
  const completed = await request('/coursework/assignment/course-1/completed-assignment', {
    method: 'PATCH', cookie: owner, body: { done: true },
  })
  assert.equal(completed.status, 200)
  // Another account's private calendar and a completed activity must not block this group.
  scheduleData.activities.push(
    { id: 'outside-group', owner_id: 'third', title: 'Outside group activity', starts_at: at('09:00'), ends_at: at('18:00'), done: false },
    { id: 'completed-activity', owner_id: 'teammate', title: 'Completed activity', starts_at: at('12:00'), ends_at: at('13:00'), done: true },
  )

  const matched = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id) })
  assert.equal(matched.status, 200)
  assert.equal(matched.data.status, 'ok')
  assert.equal(matched.data.sources.assignmentBufferMinutes, 60)
  assert.equal(matched.data.sources.activities, 1)
  assert.equal(matched.data.sources.assignments, 1)
  assert.equal(matched.data.sources.quizzes, 1)
  assert.equal(matched.data.sources.meetings, 0)
  const cells = matched.data.availability.days[0].cells
  const cellAt = time => cells.find(cell => cell.startAt === at(time))
  assert.deepEqual(cellAt('09:00').busyMemberIds, ['teammate'])
  assert.deepEqual(cellAt('10:00').busyMemberIds, ['owner'])
  assert.deepEqual(cellAt('11:00').busyMemberIds, ['teammate'])
  assert.equal(cellAt('12:00').freeCount, 2)
  assert.equal(cellAt('12:00').totalCount, 2)
  assert.equal(cellAt('12:00').canBook, true)
  assert.equal(matched.data.best.startAt, at('12:00'))
  for (const privateTitle of ['Private teammate activity', 'Private owner custom deadline', 'Private teammate quiz', 'Private completed assignment']) {
    assert.equal(JSON.stringify(matched.data).includes(privateTitle), false)
  }

  for (const [start, end, userId] of [['09:00', '10:00', 'teammate'], ['10:00', '11:00', 'owner'], ['11:00', '12:00', 'teammate']]) {
    const body = meetingFor(group.id, start, end)
    const preview = await request('/group-meetings/meetings/preview', { method: 'POST', cookie: owner, body })
    assert.equal(preview.status, 200)
    assert.deepEqual(preview.data.conflicts.map(conflict => conflict.userId), [userId])
    const blocked = await request('/group-meetings/meetings', { method: 'POST', cookie: owner, body })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.data.code, 'slot_conflict')
  }

  const booking = await request('/group-meetings/meetings', { method: 'POST', cookie: owner, body: meetingFor(group.id) })
  assert.equal(booking.status, 201)
  assert.deepEqual(booking.data.meeting.participantIds, ['owner', 'teammate'])
  const meetingId = booking.data.meeting.id
  for (const cookie of [owner, teammate]) {
    const planner = await request('/planner-data', { cookie })
    assert.equal(planner.status, 200)
    const event = planner.data.activities.find(item => item.meetingId === meetingId)
    assert.ok(event)
    assert.equal(event.title, 'Project meeting')
    assert.equal(event.when, at('12:00'))
    assert.equal(event.end, at('13:00'))
  }
  const afterBooking = await request('/group-meetings/common-time', { method: 'POST', cookie: teammate, body: searchFor(group.id) })
  assert.equal(afterBooking.data.sources.meetings, 1)
  assert.equal(afterBooking.data.availability.days[0].cells.find(cell => cell.startAt === at('12:00')).canBook, false)

  const cancelled = await request(`/group-meetings/meetings/${meetingId}`, { method: 'DELETE', cookie: owner })
  assert.equal(cancelled.status, 200)
  for (const cookie of [owner, teammate]) {
    const planner = await request('/planner-data', { cookie })
    assert.equal(planner.status, 200)
    assert.equal(planner.data.activities.some(item => item.meetingId === meetingId), false)
  }
})

test('the deadline buffer is adjustable and completed custom assignments no longer block', async () => {
  const { owner, group } = await twoMemberGroup()
  const assignment = await request('/assignments', { method: 'POST', cookie: owner, body: {
    name: 'Deadline', courseId: 'course-1', dueDate: at('11:00'),
  } })
  const assignmentId = assignment.data.assignment.Id
  for (const minutes of [0, 30, 60, 90, 120]) {
    const response = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id, {
      startTime: '10:00', endTime: '11:00', durationMinutes: 30, assignmentBufferMinutes: minutes,
    }) })
    assert.equal(response.status, 200)
    assert.equal(response.data.sources.assignmentBufferMinutes, minutes)
    assert.equal(response.data.availability.days[0].cells[0].canBook, minutes <= 30)
  }
  const withBuffer = await request('/group-meetings/meetings/preview', {
    method: 'POST', cookie: owner, body: meetingFor(group.id, '10:00', '11:00', { assignmentBufferMinutes: 60 }),
  })
  assert.equal(withBuffer.data.conflicts.length, 1)
  const noBuffer = await request('/group-meetings/meetings/preview', {
    method: 'POST', cookie: owner, body: meetingFor(group.id, '10:00', '11:00', { assignmentBufferMinutes: 0 }),
  })
  assert.deepEqual(noBuffer.data.conflicts, [])
  const done = await request(`/coursework/assignment/course-1/${assignmentId}`, { method: 'PATCH', cookie: owner, body: { done: true } })
  assert.equal(done.status, 200)
  const afterCompletion = await request('/group-meetings/meetings/preview', {
    method: 'POST', cookie: owner, body: meetingFor(group.id, '10:00', '11:00'),
  })
  assert.deepEqual(afterCompletion.data.conflicts, [])
  const invalid = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id, { assignmentBufferMinutes: 15 }) })
  assert.equal(invalid.status, 400)
})

test('shared sources are counted once while all affected members remain busy', async () => {
  const { owner, group } = await twoMemberGroup()
  // Registration is determined from accounts, not an optional legacy profile flag.
  for (const member of storedState.members) member.isRegistered = false
  scheduleData.activities.push({
    id: 'private-shared-activity', owner_id: null, title: 'Private shared event',
    starts_at: at('09:00'), ends_at: at('10:00'), done: false,
  })
  for (const userId of ['owner', 'teammate']) {
    scheduleData.assignments.push({ userId, course_id: 'course-1', source: {
      Id: 'private-assignment', Name: 'Private coursework', DueDate: at('11:00'),
    } })
    scheduleData.quizzes.push({ userId, course_id: 'course-1', source: {
      QuizId: 'private-quiz', Name: 'Private quiz', DueDate: at('12:00'),
    } })
  }
  const result = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id) })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.sources, { activities: 1, assignments: 1, quizzes: 1, meetings: 0, assignmentBufferMinutes: 60 })
  for (const time of ['09:00', '10:00', '11:00']) {
    const cell = result.data.availability.days[0].cells.find(item => item.startAt === at(time))
    assert.equal(cell.freeCount, 0)
    assert.deepEqual(cell.busyMemberIds, ['owner', 'teammate'])
    assert.equal(cell.canBook, false)
  }
  const body = JSON.stringify(result.data)
  for (const privateValue of ['private-shared-activity', 'Private shared event', 'private-assignment', 'Private coursework', 'private-quiz', 'Private quiz']) {
    assert.equal(body.includes(privateValue), false)
  }
})

test('fixture member calendars remain busy without being queried as registered accounts', async () => {
  const { owner, group } = await twoMemberGroup()
  storedState.groups[0].memberIds.push('fixture-user')
  storedState.members.push({ id: 'fixture-user', name: 'Sample member', scheduleStatus: 'complete', isRegistered: false })
  storedState.busyIntervals.push({ id: 'fixture-interval', userId: 'fixture-user', startAt: at('09:00'), endAt: at('10:00') })
  const result = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id) })
  assert.equal(result.status, 200)
  const cell = result.data.availability.days[0].cells[0]
  assert.equal(cell.totalCount, 3)
  assert.equal(cell.freeCount, 2)
  assert.deepEqual(cell.busyMemberIds, ['fixture-user'])
  assert.equal(cell.canBook, false)
  assert.equal(result.data.sources.activities, 1)
})

test('the availability grid covers the entire range even when suggestions are truncated', async () => {
  const { owner, group } = await twoMemberGroup()
  const result = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id, {
    fromDate: '2099-01-01', toDate: '2099-01-31', durationMinutes: 30,
  }) })
  assert.equal(result.status, 200)
  assert.equal(result.data.truncated, true)
  assert.equal(result.data.availability.stepMinutes, 15)
  assert.equal(result.data.availability.days.length, 31)
  assert.equal(result.data.availability.days[30].date, '2099-01-31')
  assert.equal(result.data.availability.days[30].cells.length, 36)
})

test('past search windows contain no bookable suggestions or grid cells', async () => {
  const { owner, group } = await twoMemberGroup()
  const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const result = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id, { fromDate: pastDate, toDate: pastDate }) })
  assert.equal(result.status, 200)
  assert.equal(result.data.totalSlots, 0)
  assert.equal(result.data.best, null)
  assert.ok(result.data.availability.days[0].cells.every(cell => cell.canBook === false))
})

test('a failed member calendar query fails matching and booking instead of treating the calendar as free', async t => {
  t.mock.method(console, 'error', () => {})
  const { owner, group } = await twoMemberGroup()
  failingScheduleUser = 'teammate'
  const matched = await request('/group-meetings/common-time', { method: 'POST', cookie: owner, body: searchFor(group.id) })
  assert.equal(matched.status, 500)
  for (const path of ['/group-meetings/meetings/preview', '/group-meetings/meetings']) {
    const response = await request(path, { method: 'POST', cookie: owner, body: meetingFor(group.id) })
    assert.equal(response.status, 500)
  }
  assert.equal(storedState.meetings.length, 0)
})
