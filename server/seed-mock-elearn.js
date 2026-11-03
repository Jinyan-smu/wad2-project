require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const bcrypt = require('bcrypt')
const database = require('./database')

const users = [
  { id: '3a14b6d1-9e21-4b7c-8a41-001000000001', name: 'Rithik Panneer', email: 'rithik.p.2025@computing.smu.edu.sg', password: '12345678', courses: ['IS111', 'IS112', 'IS113'] },
  { id: '3a14b6d1-9e21-4b7c-8a41-001000000002', name: 'Huang Chujun', email: 'cj.huang.2025@computing.smu.edu.sg', password: '23456781', courses: ['IS114', 'IS115', 'IS116'] },
  { id: '3a14b6d1-9e21-4b7c-8a41-001000000003', name: 'Yang Qizuo', email: 'qizuo.yang.2025@computing.smu.edu.sg', password: '34567812', courses: ['IS117', 'IS118', 'IS119'] },
  { id: '3a14b6d1-9e21-4b7c-8a41-001000000004', name: 'Zhang Jinyan', email: 'jy.zhang.2025@computing.smu.edu.sg', password: '456781234', courses: ['IS120', 'IS121', 'IS122'] }
]

const courseNames = [
  ['IS111', 'Introduction to Programming'], ['IS112', 'Data Management'],
  ['IS113', 'Web Application Development'], ['IS114', 'Object-Oriented Programming'],
  ['IS115', 'Operating Systems'], ['IS116', 'Data Structures and Algorithms'],
  ['IS117', 'Software Engineering'], ['IS118', 'Artificial Intelligence'],
  ['IS119', 'Computer Networks'], ['IS120', 'Information Systems'],
  ['IS121', 'Cybersecurity Fundamentals'], ['IS122', 'Cloud Computing']
]

const assignmentTitles = ['Problem Set', 'Group Project Milestone', 'Individual Reflection']
const quizTitles = ['Weekly Knowledge Check', 'Midterm Practice Quiz']
const announcements = [
  ['Welcome to the course', 'Welcome! Check the course outline and weekly learning materials before the first class.'],
  ['Assessment reminder', 'Please review the assessment brief and submit your work through the course site before the due date.'],
  ['Consultation hours', 'Consultation hours are available this week. Bring questions about the lecture topics or coursework.']
]

async function seed() {
  await database.withTransaction(async client => {
    const userIds = new Map()
    for (const user of users) {
      const passwordHash = await bcrypt.hash(user.password, 12)
      const result = await client.query(
        `insert into planner_private.app_users (id, username, email, password_hash)
         values ($1, $2, $3, $4)
         on conflict (email) do update set username = excluded.username, password_hash = excluded.password_hash
         returning id`,
        [user.id, user.name, user.email, passwordHash]
      )
      userIds.set(user.email, result.rows[0].id)
    }

    for (const [index, [code, name]] of courseNames.entries()) {
      const courseId = `mock-${code.toLowerCase()}`
      const course = { Id: courseId, Name: name, Code: code }
      await client.query(
        `insert into planner_private.reference_courses (course_id, sort_order, name, code, source)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (course_id) do update set sort_order = excluded.sort_order, name = excluded.name, code = excluded.code, source = excluded.source`,
        [courseId, 100 + index, name, code, JSON.stringify(course)]
      )

      for (const [itemIndex, title] of assignmentTitles.entries()) {
        const itemId = `${courseId}-assignment-${itemIndex + 1}`
        const dueAt = new Date(Date.UTC(2026, 10, 16 + index + itemIndex * 4, 16)).toISOString()
        const item = { Id: itemId, Name: `${title} ${itemIndex + 1}`, DueDate: dueAt, IsMock: true, Done: false }
        await client.query(
          `insert into planner_private.reference_assignments (course_id, item_id, sort_order, name, due_at, is_mock, done, source)
           values ($1, $2, $3, $4, $5, true, false, $6::jsonb)
           on conflict (course_id, item_id) do update set name = excluded.name, due_at = excluded.due_at, source = excluded.source`,
          [courseId, itemId, itemIndex + 1, item.Name, dueAt, JSON.stringify(item)]
        )
      }

      for (const [itemIndex, title] of quizTitles.entries()) {
        const itemId = `${courseId}-quiz-${itemIndex + 1}`
        const startAt = new Date(Date.UTC(2026, 10, 12 + index + itemIndex * 5, 8)).toISOString()
        const dueAt = new Date(Date.UTC(2026, 10, 14 + index + itemIndex * 5, 16)).toISOString()
        const item = { QuizId: itemId, Name: `${title} ${itemIndex + 1}`, StartDate: startAt, DueDate: dueAt, IsMock: true }
        await client.query(
          `insert into planner_private.reference_quizzes (course_id, item_id, sort_order, name, start_at, due_at, is_mock, source)
           values ($1, $2, $3, $4, $5, $6, true, $7::jsonb)
           on conflict (course_id, item_id) do update set name = excluded.name, start_at = excluded.start_at, due_at = excluded.due_at, source = excluded.source`,
          [courseId, itemId, itemIndex + 1, item.Name, startAt, dueAt, JSON.stringify(item)]
        )
      }

      for (const [itemIndex, [title, body]] of announcements.entries()) {
        const announcementId = `${courseId}-announcement-${itemIndex + 1}`
        const postedAt = new Date(Date.UTC(2026, 9, 26 - itemIndex * 3, 9)).toISOString()
        await client.query(
          `insert into planner_private.reference_announcements (announcement_id, course_id, sort_order, title, body, posted_at, source)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb)
           on conflict (announcement_id) do update set title = excluded.title, body = excluded.body, posted_at = excluded.posted_at, source = excluded.source`,
          [announcementId, courseId, itemIndex + 1, title, body, postedAt, JSON.stringify({ IsMock: true })]
        )
      }
    }

    for (const user of users) {
      for (const code of user.courses) {
        await client.query(
          `insert into planner_private.course_enrollments (user_id, course_id)
           values ($1, $2) on conflict do nothing`,
          [userIds.get(user.email), `mock-${code.toLowerCase()}`]
        )
      }
    }
  })
  console.log(`Seeded ${users.length} demo accounts, ${courseNames.length} courses, assignments, quizzes, and announcements.`)
}

seed().catch(error => {
  console.error('Could not seed the mock eLearn data:', error.message)
  process.exitCode = 1
}).finally(() => database.close())
