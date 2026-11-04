import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import axios from 'axios'
import Activities from '../components/Activities.vue'
import Assignments from '../components/Assignments.vue'
import GroupWork from '../components/GroupWork.vue'
import { dashboardStorageKey } from '../utils/dashboardPersonalization'

vi.mock('axios', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }))
let wrapper
const originalScrollIntoView = Element.prototype.scrollIntoView
async function render(component, path) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: { PlannerNavigation: true, GoogleActivityMap: true },
    },
  })
  await flushPromises()
  return router
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  axios.patch.mockResolvedValue({ data: { done: true } })
})
afterEach(() => {
  wrapper?.unmount()
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.unstubAllGlobals()
})

describe('Dashboard action destinations', () => {
  it('opens the exact activity editor after loading and handles another edit link without remounting', async () => {
    axios.get.mockResolvedValue({
      data: [
        {
          id: 'first',
          title: 'Evening run',
          when: '2026-11-04T18:00:00+08:00',
          end: '2026-11-04T19:00:00+08:00',
          outdoor: false,
          place: 'Campus',
        },
        {
          id: 'second',
          title: 'Study session',
          when: '2026-11-05T18:00:00+08:00',
          end: '2026-11-05T19:00:00+08:00',
          outdoor: false,
          place: 'Library',
        },
      ],
    })
    const router = await render(Activities, '/activities?edit=first')
    expect(wrapper.get('#activity-title').element.value).toBe('Evening run')
    await router.push('/activities?edit=second')
    await flushPromises()
    expect(wrapper.get('#activity-title').element.value).toBe('Study session')
  })

  it('opens filtered coursework and records a successful completion in dashboard history', async () => {
    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.endsWith('/me')
          ? { user: { id: 'alex' } }
          : {
              courses: [
                { Id: 1, Name: 'WAD2' },
                { Id: 2, Name: 'Database Management' },
              ],
              assignments: [
                {
                  Id: 1,
                  CourseId: 1,
                  CourseName: 'WAD2',
                  Type: 'assignment',
                  Name: 'Project proposal',
                  DueDate: '2026-11-05T23:00:00+08:00',
                  Done: false,
                },
                {
                  Id: 2,
                  CourseId: 2,
                  CourseName: 'Database Management',
                  Type: 'assignment',
                  Name: 'Other task',
                  DueDate: '2026-11-06T23:00:00+08:00',
                  Done: false,
                },
              ],
              quizzes: [],
            },
      }),
    )
    await render(Assignments, '/assignments?course=1&search=Project%20proposal')
    expect(wrapper.findAll('.coursework-card')).toHaveLength(1)
    expect(wrapper.get('.coursework-card').text()).toContain('Project proposal')
    await wrapper.get('input[aria-label="Mark Project proposal completed"]').setValue(true)
    await flushPromises()
    const saved = JSON.parse(localStorage.getItem(dashboardStorageKey('alex')))
    expect(saved.completions['assignment:1:1'].title).toBe('Project proposal')
    expect(axios.patch).toHaveBeenCalledWith(
      'http://localhost:8000/api/coursework/assignment/1/1',
      { done: true },
      { withCredentials: true },
    )
  })

  it('selects and reveals the requested meeting while allowing later manual group selection', async () => {
    const state = {
      defaults: {
        fromDate: '2026-11-04',
        toDate: '2026-11-10',
        startTime: '09:00',
        endTime: '18:00',
        durationMinutes: 60,
      },
      groups: [
        {
          id: 'first-group',
          name: 'First group',
          members: [{ id: 'alex', name: 'Alex', scheduleStatus: 'complete' }],
        },
        {
          id: 'second-group',
          name: 'Second group',
          members: [{ id: 'alex', name: 'Alex', scheduleStatus: 'complete' }],
        },
      ],
      meetings: [
        {
          id: 'target',
          groupId: 'second-group',
          title: 'Project meeting',
          startAt: '2026-11-04T16:00:00+08:00',
          endAt: '2026-11-04T17:00:00+08:00',
          participantIds: ['alex'],
        },
      ],
      incomingInvitations: [],
      sentInvitations: [],
    }
    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.endsWith('/group-meetings')
          ? state
          : { activities: [], assignments: [], quizzes: [] },
      }),
    )
    await render(GroupWork, '/groupwork?group=second-group&meeting=target')
    expect(wrapper.get('#gm-group').element.value).toBe('second-group')
    expect(wrapper.get('#meeting-target').classes()).toContain('gm-requested-meeting')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    await wrapper.get('#gm-group').setValue('first-group')
    expect(wrapper.find('#meeting-target').exists()).toBe(false)
  })
})
