import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import axios from 'axios'
import Dashboard from '../components/Dashboard.vue'
import { dashboardStorageKey } from '../utils/dashboardPersonalization'

vi.mock('axios', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }))

const assignment = (id, name, date, done = false, courseId = 1) => ({
  Id: id,
  Name: name,
  CourseId: courseId,
  CourseName: 'Web Application Development',
  DueDate: date,
  Done: done,
})
const fixtures = () => ({
  assignments: [
    assignment(1, 'Project proposal', '2026-11-04T23:59:00+08:00'),
    assignment(2, 'Completed lab', '2026-11-04T12:00:00+08:00', true),
    assignment(1, 'Another course task', '2026-11-05T17:00:00+08:00', false, 2),
  ],
  quizzes: [
    {
      Id: 3,
      CourseId: 1,
      CourseName: 'Database Management',
      Name: 'SQL quiz',
      EventDate: '2026-11-05T10:00:00+08:00',
      Done: false,
    },
  ],
  activities: [
    {
      id: 'run',
      title: 'Evening run',
      place: 'Fort Canning',
      when: '2026-11-04T18:00:00+08:00',
      end: '2026-11-04T19:00:00+08:00',
      outdoor: true,
    },
    {
      id: 'overnight',
      title: 'Overnight hackathon',
      place: 'Campus',
      when: '2026-11-04T23:00:00+08:00',
      end: '2026-11-05T02:00:00+08:00',
    },
    {
      id: 'meeting',
      title: 'Team sync',
      place: 'Library',
      when: '2026-11-04T16:00:00+08:00',
      end: '2026-11-04T17:00:00+08:00',
      source: 'group-meeting',
    },
  ],
  announcements: [],
})
let wrapper
let data
async function render() {
  wrapper = mount(Dashboard, {
    attachTo: document.body,
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, LogoutButton: true } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-11-04T09:00:00+08:00'))
  vi.clearAllMocks()
  data = fixtures()
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.endsWith('/me') ? { user: { id: 'alex', username: 'Alex' } } : data,
    }),
  )
  axios.patch.mockResolvedValue({ data: { done: true } })
  axios.post.mockResolvedValue({ data: { done: true } })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2026-11-04'],
          weather_code: [3],
          temperature_2m_max: [31],
          precipitation_probability_max: [60],
        },
      }),
    }),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Dashboard', () => {
  it('uses saved completion and synchronizes a saved change across agenda and progress', async () => {
    await render()
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '33',
    )
    expect(
      wrapper.findAll('.agenda-row input').filter((input) => input.element.checked),
    ).toHaveLength(1)
    await wrapper
      .get('.agenda-panel input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    await flushPromises()
    expect(axios.patch).toHaveBeenCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/1',
      { done: true },
      { withCredentials: true },
    )
    expect(
      wrapper.get('.agenda-row input[aria-label="Mark Project proposal as incomplete"]').element
        .checked,
    ).toBe(true)
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '67',
    )
    await wrapper.get('.priority-edit').trigger('click')
    expect(wrapper.find('#priority-choice option[value="assignment:2:1"]').exists()).toBe(true)
  })

  it('selects a day, includes activities spanning midnight, and retains activity filtering', async () => {
    await render()
    await wrapper.get('[data-date="2026-11-05"]').trigger('click')
    expect(wrapper.get('#agenda-heading').text()).toBe('Thursday’s plan')
    expect(wrapper.get('.agenda-panel').text()).toContain('SQL quiz')
    expect(wrapper.get('.agenda-panel').text()).toContain('Overnight hackathon')
    expect(wrapper.get('.agenda-panel').text()).not.toContain('Evening run')
    const activityFilter = wrapper
      .findAll('.agenda-filters button')
      .find((button) => button.text() === 'Activities')
    await activityFilter.trigger('click')
    expect(wrapper.findAll('.agenda-row')).toHaveLength(1)
    expect(wrapper.get('.agenda-row').text()).toContain('Overnight hackathon')
  })

  it('saves activity completion and routes group meetings to their own page', async () => {
    await render()
    await wrapper.get('input[aria-label="Mark Evening run as complete"]').setValue(true)
    await flushPromises()
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/activities/run',
      { done: true },
      { withCredentials: true },
    )
    const meeting = wrapper.findAll('.agenda-row').find((row) => row.text().includes('Team sync'))
    expect(meeting.find('input').exists()).toBe(false)
    expect(meeting.text()).toContain('View meeting')
  })

  it('shows a save failure without falsely marking an assignment complete', async () => {
    axios.patch.mockRejectedValueOnce(new Error('Offline'))
    await render()
    await wrapper
      .get('.agenda-row input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Couldn’t save that change')
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '33',
    )
    expect(
      wrapper.get('.agenda-row input[aria-label="Mark Project proposal as complete"]').element
        .checked,
    ).toBe(false)
  })

  it('paginates upcoming plans and resets pagination when the category changes', async () => {
    data.assignments.push(
      ...Array.from({ length: 8 }, (_, i) =>
        assignment(i + 10, 'Extra task ' + i, '2026-11-06T17:00:00+08:00'),
      ),
    )
    await render()
    await wrapper
      .findAll('.view-switch button')
      .find((button) => button.text() === 'Upcoming')
      .trigger('click')
    expect(wrapper.findAll('.agenda-row')).toHaveLength(6)
    await wrapper.get('[aria-label="Next six timeline items"]').trigger('click')
    expect(wrapper.get('.agenda-panel .pagination-footer').text()).toContain('7–12')
    await wrapper
      .findAll('.agenda-filters button')
      .find((button) => button.text() === 'Quizzes')
      .trigger('click')
    expect(wrapper.findAll('.agenda-row')).toHaveLength(1)
    expect(wrapper.get('.agenda-row').text()).toContain('SQL quiz')
  })

  it('recovers from a loading error and returns to today after navigating weeks', async () => {
    axios.get.mockImplementation((url) =>
      url.endsWith('/me')
        ? Promise.resolve({ data: { user: { id: 'alex', username: 'Alex' } } })
        : Promise.reject(new Error('Offline')),
    )
    await render()
    expect(wrapper.get('[role="alert"]').text()).toContain('We couldn’t load your planner')
    expect(
      wrapper.get('#conflict-heading').element.parentElement.parentElement.textContent,
    ).not.toContain('No clashes')
    axios.get.mockResolvedValue({ data })
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('[aria-label="Next week"]').trigger('click')
    expect(wrapper.find('[data-date="2026-11-11"]').exists()).toBe(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Today')
      .trigger('click')
    expect(wrapper.get('[data-date="2026-11-04"]').attributes('aria-pressed')).toBe('true')
  })
})

describe('Dashboard planning features', () => {
  it('keeps the briefing short and marks deadlines directly on the week selector', async () => {
    await render()
    expect(wrapper.get('[aria-label="Daily briefing"]').text()).toContain('3 deadlines by tomorrow')
    expect(wrapper.get('[aria-label="Daily briefing"]').text()).toContain('1 meeting today')
    expect(wrapper.get('[data-date="2026-11-05"]').attributes('aria-label')).toContain(
      '2 coursework deadlines',
    )
    expect(wrapper.get('[data-date="2026-11-05"]').findAll('.day-dot')).toHaveLength(2)
    expect(wrapper.find('.workload-caption').exists()).toBe(false)
  })

  it('pins a chosen task, remembers it after reload, and clears a completed priority', async () => {
    await render()
    await wrapper.get('.priority-edit').trigger('click')
    await wrapper.get('#priority-choice').setValue('assignment:2:1')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Pin priority')
      .trigger('click')
    expect(wrapper.get('.priority-list').text()).toContain('Another course task')
    wrapper.unmount()
    await render()
    expect(wrapper.get('.priority-list').text()).toContain('Another course task')
    await wrapper
      .get('.priority-list input[aria-label="Mark Another course task as complete"]')
      .setValue(true)
    await flushPromises()
    expect(wrapper.find('.priority-list').exists()).toBe(false)
    expect(wrapper.get('.weekly-wins').text()).toContain('1')
  })

  it('restores saved filters, notices, and a manual weather display choice', async () => {
    await render()
    await wrapper
      .findAll('.agenda-filters button')
      .find((button) => button.text() === 'Quizzes')
      .trigger('click')
    await wrapper
      .findAll('.view-switch button')
      .find((button) => button.text() === 'Upcoming')
      .trigger('click')
    await wrapper.get('[aria-controls="dashboard-course-announcements"]').trigger('click')
    await wrapper.get('[aria-controls="dashboard-weather-details"]').trigger('click')
    wrapper.unmount()
    await render()
    expect(wrapper.get('#agenda-heading').text()).toBe('Coming up next')
    expect(wrapper.findAll('.agenda-row')).toHaveLength(1)
    expect(wrapper.find('#dashboard-course-announcements').exists()).toBe(true)
    expect(
      wrapper.get('[aria-controls="dashboard-weather-details"]').attributes('aria-expanded'),
    ).toBe('true')
  })

  it('keeps forecast details compact and shows storm warnings even with little rain', async () => {
    data.activities = []
    await render()
    expect(
      wrapper.get('[aria-controls="dashboard-weather-details"]').attributes('aria-expanded'),
    ).toBe('false')
    wrapper.unmount()
    data = fixtures()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2026-11-04'],
          weather_code: [95],
          temperature_2m_max: [30],
          precipitation_probability_max: [5],
        },
      }),
    })
    await render()
    expect(
      wrapper.get('[aria-controls="dashboard-weather-details"]').attributes('aria-expanded'),
    ).toBe('false')
    expect(wrapper.get('.weather-warning').text()).toContain('indoor backup for Evening run')
    expect(wrapper.get('#dashboard-weather-details').isVisible()).toBe(false)
  })

  it('provides direct activity, coursework, and meeting actions for conflicts', async () => {
    data.activities[0].when = '2026-11-04T23:00:00+08:00'
    data.activities[0].end = '2026-11-05T00:30:00+08:00'
    data.activities[2].groupId = 'team-1'
    data.activities[2].meetingId = 'meeting-1'
    data.activities[2].when = data.activities[0].when
    data.activities[2].end = data.activities[0].end
    await render()
    const actions = wrapper.findAll('.conflict-action').map((link) => link.attributes('to'))
    // RouterLink is a stub here, so its destination is retained as a component attribute.
    expect(actions).toContain('/activities?edit=run')
    expect(actions).toContain('/groupwork?group=team-1&meeting=meeting-1#gm-meetings-title')
    expect(actions.some((to) => to?.startsWith('/assignments?course=1&search='))).toBe(true)
  })

  it('does not invent historical completion times for already-completed server data', async () => {
    await render()
    const saved = JSON.parse(localStorage.getItem(dashboardStorageKey('alex')) || '{}')
    expect(saved.completions || {}).toEqual({})
    expect(wrapper.get('.weekly-wins').text()).toContain('History starts')
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '33',
    )
  })
})

describe('Streamlined dashboard structure', () => {
  it('opens the overview for an account that previously had Focus selected', async () => {
    const oldSession = { id: 'old-session', goal: 'Draft an introduction', notes: 'Existing notes' }
    localStorage.setItem(
      dashboardStorageKey('alex'),
      JSON.stringify({
        preferences: { dashboardTab: 'focus' },
        priorities: ['assignment:1:1'],
        prioritySteps: { 'assignment:1:1': 'Write the research question' },
        timer: { ...oldSession, status: 'running', endsAt: Date.now() + 60_000 },
        sessions: [oldSession],
      }),
    )
    await render()
    expect(wrapper.get('h1').text()).toBe('Your week, a little clearer.')
    expect(wrapper.get('.agenda-panel').isVisible()).toBe(true)
    expect(wrapper.find('#focus-tab').exists()).toBe(false)
    expect(wrapper.find('[role="timer"]').exists()).toBe(false)
    expect(wrapper.get('.priority-list').text()).toContain('Project proposal')
    expect(wrapper.get('.priority-list').text()).not.toContain('Write the research question')
    expect(wrapper.get('.weekly-wins').text()).not.toContain('focus')
    await wrapper
      .get('.priority-list input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    await flushPromises()
    expect(axios.patch).toHaveBeenCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/1',
      { done: true },
      { withCredentials: true },
    )
    vi.advanceTimersByTime(120_000)
    expect(wrapper.find('[role="timer"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).sessions).toEqual([
      oldSession,
    ])
  })

  it('shows the agenda first and keeps secondary tools closed until requested', async () => {
    await render()
    expect(wrapper.findAll('.summary-stat')).toHaveLength(0)
    expect(wrapper.findAll('.assignment-row')).toHaveLength(0)
    expect(wrapper.find('.radar-panel').exists()).toBe(false)
    expect(wrapper.find('#priority-choice').exists()).toBe(false)
    expect(wrapper.find('#focus-task').exists()).toBe(false)
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('#focus-panel').exists()).toBe(false)
    expect(wrapper.find('[role=tablist]').exists()).toBe(false)
    expect(wrapper.find('.focus-trigger').exists()).toBe(false)
    expect(wrapper.get('#dashboard-progress-details').isVisible()).toBe(false)
    expect(wrapper.get('#dashboard-conflict-details').isVisible()).toBe(false)
    expect(wrapper.find('#dashboard-course-announcements').exists()).toBe(false)
    const main = wrapper.html()
    expect(main.indexOf('agenda-panel')).toBeLessThan(main.indexOf('priorities-panel'))
    await wrapper.get('#progress-toggle').trigger('click')
    expect(wrapper.get('#dashboard-progress-details').isVisible()).toBe(true)
    wrapper.unmount()
    await render()
    expect(wrapper.get('#progress-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('keeps urgent overlaps visible and opens their actions on demand', async () => {
    data.activities[0].when = '2026-11-04T23:00:00+08:00'
    data.activities[0].end = '2026-11-05T00:30:00+08:00'
    await render()
    expect(wrapper.get('.conflict-nudge').isVisible()).toBe(true)
    expect(wrapper.get('#dashboard-conflict-details').isVisible()).toBe(false)
    await wrapper.get('.conflict-nudge button').trigger('click')
    expect(wrapper.get('#conflict-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('#dashboard-conflict-details').isVisible()).toBe(true)
    expect(wrapper.get('.conflict-action').isVisible()).toBe(true)
  })
})
