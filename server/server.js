const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const PORT = 8000;
const SESSION_SECRET = "67676767676767PDIDDYSECRET"
const USERS_FILE = path.join(__dirname, 'users.json')
const COURSES_FILE = path.join(__dirname, 'courses.json')
const ASSIGNMENTS_FILE = path.join(__dirname, 'assignments.json')
const QUIZZES_FILE = path.join(__dirname, 'quizzes.json')
const ACTIVITIES_FILE = path.join(__dirname, 'activities.json')
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

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Please log in first.' })
  }

  next()
}

app.get('/api/planner-data', requireLogin, async (req, res, next) => {
  try {
    const [courseData, assignmentData, quizData, activities] = await Promise.all([
      readJsonFile(COURSES_FILE),
      readJsonFile(ASSIGNMENTS_FILE),
      readJsonFile(QUIZZES_FILE),
      readJsonFile(ACTIVITIES_FILE)
    ])

    const courses = (courseData.Items || []).map(item => item.OrgUnit).filter(Boolean)
    const courseNames = new Map(courses.map(course => [String(course.Id), course.Name]))
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
          IsCustom: Boolean(item.IsCustom)
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
        IsCustom: false
      }))
    })

    res.json({
      courses: courses.map(({ Id, Name, Code }) => ({ Id, Name, Code })),
      assignments,
      quizzes,
      activities: Array.isArray(activities) ? activities : []
    })
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
