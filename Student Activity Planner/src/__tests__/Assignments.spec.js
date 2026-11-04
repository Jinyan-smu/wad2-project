import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import axios from 'axios'
import Assignments from '../components/Assignments.vue'
import { dashboardStorageKey } from '../utils/dashboardPersonalization'

vi.mock('axios', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }))
let wrapper
let data

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-11-05T09:00:00+08:00'))
  localStorage.clear()
  data = {
    courses: [
      { Id: 1, Name: 'WAD' },
      { Id: 2, Name: 'Database Management' },
    ],
    assignments: [
      {
        Id: 'old',
        CourseId: 2,
        CourseName: 'Database Management',
        Name: 'SQL exercise',
        DueDate: '2026-11-04T17:00:00+08:00',
        Done: false,
      },
      {
        Id: 'today',
        CourseId: 1,
        CourseName: 'WAD',
        Name: 'Project checkpoint',
        DueDate: '2026-11-05T17:00:00+08:00',
        Done: false,
      },
      {
        Id: 'week',
        CourseId: 1,
        CourseName: 'WAD',
        Name: 'Presentation outline',
        DueDate: '2026-11-08T17:00:00+08:00',
        Done: false,
        IsCustom: true,
      },
      {
        Id: 'later',
        CourseId: 1,
        CourseName: 'WAD',
        Name: 'Final slides',
        DueDate: '2026-11-20T17:00:00+08:00',
        Done: false,
      },
      {
        Id: 'finished',
        CourseId: 1,
        CourseName: 'WAD',
        Name: 'Proposal',
        DueDate: '2026-11-03T17:00:00+08:00',
        Done: true,
      },
    ],
    quizzes: [
      {
        Id: 'quiz',
        CourseId: 2,
        CourseName: 'Database Management',
        Name: 'Practice quiz',
        StartDate: '2026-11-01T09:00:00+08:00',
        Done: false,
      },
    ],
  }
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.endsWith('/me') ? { user: { id: 'alex' } } : structuredClone(data),
    }),
  )
  axios.patch.mockResolvedValue({ data: { done: true } })
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
})

async function render(path = '/assignments') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(Assignments, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { PlannerNavigation: true, PlannerCompanion: true } },
  })
  await flushPromises()
  return router
}

describe('Assignments task view', () => {
  it('uses Singapore dates for today and seven-day urgency even across UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-11-05T17:00:00Z'))
    data.assignments = [
      { Id: 'same-sg-day', CourseId: 1, Name: 'Tonight deadline', DueDate: '2026-11-06T15:00:00Z' },
      {
        Id: 'seventh-sg-day',
        CourseId: 1,
        Name: 'Seventh day deadline',
        DueDate: '2026-11-13T15:00:00Z',
      },
      { Id: 'eighth-sg-day', CourseId: 1, Name: 'Later deadline', DueDate: '2026-11-13T17:00:00Z' },
    ]
    data.quizzes = []
    await render()
    const rowFor = (title) =>
      wrapper.findAll('.coursework-card').find((row) => row.text().includes(title))
    expect(rowFor('Tonight deadline').get('.task-urgency-badge').text()).toBe('Due today')
    expect(wrapper.get('[data-group="Due today"]').text()).toContain('Tonight deadline')
    expect(rowFor('Seventh day deadline').get('.task-urgency-badge').text()).toBe('Due in 7 days')
    expect(wrapper.get('[data-group="Next 7 days"]').text()).toContain('Seventh day deadline')
    expect(rowFor('Later deadline').find('.task-urgency-badge').exists()).toBe(false)
    expect(wrapper.get('[data-group="Later"]').text()).toContain('Later deadline')
  })

  it('groups real coursework by deadline and keeps start-only quizzes out of Overdue', async () => {
    await render()
    expect(wrapper.get('[data-group="Overdue"]').text()).toContain('SQL exercise')
    expect(wrapper.get('[data-group="Due today"]').text()).toContain('Project checkpoint')
    expect(wrapper.get('[data-group="Next 7 days"]').text()).toContain('Presentation outline')
    expect(wrapper.get('[data-group="Later"]').text()).toContain('Final slides')
    expect(wrapper.get('[data-group="No due date"]').text()).toContain('Practice quiz')
    expect(wrapper.find('.calendar-grid').exists()).toBe(false)
    expect(wrapper.findAll('.coursework-card')).toHaveLength(5)
    expect(wrapper.findAll('.coursework-card').some((row) => row.text().includes('Proposal'))).toBe(
      false,
    )
  })

  it('supports dashboard filters and later route changes without remounting', async () => {
    const router = await render('/assignments?course=1&search=checkpoint')
    expect(wrapper.findAll('.coursework-card')).toHaveLength(1)
    expect(wrapper.get('.coursework-card').text()).toContain('Project checkpoint')
    await router.push('/assignments?course=2&type=quiz')
    await flushPromises()
    expect(wrapper.findAll('.coursework-card')).toHaveLength(1)
    expect(wrapper.get('.coursework-card').text()).toContain('Practice quiz')
  })

  it('opens the exact completed task from a Calendar link and links back by stable key', async () => {
    await render('/assignments?event=assignment:1:finished')
    expect(wrapper.get('.assignment-details h2').text()).toBe('Proposal')
    expect(wrapper.get('.assignment-tabs button[aria-pressed="true"]').text()).toContain(
      'Completed',
    )
    expect(wrapper.get('.details-calendar-link').attributes('href')).toContain(
      'event=assignment:1:finished',
    )
  })

  it('accepts the Calendar course/type/id deep link without relying on a duplicate title', async () => {
    await render('/assignments?course=1&search=ignored&type=assignment&id=week')
    expect(wrapper.get('.assignment-details h2').text()).toBe('Presentation outline')
    expect(wrapper.get('.assignment-search input').element.value).toBe('')
  })

  it('records confirmed completion and can restore the task from Completed', async () => {
    await render('/assignments?event=assignment:1:today')
    await wrapper.get('input[aria-label="Mark Project checkpoint completed"]').setValue(true)
    await flushPromises()
    expect(axios.patch).toHaveBeenCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/today',
      { done: true },
      { withCredentials: true },
    )
    expect(
      JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions[
        'assignment:1:today'
      ].title,
    ).toBe('Project checkpoint')
    await wrapper.get('.assignment-tabs button:nth-child(2)').trigger('click')
    await wrapper.get('button[aria-label="View Project checkpoint"]').trigger('click')
    await wrapper.get('.details-complete').trigger('click')
    await flushPromises()
    expect(axios.patch).toHaveBeenLastCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/today',
      { done: false },
      { withCredentials: true },
    )
    expect(
      JSON.parse(localStorage.getItem(dashboardStorageKey('alex'))).completions[
        'assignment:1:today'
      ],
    ).toBeUndefined()
  })

  it('preserves an incomplete task when completion fails', async () => {
    axios.patch.mockRejectedValue({ response: { data: { message: 'Could not save progress.' } } })
    await render('/assignments?event=assignment:1:today')
    await wrapper.get('input[aria-label="Mark Project checkpoint completed"]').setValue(true)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not save progress.')
    expect(
      wrapper.get('input[aria-label="Mark Project checkpoint completed"]').element.checked,
    ).toBe(false)
    expect(localStorage.getItem(dashboardStorageKey('alex'))).toBeNull()
  })

  it('opens the add form from the Dashboard link and creates a real assignment', async () => {
    axios.post.mockResolvedValue({
      data: {
        assignment: {
          Id: 'new',
          CourseId: 1,
          CourseName: 'WAD',
          Name: 'Demo checklist',
          DueDate: '2026-11-07T09:00:00.000Z',
          IsCustom: true,
        },
      },
    })
    await render('/assignments?new=1')
    await wrapper.get('#assignment-name').setValue('Demo checklist')
    await wrapper.get('#assignment-course').setValue('1')
    await wrapper.get('#assignment-due-date').setValue('2026-11-07T17:00')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/assignments',
      { name: 'Demo checklist', courseId: '1', dueDate: '2026-11-07T09:00:00.000Z' },
      { withCredentials: true },
    )
    expect(wrapper.find('#assignment-name').exists()).toBe(false)
    expect(wrapper.get('.assignment-details h2').text()).toBe('Demo checklist')
  })

  it('only offers editing for personal assignments and uses the existing edit endpoint', async () => {
    axios.patch.mockResolvedValue({
      data: {
        assignment: {
          Id: 'week',
          CourseId: 1,
          CourseName: 'WAD',
          Name: 'Updated outline',
          DueDate: null,
          IsCustom: true,
        },
      },
    })
    await render('/assignments?event=assignment:1:week')
    await wrapper.get('.details-edit').trigger('click')
    expect(wrapper.get('#assignment-course').attributes('disabled')).toBeDefined()
    await wrapper.get('#assignment-name').setValue('Updated outline')
    await wrapper.get('#assignment-due-date').setValue('')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(axios.patch).toHaveBeenCalledWith(
      'http://localhost:8000/api/assignments/1/week',
      { name: 'Updated outline', courseId: '1', dueDate: null },
      { withCredentials: true },
    )
    expect(wrapper.get('.assignment-details h2').text()).toBe('Updated outline')
    await wrapper.get('button[aria-label="View Project checkpoint"]').trigger('click')
    expect(wrapper.find('.details-edit').exists()).toBe(false)
  })

  it('retains form input and a readable message after a failed save', async () => {
    axios.post.mockRejectedValue({ response: { data: { message: 'Please try again.' } } })
    await render('/assignments?new=1')
    await wrapper.get('#assignment-name').setValue('Draft assignment')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#assignment-name').element.value).toBe('Draft assignment')
    expect(wrapper.get('[role="alert"]').text()).toBe('Please try again.')
  })

  it('keeps an edited completed assignment in Completed when the edit response omits its completion state', async () => {
    data.assignments.find((item) => item.Id === 'finished').IsCustom = true
    axios.patch.mockResolvedValue({
      data: {
        assignment: {
          Id: 'finished',
          CourseId: 1,
          CourseName: 'WAD',
          Name: 'Updated proposal',
          DueDate: null,
          IsCustom: true,
        },
      },
    })
    await render('/assignments?event=assignment:1:finished')
    await wrapper.get('.details-edit').trigger('click')
    await wrapper.get('#assignment-name').setValue('Updated proposal')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.assignment-tabs button[aria-pressed="true"]').text()).toContain(
      'Completed',
    )
    expect(wrapper.get('.assignment-details h2').text()).toBe('Updated proposal')
    expect(wrapper.get('.details-complete').text()).toBe('Mark as to do')
  })

  it('shows a recoverable load error and an honest empty state', async () => {
    axios.get.mockImplementation((url) =>
      url.endsWith('/me')
        ? Promise.resolve({ data: { user: { id: 'alex' } } })
        : Promise.reject(new Error('offline')),
    )
    await render()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load your coursework')
    data.assignments = []
    data.quizzes = []
    axios.get.mockResolvedValue({ data })
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.assignment-empty').text()).toContain('No coursework yet')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
