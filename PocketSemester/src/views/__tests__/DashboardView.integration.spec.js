import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import axios from 'axios'
import Dashboard from '@/views/DashboardView.vue'
import { dashboardStorageKey } from '@/composables/useDashboardPersonalization'

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
let weatherData
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
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  })
  vi.setSystemTime(new Date('2026-11-04T09:00:00+08:00'))
  vi.clearAllMocks()
  data = fixtures()
  weatherData = {
    daily: {
      time: ['2026-11-04'],
      weather_code: [3],
      temperature_2m_max: [31],
      precipitation_probability_max: [60],
    },
  }
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.startsWith('https://api.open-meteo.com/')
        ? weatherData
        : url.endsWith('/me')
          ? { user: { id: 'alex', username: 'Alex' } }
          : data,
    }),
  )
  axios.patch.mockResolvedValue({ data: { done: true } })
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
    expect(wrapper.get('.weekly-coursework-panel').text()).toContain('Another course task')
    expect(wrapper.get('.weekly-coursework-panel').text()).not.toContain('Project proposal')
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

  it('shows saved activity completion as a status and routes group meetings to their own page', async () => {
    data.activities[0].done = true
    await render()
    const activity = wrapper.findAll('.agenda-row').find((row) => row.text().includes('Evening run'))
    expect(activity.text()).toContain('Completed')
    expect(activity.find('input[type="checkbox"]').exists()).toBe(false)
    const meeting = wrapper.findAll('.agenda-row').find((row) => row.text().includes('Team sync'))
    expect(meeting.find('input').exists()).toBe(false)
    expect(meeting.text()).toContain('View meeting')
  })

  it('completes an activity when its end time arrives while the dashboard is open', async () => {
    Object.assign(data.activities[0], {
      title: 'Morning study',
      when: '2026-11-04T08:00:00+08:00',
      end: '2026-11-04T09:00:02+08:00',
    })
    await render()
    const activityRow = () =>
      wrapper.findAll('.agenda-row').find((row) => row.text().includes('Morning study'))

    await vi.advanceTimersByTimeAsync(1000)
    expect(activityRow().text()).not.toContain('Completed automatically')
    expect(activityRow().find('input[type="checkbox"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(activityRow().text()).toContain('Completed automatically')
    expect(activityRow().find('input[type="checkbox"]').exists()).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
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

  it('shows coursework for the selected week regardless of the selected day or agenda filter', async () => {
    data.assignments.push(assignment(99, 'Next week report', '2026-11-10T17:00:00+08:00'))
    data.quizzes.push({
      Id: 4,
      CourseId: 1,
      CourseName: 'Database Management',
      Name: 'Next week quiz',
      EventDate: '2026-11-11T10:00:00+08:00',
      Done: false,
    })
    await render()
    const weekly = () => wrapper.get('.weekly-coursework-panel')
    expect(weekly().text()).toContain('Project proposal')
    expect(weekly().text()).toContain('Another course task')
    expect(weekly().text()).toContain('SQL quiz')
    expect(weekly().text()).not.toContain('Completed lab')
    expect(weekly().text()).not.toContain('Next week report')
    await wrapper.get('[data-date="2026-11-06"]').trigger('click')
    await wrapper
      .findAll('.agenda-filters button')
      .find((button) => button.text() === 'Activities')
      .trigger('click')
    expect(weekly().text()).toContain('Project proposal')
    expect(weekly().text()).toContain('SQL quiz')
    await wrapper.get('[aria-label="Next week"]').trigger('click')
    expect(weekly().text()).toContain('Next week report')
    expect(weekly().text()).toContain('Next week quiz')
    expect(weekly().text()).not.toContain('Project proposal')
    expect(weekly().text()).not.toContain('SQL quiz')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Today')
      .trigger('click')
    expect(weekly().text()).toContain('Project proposal')
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
    weatherData = {
      daily: {
        time: ['2026-11-04'],
        weather_code: [95],
        temperature_2m_max: [30],
        precipitation_probability_max: [5],
      },
    }
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
    expect(wrapper.get('.weekly-coursework-panel').text()).toContain('Project proposal')
    expect(wrapper.get('.weekly-coursework-panel').text()).toContain('Another course task')
    expect(wrapper.get('.weekly-coursework-panel').text()).toContain('SQL quiz')
    expect(wrapper.get('.weekly-coursework-panel').text()).not.toContain(
      'Write the research question',
    )
    expect(wrapper.get('.weekly-wins').text()).not.toContain('focus')
    await wrapper
      .get('.weekly-coursework-panel input[aria-label="Mark Project proposal as complete"]')
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
    expect(wrapper.find('.priorities-panel').exists()).toBe(false)
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
    expect(main.indexOf('agenda-panel')).toBeLessThan(main.indexOf('weekly-coursework-panel'))
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

describe('Dashboard interaction feedback', () => {
  it('celebrates only a successful save and undoes completion and its recorded history', async () => {
    let resolveSave
    axios.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    await render()
    expect(wrapper.get('.planner-companion').text()).toContain('1 coursework item left today')
    await wrapper
      .get('.agenda-panel input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    expect(wrapper.find('.completion-feedback').exists()).toBe(false)
    expect(wrapper.find('.just-completed').exists()).toBe(false)
    expect(wrapper.get('.planner-companion .login-characters').attributes('data-mood')).toBe('idle')
    resolveSave({ data: { done: true } })
    await flushPromises()
    expect(wrapper.get('.completion-feedback').text()).toContain('Project proposal completed.')
    expect(wrapper.get('.just-completed').text()).toContain('Project proposal')
    expect(wrapper.get('.planner-companion').text()).toContain('One less thing on your mind')
    expect(wrapper.get('.planner-companion .login-characters').attributes('data-mood')).toBe(
      'success',
    )
    expect(
      JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions['assignment:1:1'],
    ).toBeTruthy()
    wrapper.get('.completion-undo').element.focus()
    await wrapper.get('.completion-undo').trigger('click')
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/1',
      { done: false },
      { withCredentials: true },
    )
    expect(wrapper.find('.completion-feedback').exists()).toBe(false)
    expect(
      wrapper.get('.agenda-panel input[aria-label="Mark Project proposal as complete"]').element
        .checked,
    ).toBe(false)
    expect(document.activeElement).toBe(
      wrapper.get('.agenda-panel input[aria-label="Mark Project proposal as complete"]').element,
    )
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '33',
    )
    expect(JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions).toEqual({})
    expect(wrapper.get('.planner-companion').text()).toContain('1 coursework item left today')
  })

  it('does not celebrate a failed save and keeps a failed undo available for retry', async () => {
    axios.patch.mockRejectedValueOnce(new Error('Offline'))
    await render()
    const proposal = () =>
      wrapper.get('.agenda-panel input[aria-label="Mark Project proposal as complete"]')
    await proposal().setValue(true)
    await flushPromises()
    expect(wrapper.find('.completion-feedback').exists()).toBe(false)
    expect(wrapper.find('.just-completed').exists()).toBe(false)
    expect(wrapper.get('.planner-companion').text()).not.toContain('One less thing')
    await proposal().setValue(true)
    await flushPromises()
    axios.patch.mockRejectedValueOnce(new Error('Offline'))
    await wrapper.get('.completion-undo').trigger('click')
    await flushPromises()
    expect(wrapper.get('.completion-feedback').text()).toContain('Couldn’t undo')
    expect(
      wrapper.get('.agenda-panel input[aria-label="Mark Project proposal as incomplete"]').element
        .checked,
    ).toBe(true)
    await wrapper.get('.completion-undo').trigger('click')
    await flushPromises()
    expect(wrapper.find('.completion-feedback').exists()).toBe(false)
    expect(proposal().element.checked).toBe(false)
  })

  it('saves completion from weekly coursework and restores its list and history on Undo', async () => {
    await render()
    const task = () =>
      wrapper.find('.weekly-coursework-panel input[aria-label="Mark Project proposal as complete"]')
    expect(task().exists()).toBe(true)
    await task().setValue(true)
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/1',
      { done: true },
      { withCredentials: true },
    )
    expect(task().exists()).toBe(false)
    expect(
      wrapper.get('.agenda-panel input[aria-label="Mark Project proposal as incomplete"]').element
        .checked,
    ).toBe(true)
    expect(
      JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions['assignment:1:1'],
    ).toBeTruthy()
    await wrapper.get('.completion-undo').trigger('click')
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/1',
      { done: false },
      { withCredentials: true },
    )
    expect(task().exists()).toBe(true)
    expect(task().element.checked).toBe(false)
    expect(JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions).toEqual({})
  })

  it('keeps keyboard focus available when completed weekly coursework leaves the list', async () => {
    await render()
    const checkbox = wrapper.get(
      '.weekly-coursework-panel input[aria-label="Mark Project proposal as complete"]',
    )
    checkbox.element.focus()
    await checkbox.setValue(true)
    await flushPromises()
    expect(
      wrapper
        .find('.weekly-coursework-panel input[aria-label="Mark Project proposal as complete"]')
        .exists(),
    ).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.completion-undo').element)
  })

  it('saves and undoes an upcoming quiz from the weekly card when it is outside the selected day', async () => {
    await render()
    expect(wrapper.get('#agenda-heading').text()).toBe('Today’s plan')
    expect(wrapper.get('.agenda-panel').text()).not.toContain('SQL quiz')
    await wrapper
      .get('.weekly-coursework-panel input[aria-label="Mark SQL quiz as complete"]')
      .setValue(true)
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/quiz/1/3',
      { done: true },
      { withCredentials: true },
    )
    expect(wrapper.get('.weekly-coursework-panel').text()).not.toContain('SQL quiz')
    await wrapper.get('.completion-undo').trigger('click')
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/quiz/1/3',
      { done: false },
      { withCredentials: true },
    )
    expect(wrapper.get('.weekly-coursework-panel').text()).toContain('SQL quiz')
    expect(JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions).toEqual({})
  })

  it('keeps the newest coursework completion when an earlier undo finishes', async () => {
    await render()
    await wrapper
      .get('.agenda-panel input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    await flushPromises()
    let resolveUndo
    axios.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUndo = resolve
        }),
    )
    await wrapper.get('.completion-undo').trigger('click')
    const quiz = () => wrapper.find('.weekly-coursework-panel input[aria-label="Mark SQL quiz as complete"]')
    await quiz().setValue(true)
    await flushPromises()
    expect(wrapper.get('.completion-feedback').text()).toContain('SQL quiz completed.')
    resolveUndo({ data: { done: false } })
    await flushPromises()
    expect(wrapper.get('.completion-feedback').text()).toContain('SQL quiz completed.')
    expect(
      wrapper.get('.agenda-panel input[aria-label="Mark Project proposal as complete"]').element
        .checked,
    ).toBe(false)
    await wrapper.get('.completion-undo').trigger('click')
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/quiz/1/3',
      { done: false },
      { withCredentials: true },
    )
    expect(quiz().element.checked).toBe(false)
    expect(wrapper.find('.completion-feedback').exists()).toBe(false)
  })

  it('retains Undo during keyboard use and dismisses it after inactivity', async () => {
    await render()
    await wrapper
      .get('.agenda-panel input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    await flushPromises()
    wrapper.get('.completion-undo').element.focus()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(wrapper.find('.completion-feedback').exists()).toBe(true)
    wrapper.get('.completion-undo').element.blur()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(wrapper.find('.completion-feedback').exists()).toBe(false)
    expect(wrapper.get('.planner-companion').text()).toContain('2 deadlines tomorrow')
  })

  it('uses real tomorrow deadlines and avoids claiming a clear day when loading fails', async () => {
    data.assignments[0].Done = true
    await render()
    expect(wrapper.get('.planner-companion').text()).toContain('2 deadlines tomorrow')
    wrapper.unmount()
    axios.get.mockImplementation((url) =>
      url.endsWith('/me')
        ? Promise.resolve({ data: { user: { id: 'alex', username: 'Alex' } } })
        : Promise.reject(new Error('Offline')),
    )
    await render()
    expect(wrapper.get('.planner-companion').text()).toContain('Try loading it again')
    expect(wrapper.get('.planner-companion .login-characters').attributes('data-mood')).toBe('idle')
  })

  it('recognizes a finished day and prioritizes overdue assignments over all-clear messaging', async () => {
    data.assignments.forEach((item) => {
      item.Done = true
    })
    data.quizzes.forEach((item) => {
      item.Done = true
    })
    await render()
    expect(wrapper.get('.planner-companion').text()).toContain('Today’s coursework is done')
    wrapper.unmount()
    data.assignments[2].Done = false
    data.assignments[2].DueDate = '2026-11-03T12:00:00+08:00'
    await render()
    expect(wrapper.get('.planner-companion').text()).toContain('1 assignment needs catching up')
    expect(wrapper.get('.planner-companion .login-characters').attributes('data-mood')).toBe('idle')
  })
})
