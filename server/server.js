const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const groupMeetings = require('./group-meetings');
const database = require('./database');

const PORT = Number(process.env.PORT) || 8000;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required. Add it to server/.env.');
}
// Group Meetings state. Created on first use from the read-only fixture that
// also documents the shape of the data (see MOCK_DATA_README.md).
const GROUP_SEED_FILE = path.join(
  __dirname, '..', 'PocketSemester', 'src', 'data', 'group-meetings.mock.json'
)
const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json());

app.use(session({
  name: 'app.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24
  }
}))

async function readUsers() {
  const { rows } = await database.query(
    `select id, username, email, password_hash as "passwordHash", created_at as "createdAt"
       from planner_private.app_users
      order by created_at`
  )
  return rows
}

function createSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error)

      req.session.user = {
        id: user.id,
        username: user.username
      }

      req.session.save(error => {
        if (error) return reject(error)
        resolve()
      })
    })
  })
}



async function listReferenceCourses(userId) {
  const { rows } = await database.query(
    `select c.source
       from planner_private.reference_courses c
       join planner_private.course_enrollments e on e.course_id = c.course_id
      where e.user_id = $1
      order by c.sort_order`, [userId]
  )
  return rows.map(row => row.source)
}

async function getReferenceCourse(courseId, userId) {
  const { rows } = await database.query(
    `select c.source from planner_private.reference_courses c
      join planner_private.course_enrollments e on e.course_id = c.course_id
      where c.course_id = $1 and e.user_id = $2`,
    [String(courseId), userId]
  )
  return rows[0]?.source || null
}

async function listReferenceAssignments(userId) {
  const { rows } = await database.query(
    `select course_id, source
       from planner_private.reference_assignments a
       join planner_private.course_enrollments e using (course_id)
      where e.user_id = $1
      order by course_id, sort_order`, [userId]
  )
  return rows.map(row => ({ ...row.source, CourseId: row.course_id }))
}

async function listReferenceQuizzes(userId) {
  const { rows } = await database.query(
    `select course_id, source
       from planner_private.reference_quizzes q
       join planner_private.course_enrollments e using (course_id)
      where e.user_id = $1
      order by course_id, sort_order`, [userId]
  )
  return rows.map(row => ({ ...row.source, CourseId: row.course_id }))
}

async function courseworkItemExists(type, courseId, itemId, userId) {
  const table = type === 'assignment' ? 'reference_assignments' : 'reference_quizzes'
  const { rows } = await database.query(
    `select 1 from planner_private.${table} i
      join planner_private.course_enrollments e using (course_id)
      where i.course_id = $1 and i.item_id = $2 and e.user_id = $3 limit 1`,
    [String(courseId), String(itemId), userId]
  )
  if (rows.length) return true
  if (type !== 'assignment') return false

  const custom = await database.query(
    `select 1 from planner_private.custom_assignments
      where course_id = $1 and id = $2 and owner_id = $3 limit 1`,
    [String(courseId), String(itemId), userId]
  )
  return custom.rows.length > 0
}

function toActivity(row) {
  return {
    id: row.id,
    title: row.title,
    place: row.place,
    outdoor: row.outdoor,
    when: new Date(row.starts_at).toISOString(),
    end: new Date(row.ends_at).toISOString(),
    done: row.done,
    notes: row.notes,
    lat: row.latitude,
    lng: row.longitude
  }
}

async function listActivities(userId) {
  const { rows } = await database.query(
    `select id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude
       from planner_private.activities
      where owner_id is null or owner_id = $1
      order by starts_at, id`,
    [userId]
  )
  return rows.map(toActivity)
}

async function getActivityForUser(id, userId) {
  const { rows } = await database.query(
    `select id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude
       from planner_private.activities
      where id = $1 and (owner_id is null or owner_id = $2)`,
    [id, userId]
  )
  return rows[0] ? toActivity(rows[0]) : null
}

async function listCustomAssignments(userId) {
  const { rows } = await database.query(
    `select id, owner_id as "OwnerId", course_id as "CourseId", name as "Name",
            due_at as "DueDate", created_at as "CreatedAt"
       from planner_private.custom_assignments
      where owner_id = $1
      order by created_at, id`,
    [userId]
  )
  return rows.map(row => ({
    ...row,
    Id: row.id,
    IsCustom: true,
    DueDate: row.DueDate ? new Date(row.DueDate).toISOString() : null,
    CreatedAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : null
  }))
}

async function getCourseworkProgress(userId) {
  const { rows } = await database.query(
    `select kind, course_id, item_id, done
       from planner_private.coursework_progress
      where user_id = $1`,
    [userId]
  )
  return Object.fromEntries(rows.map(row => [
    `${row.kind}:${row.course_id}:${row.item_id}`,
    row.done
  ]))
}

async function saveCourseworkProgress(userId, kind, courseId, itemId, done) {
  await database.query(
    `insert into planner_private.coursework_progress (user_id, kind, course_id, item_id, done)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, kind, course_id, item_id)
     do update set done = excluded.done, updated_at = now()`,
    [userId, kind, courseId, itemId, done]
  )
}

/** All registered participants are read afresh; sample members keep their fixture calendars. */
async function loadGroupAvailability({ state, memberIds, assignmentBufferMinutes, rangeStart, rangeEnd }) {
  const selected = new Set(memberIds)
  const registered = new Set((await readUsers()).map(user => user.id))
  const busyIntervals = state.busyIntervals.filter(item => selected.has(item.userId))
  const overlaps = item => Date.parse(item.startAt) < rangeEnd && Date.parse(item.endAt) > rangeStart
  const sourceIntervals = busyIntervals.filter(overlaps)
  const sourceKeys = {
    activities: new Set(sourceIntervals.filter(item => !registered.has(item.userId) && !item.sourceMeetingId)
      .map(item => `saved:${item.id ?? `${item.userId}:${item.startAt}:${item.endAt}`}`)),
    assignments: new Set(),
    quizzes: new Set(),
    meetings: new Set(sourceIntervals.filter(item => item.sourceMeetingId).map(item => item.sourceMeetingId)),
  }
  const live = await Promise.all(memberIds.filter(userId => registered.has(userId)).map(async userId => {
    const [activities, assignments, quizzes, customAssignments, progress] = await Promise.all([
      listActivities(userId), listReferenceAssignments(userId), listReferenceQuizzes(userId),
      listCustomAssignments(userId), getCourseworkProgress(userId),
    ])
    return groupMeetings.buildPlannerBusyIntervals({
      userId, activities, assignments: [...assignments, ...customAssignments], quizzes, progress,
      assignmentBufferMinutes, rangeStart, rangeEnd,
    })
  }))
  for (const result of live) {
    busyIntervals.push(...result.busyIntervals)
    for (const kind of ['activities', 'assignments', 'quizzes']) {
      for (const key of result.sourceKeys[kind]) sourceKeys[kind].add(key)
    }
  }
  return {
    busyIntervals,
    sources: {
      ...Object.fromEntries(Object.entries(sourceKeys).map(([kind, keys]) => [kind, keys.size])),
      assignmentBufferMinutes,
    },
  }
}

/* ------------------------------------------------------------------ *
 * Group Meetings storage
 * ------------------------------------------------------------------ */

async function seedGroupStore() {
  const seed = JSON.parse(await fs.readFile(GROUP_SEED_FILE, 'utf8'))
  const state = {
    ...seed,
    version: 1,
    seededAt: new Date().toISOString()
  }
  groupMeetings.ensureGroupCodes(state.groups)
  return state
}

async function readGroupStore() {
  const state = await database.withTransaction(async client => {
    const existing = await client.query(
      'select state from planner_private.group_meeting_state where singleton = true'
    )
    if (existing.rows[0]) return existing.rows[0].state

    await client.query(
      `insert into planner_private.group_meeting_state (singleton, state)
       values (true, $1::jsonb) on conflict (singleton) do nothing`,
      [JSON.stringify(await seedGroupStore())]
    )
    const { rows } = await client.query(
      'select state from planner_private.group_meeting_state where singleton = true'
    )
    return rows[0].state
  })
  // Upgrade old groups once, using the same lock as group creation and joining.
  if (state.groups.some(group => !group.joinCode)) {
    return updateGroupStore(current => current)
  }
  return state
}

let groupStoreLock = Promise.resolve()

function withGroupStoreLock(task) {
  const run = groupStoreLock.then(task, task)
  groupStoreLock = run.then(() => undefined, () => undefined)
  return run
}

/** Read-modify-write under the lock: guards can never race a second writer. */
function updateGroupStore(mutator) {
  return withGroupStoreLock(async () => {
    return database.withTransaction(async client => {
      const current = await client.query(
        'select state from planner_private.group_meeting_state where singleton = true for update'
      )
      let state = current.rows[0]?.state
      if (!state) {
        await client.query(
          `insert into planner_private.group_meeting_state (singleton, state)
           values (true, $1::jsonb) on conflict (singleton) do nothing`,
          [JSON.stringify(await seedGroupStore())]
        )
        state = (await client.query(
          'select state from planner_private.group_meeting_state where singleton = true for update'
        )).rows[0].state
      }
      groupMeetings.ensureGroupCodes(state.groups)
      const outcome = await mutator(state)
      await client.query(
        `update planner_private.group_meeting_state
            set state = $1::jsonb, updated_at = now()
          where singleton = true`,
        [JSON.stringify(state)]
      )
      return outcome
    })
  })
}

function findGroupForViewer(state, groupId, viewerId) {
  const group = state.groups.find(item => item.id === groupId)
  if (!group) {
    throw new groupMeetings.HttpError(404, 'That group does not exist.', 'group_not_found')
  }
  if (!group.memberIds.includes(viewerId)) {
    throw new groupMeetings.HttpError(403, 'You are not a member of that group.', 'not_a_member')
  }
  return group
}

/** A registered account gets a member profile the first time it joins a group. */
function ensureMemberProfile(state, userId, name) {
  let member = state.members.find(item => item.id === userId)
  if (!member) {
    member = {
      id: userId,
      name,
      scheduleStatus: 'complete',
      coverageStartAt: null,
      coverageEndAt: null,
      isRegistered: true
    }
    state.members.push(member)
  }
  return member
}

function setShareFlag(state, groupId, userId, enabled) {
  const existing = state.availabilityShares.find(
    item => item.groupId === groupId && item.userId === userId
  )
  if (existing) {
    existing.enabled = enabled
    return existing
  }

  const share = { groupId, userId, enabled }
  state.availabilityShares.push(share)
  return share
}

function buildGroupMeetingsView(state, viewer, users) {
  const memberIndex = new Map(state.members.map(member => [member.id, member]))
  const userName = (id) => {
    const member = memberIndex.get(id)
    if (member?.name) return member.name
    const account = users.find(user => user.id === id)
    return account?.username || 'Unknown member'
  }

  const myGroups = state.groups.filter(group => group.memberIds.includes(viewer.id))
  const myGroupIds = new Set(myGroups.map(group => group.id))

  const groups = myGroups.map(group => ({
    id: group.id,
    name: group.name,
    joinCode: group.joinCode,
    ownerId: group.ownerId,
    isOwner: group.ownerId === viewer.id,
    memberCount: group.memberIds.length,
    members: group.memberIds.map(userId => {
      const share = state.availabilityShares.find(
        item => item.groupId === group.id && item.userId === userId
      )
      return {
        id: userId,
        name: userName(userId),
        isOwner: group.ownerId === userId,
        isViewer: userId === viewer.id,
        shared: share?.enabled === true,
        scheduleStatus: memberIndex.get(userId)?.scheduleStatus || 'unknown'
      }
    })
  }))

  const decorate = (invitation) => ({
    id: invitation.id,
    groupId: invitation.groupId,
    groupName: state.groups.find(group => group.id === invitation.groupId)?.name || 'Unknown group',
    fromUserId: invitation.fromUserId,
    fromUserName: userName(invitation.fromUserId),
    toUserId: invitation.toUserId,
    toUserName: userName(invitation.toUserId),
    status: invitation.status,
    createdAt: invitation.createdAt,
    respondedAt: invitation.respondedAt || null
  })

  const byNewest = (a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1
    if (b.status === 'pending' && a.status !== 'pending') return 1
    return String(b.createdAt).localeCompare(String(a.createdAt))
  }

  const demoGroup = state.groups.find(group => group.id === state.defaultGroupId)

  return {
    viewer: { id: viewer.id, username: viewer.username },
    timeZone: groupMeetings.TIME_ZONE,
    defaults: sanitizeDefaults(state.meetingPreferences),
    groups,
    incomingInvitations: state.invitations
      .filter(invitation => invitation.toUserId === viewer.id)
      .map(decorate)
      .sort(byNewest),
    sentInvitations: state.invitations
      .filter(invitation => invitation.fromUserId === viewer.id && myGroupIds.has(invitation.groupId))
      .map(decorate)
      .sort(byNewest),
    meetings: state.meetings
      .filter(meeting => myGroupIds.has(meeting.groupId))
      .map(meeting => ({
        ...meeting,
        groupName: state.groups.find(group => group.id === meeting.groupId)?.name || 'Unknown group',
        createdByName: meeting.createdBy ? userName(meeting.createdBy) : null,
        isMine: meeting.createdBy === viewer.id
      }))
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))),
    demo: {
      groupId: demoGroup?.id || null,
      groupName: demoGroup?.name || null,
      canJoin: Boolean(
        demoGroup &&
        myGroups.length === 0 &&
        !demoGroup.memberIds.includes(viewer.id)
      )
    }
  }
}

/**
 * Form defaults for the search. The stored preference window is reused while it
 * is still ahead of us; once it has passed the form jumps to today so the demo
 * never opens on a range that is already over.
 */
function sanitizeDefaults(preferences = {}) {
  const sgToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const shift = (dateText, days) =>
    new Date(Date.parse(`${dateText}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(preferences.fromDate || '') &&
    preferences.fromDate >= sgToday
    ? preferences.fromDate
    : sgToday

  return {
    fromDate,
    toDate: fromDate === preferences.fromDate && preferences.toDate ? preferences.toDate : shift(fromDate, 2),
    startTime: preferences.startTime || '09:00',
    endTime: preferences.endTime || '18:00',
    durationMinutes: preferences.durationMinutes || 60,
    assignmentBufferMinutes: groupMeetings.validateAssignmentBuffer(preferences.assignmentBufferMinutes)
  }
}

function windowSummary(window) {  return {
    fromDate: window.fromDate,
    toDate: window.toDate,
    startTime: window.startTime,
    endTime: window.endTime,
    durationMinutes: window.durationMinutes,
    assignmentBufferMinutes: window.assignmentBufferMinutes,
    stepMinutes: window.stepMinutes
  }
}


/* meetingActivitiesFor() - also called from /api/planner-data (see PART 3) */
function meetingActivitiesFor(userId) {
  return readGroupStore()
    .then(state => {
      const myGroupIds = new Set(
        state.groups.filter(group => group.memberIds.includes(userId)).map(group => group.id)
      )

      return state.meetings
        .filter(meeting =>
          myGroupIds.has(meeting.groupId) &&
          Array.isArray(meeting.participantIds) &&
          meeting.participantIds.includes(userId)
        )
        .map(meeting => groupMeetings.meetingToActivity(
          meeting,
          state.groups.find(group => group.id === meeting.groupId)?.name
        ))
    })
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Please log in first.' })
  }

  next()
}

app.get('/api/planner-data', requireLogin, async (req, res, next) => {
  try {
    const [courses, referenceAssignments, referenceQuizzes, activities, customAssignments, userProgress] = await Promise.all([
      listReferenceCourses(req.session.user.id),
      listReferenceAssignments(req.session.user.id),
      listReferenceQuizzes(req.session.user.id),
      listActivities(req.session.user.id),
      listCustomAssignments(req.session.user.id),
      getCourseworkProgress(req.session.user.id)
    ])

    const courseNames = new Map(courses.map(course => [String(course.Id), course.Name]))
    const { rows: announcements } = await database.query(
      `select a.announcement_id as "Id", a.title as "Title", a.body as "Body",
              a.posted_at as "PostedAt", a.course_id as "CourseId", c.name as "CourseName"
         from planner_private.reference_announcements a
         join planner_private.course_enrollments e on e.course_id = a.course_id
         join planner_private.reference_courses c on c.course_id = a.course_id
        where e.user_id = $1
        order by a.posted_at desc, a.sort_order
        limit 30`, [req.session.user.id]
    )
    const assignments = [...referenceAssignments, ...customAssignments].map(item => {
      const courseId = String(item.CourseId)
      return {
        Id: item.Id,
        Name: item.Name,
        Type: 'assignment',
        CourseId: courseId,
        CourseName: courseNames.get(courseId) || 'Unknown course',
        DueDate: item.DueDate || null,
        EventDate: item.DueDate || null,
        EventDateLabel: item.DueDate ? 'Due' : 'No due date',
        IsCustom: Boolean(item.IsCustom),
        Done: Boolean(userProgress[`assignment:${courseId}:${item.Id}`] ?? item.Done)
      }
    })

    const quizzes = referenceQuizzes.map(item => {
      const courseId = String(item.CourseId)
      return {
        Id: item.QuizId ?? item.Id,
        Name: item.Name,
        Type: 'quiz',
        CourseId: courseId,
        CourseName: courseNames.get(courseId) || 'Unknown course',
        DueDate: item.DueDate || null,
        StartDate: item.StartDate || null,
        EventDate: item.DueDate || item.StartDate || null,
        EventDateLabel: item.DueDate ? 'Due' : item.StartDate ? 'Available' : 'No date',
        IsCustom: false,
        Done: Boolean(userProgress[`quiz:${courseId}:${item.QuizId ?? item.Id}`] ?? item.Done)
      }
    })

    const meetingActivities = await meetingActivitiesFor(req.session.user.id)

    res.json({
      courses: courses.map(({ Id, Name, Code }) => ({ Id, Name, Code })),
      assignments,
      quizzes,
      announcements,
      activities: [...(Array.isArray(activities) ? activities : []), ...meetingActivities]
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/coursework/:type/:courseId/:id', requireLogin, async (req, res, next) => {
  try {
    const { type, courseId, id } = req.params
    const done = req.body?.done
    if (!['assignment', 'quiz'].includes(type) || typeof done !== 'boolean') {
      return res.status(400).json({ message: 'Choose a valid coursework item and completion status.' })
    }

    if (!await courseworkItemExists(type, courseId, id, req.session.user.id)) {
      return res.status(404).json({ message: 'Coursework item not found.' })
    }

    await saveCourseworkProgress(req.session.user.id, type, courseId, id, done)
    res.json({ done })
  } catch (error) {
    next(error)
  }
})

app.get('/api/activities', requireLogin, async (req, res, next) => {
  try {
    res.json(await listActivities(req.session.user.id))
  } catch (error) {
    next(error)
  }
})

app.post('/api/activities', requireLogin, async (req, res, next) => {
  try {
    const { title, when, end, outdoor, notes = '', place = '', lat = null, lng = null } = req.body || {}
    const startDate = new Date(when)
    const endDate = new Date(end)

    if (typeof title !== 'string' || !title.trim() || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return res.status(400).json({ message: 'Enter an activity name and a valid start and end time.' })
    }

    const activity = {
      id: crypto.randomUUID(),
      title: title.trim(),
      place: typeof place === 'string' ? place.trim() : '',
      outdoor: Boolean(outdoor),
      when: startDate.toISOString(),
      end: endDate.toISOString(),
      done: false,
      notes: typeof notes === 'string' ? notes.trim() : '',
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    }

    const { rows } = await database.query(
      `insert into planner_private.activities
        (id, owner_id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude`,
      [activity.id, req.session.user.id, activity.title, activity.place, activity.outdoor,
        activity.when, activity.end, activity.done, activity.notes, activity.lat, activity.lng]
    )
    res.status(201).json(toActivity(rows[0]))
  } catch (error) {
    next(error)
  }
})

app.post('/api/activities/:id', requireLogin, async (req, res, next) => {
  try {
    const activity = await getActivityForUser(req.params.id, req.session.user.id)

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found.' })
    }

    const allowedFields = ['title', 'place', 'outdoor', 'when', 'end', 'done', 'notes', 'lat', 'lng']
    for (const field of allowedFields) {
      if (Object.hasOwn(req.body || {}, field)) activity[field] = req.body[field]
    }

    const startDate = new Date(activity.when)
    const endDate = new Date(activity.end)
    if (typeof activity.title !== 'string' || !activity.title.trim() || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return res.status(400).json({ message: 'Enter an activity name and a valid start and end time.' })
    }

    activity.title = activity.title.trim()
    activity.when = startDate.toISOString()
    activity.end = endDate.toISOString()
    const { rows } = await database.query(
      `update planner_private.activities
          set title = $3, place = $4, outdoor = $5, starts_at = $6, ends_at = $7,
              done = $8, notes = $9, latitude = $10, longitude = $11
        where id = $1 and (owner_id is null or owner_id = $2)
        returning id, title, place, outdoor, starts_at, ends_at, done, notes, latitude, longitude`,
      [activity.id, req.session.user.id, activity.title, activity.place, Boolean(activity.outdoor),
        activity.when, activity.end, Boolean(activity.done), activity.notes || '', activity.lat, activity.lng]
    )
    res.json(toActivity(rows[0]))
  } catch (error) {
    next(error)
  }
})

app.delete('/api/activities/:id', requireLogin, async (req, res, next) => {
  try {
    const result = await database.query(
      `delete from planner_private.activities
        where id = $1 and (owner_id is null or owner_id = $2)`,
      [req.params.id, req.session.user.id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Activity not found.' })
    }

    res.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

app.post('/api/assignments', requireLogin, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const courseId = String(req.body?.courseId || '')
    const dueDateInput = req.body?.dueDate || null

    if (!name || !courseId) {
      return res.status(400).json({ message: 'Assignment name and course are required.' })
    }

    const course = await getReferenceCourse(courseId, req.session.user.id)

    if (!course) {
      return res.status(400).json({ message: 'Choose a course from the course list.' })
    }

    let dueDate = null
    if (dueDateInput) {
      const parsedDate = new Date(dueDateInput)
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: 'Enter a valid due date.' })
      }
      dueDate = parsedDate.toISOString()
    }

    const assignment = {
      Id: crypto.randomUUID(),
      Name: name,
      DueDate: dueDate,
      CourseId: courseId,
      IsCustom: true,
      OwnerId: req.session.user.id,
      CreatedAt: new Date().toISOString()
    }

    await database.query(
      `insert into planner_private.custom_assignments
        (id, owner_id, course_id, name, due_at, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [String(assignment.Id), assignment.OwnerId, courseId, assignment.Name, dueDate, assignment.CreatedAt]
    )

    res.status(201).json({
      assignment: {
        ...assignment,
        Type: 'assignment',
        CourseName: course.Name
      }
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/assignments/:courseId/:id', requireLogin, async (req, res, next) => {
  try {
    const { courseId, id } = req.params
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const dueDateInput = req.body?.dueDate || null
    if (!name) return res.status(400).json({ message: 'Assignment name is required.' })

    let dueDate = null
    if (dueDateInput) {
      const parsedDate = new Date(dueDateInput)
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: 'Enter a valid due date.' })
      }
      dueDate = parsedDate.toISOString()
    }

    const course = await getReferenceCourse(courseId, req.session.user.id)
    if (!course) {
      return res.status(404).json({ message: 'Your custom assignment could not be found.' })
    }
    const { rows } = await database.query(
      `update planner_private.custom_assignments
          set name = $4, due_at = $5
        where course_id = $1 and id = $2 and owner_id = $3
        returning id, owner_id as "OwnerId", course_id as "CourseId", name as "Name",
                  due_at as "DueDate", created_at as "CreatedAt"`,
      [courseId, id, req.session.user.id, name, dueDate]
    )
    const row = rows[0]
    const assignment = row ? {
      ...row,
      Id: row.id,
      IsCustom: true,
      DueDate: row.DueDate ? new Date(row.DueDate).toISOString() : null,
      CreatedAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : null
    } : null
    if (!assignment) {
      return res.status(404).json({ message: 'Your custom assignment could not be found.' })
    }

    res.json({
      assignment: {
        ...assignment,
        Type: 'assignment',
        CourseName: course.Name,
        EventDate: dueDate,
        EventDateLabel: dueDate ? 'Due' : 'No due date'
      }
    })
  } catch (error) {
    next(error)
  }
})

/* ------------------------------------------------------------------ *
 * Group Meetings endpoints
 * ------------------------------------------------------------------ */

// Keeps error handling for these routes local: domain errors carry their own
// status code, anything else is a genuine fault and is logged without leaking
// internals to the client. The rest of the app keeps its existing behaviour.
function sendGroupError(error, res, next) {
  if (res.headersSent) return next(error)

  const status = Number(error?.statusCode) || 500
  if (status >= 500) {
    console.error('Group Meetings error:', error)
  }

  res.status(status).json({
    message: status >= 500 ? 'Something went wrong on the server.' : error.message,
    code: error?.code || 'error',
    ...(error?.details ? { details: error.details } : {})
  })
}

// Everything the Group Meetings screen needs, scoped to the signed-in user.
// Busy intervals themselves are never sent to the browser: teammates only
// learn whether a slot is free, never what is on each other's calendar.
app.get('/api/group-meetings', requireLogin, async (req, res, next) => {
  try {
    const [state, users] = await Promise.all([readGroupStore(), readUsers()])
    res.json(buildGroupMeetingsView(state, req.session.user, users))
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

// Common free time. Returns { status: 'blocked', blockers } when any selected
// member has an incomplete calendar or has insufficient
// coverage - missing information is UNKNOWN, never FREE.
app.post('/api/group-meetings/common-time', requireLogin, async (req, res, next) => {
  try {
    const state = await readGroupStore()
    const group = findGroupForViewer(state, req.body?.groupId, req.session.user.id)
    const window = groupMeetings.buildWindow(req.body || {})

    const readiness = groupMeetings.evaluateReadiness({
      group,
      members: state.members,
      shares: state.availabilityShares,
      windowStart: window.start,
      windowEnd: window.end
    })

    const members = group.memberIds.map(userId => {
      const member = state.members.find(item => item.id === userId)
      const share = state.availabilityShares.find(
        item => item.groupId === group.id && item.userId === userId
      )
      return {
        id: userId,
        name: member?.name || userId,
        shared: share?.enabled === true,
        scheduleStatus: member?.scheduleStatus || 'unknown'
      }
    })

    if (!readiness.ready) {
      return res.json({
        status: 'blocked',
        groupId: group.id,
        window: windowSummary(window),
        members,
        blockers: readiness.blockers,
        days: [],
        best: null,
        totalSlots: 0,
        truncated: false,
        availability: { stepMinutes: window.stepMinutes, days: [] },
        sources: { activities: 0, assignments: 0, quizzes: 0, meetings: 0, assignmentBufferMinutes: window.assignmentBufferMinutes }
      })
    }

    const live = await loadGroupAvailability({
      state, memberIds: group.memberIds, assignmentBufferMinutes: window.assignmentBufferMinutes,
      rangeStart: window.start, rangeEnd: window.end
    })
    const result = groupMeetings.findCommonTimes({
      memberIds: group.memberIds,
      busyIntervals: live.busyIntervals,
      window,
      now: Date.now()
    })

    res.json({
      status: 'ok',
      groupId: group.id,
      window: windowSummary(window),
      members,
      blockers: [],
      sources: live.sources,
      ...result
    })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

// Dry run used by the booking form: who is busy at that time, without writing
// anything. The browser turns a non-empty list into a confirmation dialog.
app.post('/api/group-meetings/meetings/preview', requireLogin, async (req, res, next) => {
  try {
    const state = await readGroupStore()
    const group = findGroupForViewer(state, req.body?.groupId, req.session.user.id)
    const draft = groupMeetings.validateBookingDraft({
      draft: req.body || {},
      group,
      viewerId: req.session.user.id
    })

    const live = await loadGroupAvailability({
      state, memberIds: draft.participantIds, assignmentBufferMinutes: draft.assignmentBufferMinutes,
      rangeStart: draft.start, rangeEnd: draft.end
    })
    const conflicts = groupMeetings.findBookingConflicts({
      participantIds: draft.participantIds,
      start: draft.start,
      end: draft.end,
      busyIntervals: live.busyIntervals,
      members: state.members
    })

    res.json({
      conflicts,
      durationMinutes: draft.durationMinutes,
      participantIds: draft.participantIds,
      startAt: groupMeetings.toIso(draft.start),
      endAt: groupMeetings.toIso(draft.end),
      sources: live.sources,
      assignmentBufferMinutes: draft.assignmentBufferMinutes
    })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

// Books a meeting into the group. A booking is a commitment: it is validated
// against every participant's busy intervals (including earlier meetings) and
// the same slot stops appearing in later searches. `force: true` is only sent
// after the user confirms a clash in the dialog, and is recorded on the record.
app.post('/api/group-meetings/meetings', requireLogin, async (req, res, next) => {
  try {
    const force = req.body?.force === true

    const result = await updateGroupStore(async state => {
      const group = findGroupForViewer(state, req.body?.groupId, req.session.user.id)
      const draft = groupMeetings.validateBookingDraft({
        draft: req.body || {},
        group,
        viewerId: req.session.user.id
      })

      const live = await loadGroupAvailability({
        state, memberIds: draft.participantIds, assignmentBufferMinutes: draft.assignmentBufferMinutes,
        rangeStart: draft.start, rangeEnd: draft.end
      })
      const conflicts = groupMeetings.findBookingConflicts({
        participantIds: draft.participantIds,
        start: draft.start,
        end: draft.end,
        busyIntervals: live.busyIntervals,
        members: state.members
      })

      if (conflicts.length && !force) {
        const names = conflicts.map(item => item.name).join(', ')
        const error = new groupMeetings.HttpError(
          409,
          `That time is already busy for ${names}. Pick another slot, or confirm to book anyway.`,
          'slot_conflict'
        )
        error.details = { conflicts }
        throw error
      }

      const records = groupMeetings.buildMeetingRecords({
        draft,
        groupId: group.id,
        createdBy: req.session.user.id,
        makeId: prefix => `${prefix}-${crypto.randomUUID()}`,
        forced: conflicts.length > 0
      })

      state.meetings.push(records.meeting)
      state.busyIntervals.push(...records.busyIntervals)
      return { meeting: records.meeting, groupName: group.name }
    })

    res.status(201).json({
      meeting: { ...result.meeting, groupName: result.groupName },
      activityId: `activity-${result.meeting.id}`
    })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

// Cancelling removes the meeting and the busy intervals it created, so the slot
// becomes bookable again. The planner activity disappears with it, because it
// is derived from the meeting rather than stored separately.
app.delete('/api/group-meetings/meetings/:id', requireLogin, async (req, res, next) => {
  try {
    const result = await updateGroupStore(state => {
      const meeting = state.meetings.find(item => item.id === req.params.id)
      const group = meeting
        ? state.groups.find(item => item.id === meeting.groupId)
        : null

      groupMeetings.checkMeetingCancellable({
        meeting,
        group,
        actorId: req.session.user.id
      })

      const before = state.busyIntervals.length
      state.meetings = state.meetings.filter(item => item.id !== meeting.id)
      state.busyIntervals = state.busyIntervals.filter(
        item => item.sourceMeetingId !== meeting.id
      )

      return {
        meetingId: meeting.id,
        title: meeting.title,
        removedBusyIntervals: before - state.busyIntervals.length
      }
    })

    res.json({ cancelled: true, ...result })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

app.post('/api/group-meetings/groups', requireLogin, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (name.length < 2 || name.length > groupMeetings.MAX_GROUP_NAME) {
      throw new groupMeetings.ValidationError(
        `Group name must be between 2 and ${groupMeetings.MAX_GROUP_NAME} characters.`
      )
    }

    const group = await updateGroupStore(state => {
      const created = {
        id: `group-${crypto.randomUUID()}`,
        name,
        joinCode: groupMeetings.createGroupCode(state.groups),
        ownerId: req.session.user.id,
        memberIds: [req.session.user.id],
        createdAt: new Date().toISOString()
      }
      state.groups.push(created)
      ensureMemberProfile(state, req.session.user.id, req.session.user.username)
      // Creating a group does not share anything: consent is a separate step.
      setShareFlag(state, created.id, req.session.user.id, false)
      return created
    })

    res.status(201).json({ group })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

app.post('/api/group-meetings/groups/join', requireLogin, async (req, res, next) => {
  try {
    // Validate before acquiring the store lock; membership checks stay inside it.
    const code = groupMeetings.normalizeGroupCode(req.body?.code)
    const group = await updateGroupStore(state => {
      const joined = groupMeetings.joinGroupByCode({
        groups: state.groups,
        invitations: state.invitations,
        code,
        userId: req.session.user.id
      })
      ensureMemberProfile(state, req.session.user.id, req.session.user.username)
      setShareFlag(state, joined.id, req.session.user.id, false)
      return joined
    })
    res.status(201).json({ group })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

app.delete('/api/group-meetings/groups/:id/members/:memberId', requireLogin, async (req, res, next) => {
  try {
    const result = await updateGroupStore(state => groupMeetings.removeGroupMember({
      state,
      groupId: req.params.id,
      actorId: req.session.user.id,
      memberId: req.params.memberId
    }))
    res.json(result)
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

app.post('/api/group-meetings/groups/:id/leave', requireLogin, async (req, res, next) => {
  try {
    const result = await updateGroupStore(state => groupMeetings.leaveGroup({
      state,
      groupId: req.params.id,
      userId: req.session.user.id
    }))
    res.json(result)
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

// Explicit opt-in used to demo the seeded sample schedules on a fresh account.
app.post('/api/group-meetings/demo-group/join', requireLogin, async (req, res, next) => {
  try {
    const group = await updateGroupStore(state => {
      const demoGroup = state.groups.find(item => item.id === state.defaultGroupId)
      if (!demoGroup) {
        throw new groupMeetings.HttpError(404, 'The demo group is not available.', 'group_not_found')
      }
      if (demoGroup.memberIds.includes(req.session.user.id)) {
        throw new groupMeetings.HttpError(409, 'You already belong to the demo group.', 'already_member')
      }
      if (demoGroup.memberIds.length >= groupMeetings.MAX_GROUP_MEMBERS) {
        throw new groupMeetings.HttpError(409, `A group can hold at most ${groupMeetings.MAX_GROUP_MEMBERS} members.`, 'group_full')
      }
      demoGroup.memberIds.push(req.session.user.id)
      ensureMemberProfile(state, req.session.user.id, req.session.user.username)
      // The button itself is the consent: it says availability will be shared.
      setShareFlag(state, demoGroup.id, req.session.user.id, true)
      return demoGroup
    })

    res.status(201).json({ group })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

app.patch('/api/group-meetings/shares', requireLogin, async (req, res, next) => {
  try {
    const enabled = req.body?.enabled === true
    const share = await updateGroupStore(state => {
      const group = findGroupForViewer(state, req.body?.groupId, req.session.user.id)
      return setShareFlag(state, group.id, req.session.user.id, enabled)
    })

    res.json({ share })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

app.post('/api/group-meetings/invitations', requireLogin, async (req, res, next) => {
  try {
    const groupId = typeof req.body?.groupId === 'string' ? req.body.groupId : ''
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    if (!email) {
      throw new groupMeetings.ValidationError('Enter the email address of the account to invite.')
    }

    const users = await readUsers()
    const targetUser = users.find(user => String(user.email || '').toLowerCase() === email)

    const invitation = await updateGroupStore(state => {
      const group = state.groups.find(item => item.id === groupId)
      groupMeetings.checkInvitationAllowed({
        group,
        inviterId: req.session.user.id,
        targetUser,
        invitations: state.invitations
      })

      const created = {
        id: `invite-${crypto.randomUUID()}`,
        groupId: group.id,
        fromUserId: req.session.user.id,
        toUserId: targetUser.id,
        status: 'pending',
        createdAt: new Date().toISOString(),
        respondedAt: null
      }
      state.invitations.push(created)
      return created
    })

    res.status(201).json({ invitation })
  } catch (error) {
    sendGroupError(error, res, next)
  }
})

function respondToInvitation(action) {
  return async (req, res, next) => {
    try {
      const users = await readUsers()

      const result = await updateGroupStore(state => {
        const invitation = state.invitations.find(item => item.id === req.params.id)
        const group = invitation
          ? state.groups.find(item => item.id === invitation.groupId)
          : null

        if (invitation) groupMeetings.assertGroupStillExists(group)

        const updated = groupMeetings.applyInvitationResponse({
          invitation,
          group,
          actorId: req.session.user.id,
          action
        })

        if (updated.status === 'accepted') {
          const account = users.find(user => user.id === updated.toUserId)
          ensureMemberProfile(state, updated.toUserId, account?.username || updated.toUserId)
          // Membership is not consent: sharing stays off until they opt in.
          const existingShare = state.availabilityShares.find(
            item => item.groupId === updated.groupId && item.userId === updated.toUserId
          )
          if (!existingShare) {
            setShareFlag(state, updated.groupId, updated.toUserId, false)
          }
        }

        return { invitation: updated }
      })

      res.json(result)
    } catch (error) {
      sendGroupError(error, res, next)
    }
  }
}

app.post('/api/group-meetings/invitations/:id/accept', requireLogin, respondToInvitation('accept'))
app.post('/api/group-meetings/invitations/:id/decline', requireLogin, respondToInvitation('decline'))
app.post('/api/group-meetings/invitations/:id/cancel', requireLogin, respondToInvitation('cancel'))

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {}
  const cleanUsername = typeof name === 'string' ? name.trim() : ''
  const cleanEmail = typeof email === 'string' ? email.trim() : ''
  if (!cleanUsername || !cleanEmail || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Enter a name, a valid email, and a password with at least 8 characters.' })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const newUser = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    email: cleanEmail,
    passwordHash,
    createdAt: new Date().toISOString()
  }

  try {
    await database.query(
      `insert into planner_private.app_users (id, username, email, password_hash, created_at)
       values ($1, $2, $3, $4, $5)`,
      [newUser.id, newUser.username, newUser.email, newUser.passwordHash, newUser.createdAt]
    )
  } catch (error) {
    if (error.code !== '23505') throw error
    return res.status(409).json({
      message: 'Username or email is already taken'
    })
  }

  res.status(201).json({
    message: 'Registration successful',
    user: {
      id: newUser.id,
      username: newUser.username
    }
  })
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {}
  const cleanEmail = typeof email === 'string' ? email.trim() : ''
  if (!cleanEmail || typeof password !== 'string') {
    return res.status(401).json({ message: 'Invalid username or password' })
  }
  const { rows } = await database.query(
    `select id, username, email, password_hash as "passwordHash"
       from planner_private.app_users
      where email = $1 limit 1`,
    [cleanEmail]
  )
  const user = rows[0]

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({
      message: 'Invalid username or password'
    })
  }

  await createSession(req, user)


  res.json({
    message: 'Login successful',
    user: {
      id: user.id,
      username: user.username
    }
  })
})

app.post('/api/logout', (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error)

    res.clearCookie('app.sid', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/'
    })

    res.json({ message: 'Logged out successfully' })
  })
})

/*

for protected APIs, use this!!!!!!!!

if (!req.session.user) {
    return res.status(401).json({
      message: 'Please log in first'
    })
}

*/

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      message: 'Not logged in'
    })
  }

  res.json({ user: req.session.user })
})

app.all('/api/{*splat}', (req, res) => {
    res.status(405).json({ message: 'Method not allowed.' });
});


app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
});

if (require.main === module) {
  database.query('select 1').then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}/`)
    })
  }).catch(error => {
    console.error('Could not connect to Supabase. Check DATABASE_URL in server/.env.', error.message)
    database.close().finally(() => {
      process.exitCode = 1
    })
  })
}

module.exports = app
