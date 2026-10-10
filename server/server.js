const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const PORT = 8000;
const SESSION_SECRET = "67676767676767PDIDDYSECRET"
const USERS_FILE = path.join(__dirname, 'users.json')
const app = express()

app.use(cors())
app.use(express.json());

app.use(session({
  name: 'app.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
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



async function writeUsers(users) {
  const tmp = `${USERS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 4));
    fs.renameSync(tmp, USERS_FILE);
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {}

  const cleanUsername = username.trim()

  const users = await readUsers()

  const existingUser = users.find(
    user => user.username === cleanUsername
  )

  if (existingUser) {
    return res.status(409).json({
      message: 'Username is already taken'
    })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const newUser = {
    id: crypto.randomUUID(),
    username: cleanUsername,
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
  const { username, password } = req.body || {}

  const users = await readUsers()

  const user = users.find(
    item => item.username === username.trim()
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
      secure: true,
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
