const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const groupMeetings = require('./group-meetings');

const PORT = 8000;
const SESSION_SECRET = "67676767676767PDIDDYSECRET"
const USERS_FILE = path.join(__dirname, 'users.json')
const COURSES_FILE = path.join(__dirname, 'courses.json')
const ASSIGNMENTS_FILE = path.join(__dirname, 'assignments.json')
const QUIZZES_FILE = path.join(__dirname, 'quizzes.json')
const ACTIVITIES_FILE = path.join(__dirname, 'activities.json')
const COURSEWORK_PROGRESS_FILE = path.join(__dirname, 'coursework-progress.json')
// Group Meetings state. Created on first use from the read-only fixture that
// also documents the shape of the data (see MOCK_DATA_README.md).
const GROUP_STORE_FILE = path.join(__dirname, 'group-meetings.json')
const GROUP_SEED_FILE = path.join(
  __dirname, '..', 'Student Activity Planner', 'src', 'data', 'group-meetings.mock.json'
)
const app = express()

app.use(cors({
  origin: 'http://localhost:5173',
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
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeUsers([])
      return []
    }

    throw error
  }
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



async function writeUsers(data) {
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2))    
}

async function readJsonFile(filePath) {
  const contents = await fs.readFile(filePath, 'utf8')
  return JSON.parse(contents)
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n')
}

async function writeJsonAtomic(filePath, data) {
  const temporary = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n')
  await fs.rename(temporary, filePath)
}

/* ------------------------------------------------------------------ *
 * Group Meetings storage
 * ------------------------------------------------------------------ */

let groupSeedPromise = null

async function seedGroupStore() {
  const seed = JSON.parse(await fs.readFile(GROUP_SEED_FILE, 'utf8'))
  const state = {
    ...seed,
    version: 1,
    seededAt: new Date().toISOString()
  }
  await writeJsonAtomic(GROUP_STORE_FILE, state)
  return state
}

async function readGroupStore() {
  try {
    return JSON.parse(await fs.readFile(GROUP_STORE_FILE, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!groupSeedPromise) {
      groupSeedPromise = seedGroupStore().finally(() => {
        groupSeedPromise = null
      })
    }
    return groupSeedPromise
  }
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
    const state = await readGroupStore()
    const outcome = await mutator(state)
    await writeJsonAtomic(GROUP_STORE_FILE, state)
    return outcome
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
    durationMinutes: preferences.durationMinutes || 60
  }
}

function windowSummary(window) {  return {
    fromDate: window.fromDate,
    toDate: window.toDate,
    startTime: window.startTime,
    endTime: window.endTime,
    durationMinutes: window.durationMinutes,
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
    .catch(error => {
      console.warn('Could not read group meetings for the planner timeline:', error.message)
      return []
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
    const [courseData, assignmentData, quizData, activities, progressData] = await Promise.all([
      readJsonFile(COURSES_FILE),
      readJsonFile(ASSIGNMENTS_FILE),
      readJsonFile(QUIZZES_FILE),
      readJsonFile(ACTIVITIES_FILE),
      readJsonFile(COURSEWORK_PROGRESS_FILE)
    ])

    const courses = (courseData.Items || []).map(item => item.OrgUnit).filter(Boolean)
    const courseNames = new Map(courses.map(course => [String(course.Id), course.Name]))
    const userProgress = progressData[req.session.user.id] || {}
    const assignments = Object.entries(assignmentData).flatMap(([courseId, items]) =>
      (Array.isArray(items) ? items : [])
        .filter(item => !item.IsCustom || item.OwnerId === req.session.user.id)
        .map(item => {
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
    )

    const quizzes = Object.entries(quizData).flatMap(([courseId, data]) => {
      const items = Array.isArray(data) ? data : (data.Items || [])

      return items.map(item => ({
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
        Done: Boolean(userProgress[`quiz:${courseId}:${item.QuizId ?? item.Id}`])
      }))
    })

    const meetingActivities = await meetingActivitiesFor(req.session.user.id)

    res.json({
      courses: courses.map(({ Id, Name, Code }) => ({ Id, Name, Code })),
      assignments,
      quizzes,
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

    const sourceFile = type === 'assignment' ? ASSIGNMENTS_FILE : QUIZZES_FILE
    const sourceData = await readJsonFile(sourceFile)
    const source = sourceData[courseId]
    const items = Array.isArray(source) ? source : (source?.Items || [])
    const exists = items.some(item => String(type === 'quiz' ? (item.QuizId ?? item.Id) : item.Id) === id)
    if (!exists) return res.status(404).json({ message: 'Coursework item not found.' })

    const progressData = await readJsonFile(COURSEWORK_PROGRESS_FILE)
    if (!progressData[req.session.user.id]) progressData[req.session.user.id] = {}
    progressData[req.session.user.id][`${type}:${courseId}:${id}`] = done
    await writeJsonFile(COURSEWORK_PROGRESS_FILE, progressData)
    res.json({ done })
  } catch (error) {
    next(error)
  }
})

app.get('/api/activities', requireLogin, async (req, res, next) => {
  try {
    const activities = await readJsonFile(ACTIVITIES_FILE)
    res.json(Array.isArray(activities) ? activities : [])
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

    const activities = await readJsonFile(ACTIVITIES_FILE)
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

    activities.push(activity)
    await writeJsonFile(ACTIVITIES_FILE, activities)
    res.status(201).json(activity)
  } catch (error) {
    next(error)
  }
})

app.post('/api/activities/:id', requireLogin, async (req, res, next) => {
  try {
    const activities = await readJsonFile(ACTIVITIES_FILE)
    const activity = activities.find(item => String(item.id) === req.params.id)

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
    await writeJsonFile(ACTIVITIES_FILE, activities)
    res.json(activity)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/activities/:id', requireLogin, async (req, res, next) => {
  try {
    const activities = await readJsonFile(ACTIVITIES_FILE)
    const remainingActivities = activities.filter(item => String(item.id) !== req.params.id)

    if (remainingActivities.length === activities.length) {
      return res.status(404).json({ message: 'Activity not found.' })
    }

    await writeJsonFile(ACTIVITIES_FILE, remainingActivities)
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

    const [courseData, assignmentData] = await Promise.all([
      readJsonFile(COURSES_FILE),
      readJsonFile(ASSIGNMENTS_FILE)
    ])
    const course = (courseData.Items || []).map(item => item.OrgUnit).find(item =>
      String(item?.Id) === courseId
    )

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

    const courseAssignments = Array.isArray(assignmentData[courseId]) ? assignmentData[courseId] : []
    const assignment = {
      Id: Date.now(),
      Name: name,
      DueDate: dueDate,
      CourseId: courseId,
      IsCustom: true,
      OwnerId: req.session.user.id,
      CreatedAt: new Date().toISOString()
    }

    courseAssignments.push(assignment)
    assignmentData[courseId] = courseAssignments
    await writeJsonFile(ASSIGNMENTS_FILE, assignmentData)

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

    const [courseData, assignmentData] = await Promise.all([
      readJsonFile(COURSES_FILE),
      readJsonFile(ASSIGNMENTS_FILE)
    ])
    const course = (courseData.Items || []).map(item => item.OrgUnit).find(item => String(item?.Id) === courseId)
    const assignment = (assignmentData[courseId] || []).find(item =>
      String(item.Id) === id && item.IsCustom && item.OwnerId === req.session.user.id
    )
    if (!course || !assignment) {
      return res.status(404).json({ message: 'Your custom assignment could not be found.' })
    }

    assignment.Name = name
    assignment.DueDate = dueDate
    await writeJsonFile(ASSIGNMENTS_FILE, assignmentData)
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
// member has not shared, has an incomplete calendar or has insufficient
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
        truncated: false
      })
    }

    const result = groupMeetings.findCommonTimes({
      memberIds: group.memberIds,
      busyIntervals: state.busyIntervals,
      window
    })

    res.json({
      status: 'ok',
      groupId: group.id,
      window: windowSummary(window),
      members,
      blockers: [],
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

    const conflicts = groupMeetings.findBookingConflicts({
      participantIds: draft.participantIds,
      start: draft.start,
      end: draft.end,
      busyIntervals: state.busyIntervals,
      members: state.members
    })

    res.json({
      conflicts,
      durationMinutes: draft.durationMinutes,
      participantIds: draft.participantIds,
      startAt: groupMeetings.toIso(draft.start),
      endAt: groupMeetings.toIso(draft.end)
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

    const result = await updateGroupStore(state => {
      const group = findGroupForViewer(state, req.body?.groupId, req.session.user.id)
      const draft = groupMeetings.validateBookingDraft({
        draft: req.body || {},
        group,
        viewerId: req.session.user.id
      })

      const conflicts = groupMeetings.findBookingConflicts({
        participantIds: draft.participantIds,
        start: draft.start,
        end: draft.end,
        busyIntervals: state.busyIntervals,
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

  const cleanUsername = name.trim()
  const cleanEmail = email.trim()

  const users = await readUsers()

  const existingUser = users.find(
    user => user.username === cleanUsername
  )

  const existingEmail = users.find(
    user => user.email === cleanEmail
  )

  if (existingUser || existingEmail) {
    return res.status(409).json({
      message: 'Username or email is already taken'
    })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const newUser = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    email: cleanEmail,
    passwordHash: passwordHash,
    createdAt: new Date().toISOString()
  }

  users.push(newUser)
  await writeUsers(users)


  res.status(200).json({
    message: 'Registration successful',
    user: {
      id: newUser.id,
      username: newUser.username
    }
  })
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {}

  const users = await readUsers()

  const user = users.find(
    item => item.email === email.trim()
  )

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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
