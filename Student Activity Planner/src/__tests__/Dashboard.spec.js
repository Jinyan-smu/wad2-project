import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import axios from 'axios'
import Dashboard from '../components/Dashboard.vue'

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
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, LogoutButton: true } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-11-04T09:00:00+08:00'))
  vi.clearAllMocks()
  data = fixtures()
  axios.get.mockImplementation((url) =>
    Promise.resolve({ data: url.endsWith('/me') ? { user: { username: 'Alex' } } : data }),
  )
  axios.patch.mockResolvedValue({ data: { done: true } })
  axios.post.mockResolvedValue({ data: { done: true } })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
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
  it('uses saved completion and synchronizes a saved change across agenda, assignments, and progress', async () => {
    await render()
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '33',
    )
    expect(
      wrapper.findAll('.assignment-row input').filter((input) => input.element.checked),
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
      wrapper.get('.assignment-row input[aria-label="Mark Project proposal as incomplete"]').element
        .checked,
    ).toBe(true)
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '67',
    )
    expect(
      wrapper.get('.assignment-row input[aria-label="Mark Another course task as complete"]')
        .element.checked,
    ).toBe(false)
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
      .get('.assignment-row input[aria-label="Mark Project proposal as complete"]')
      .setValue(true)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Couldn’t save that change')
    expect(wrapper.get('[aria-label="Assignments completed"]').attributes('aria-valuenow')).toBe(
      '33',
    )
    expect(
      wrapper.get('.assignment-row input[aria-label="Mark Project proposal as complete"]').element
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
        ? Promise.resolve({ data: { user: { username: 'Alex' } } })
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
