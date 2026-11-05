import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import axios from 'axios'
import Calendar from '@/views/CalendarView.vue'

vi.mock('axios', () => ({ default: { get: vi.fn() } }))
let wrapper
const fixture = () => ({
  assignments: [
    {
      Id: 1,
      CourseId: 1,
      CourseName: 'WAD',
      Name: 'Project checkpoint',
      DueDate: '2026-11-05T17:00:00+08:00',
    },
  ],
  quizzes: [
    {
      Id: 2,
      CourseId: 2,
      CourseName: 'Database',
      Name: 'SQL quiz',
      StartDate: '2026-11-06T10:00:00+08:00',
    },
  ],
  activities: [
    {
      id: 'walk',
      title: 'Evening walk',
      when: '2026-11-05T18:00:00+08:00',
      end: '2026-11-05T19:00:00+08:00',
      place: 'Park',
    },
    {
      id: 'activity-m1',
      source: 'group-meeting',
      meetingId: 'm1',
      groupId: 'g1',
      title: 'Team sync',
      when: '2026-11-05T15:00:00+08:00',
      end: '2026-11-05T16:00:00+08:00',
    },
  ],
})
async function render(path = '/calendar') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  wrapper = mount(Calendar, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { PlannerNavigation: true, PlannerCompanion: true } },
  })
  await flushPromises()
  return router
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T04:00:00Z'))
  axios.get.mockResolvedValue({ data: fixture() })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function button(name) {
  return wrapper.findAll('button').find((el) => el.text() === name)
}

describe('Overall Calendar', () => {
  it('loads the viewer planner once and explains the absent timetable without hiding other events', async () => {
    await render()
    expect(axios.get).toHaveBeenCalledWith('http://localhost:8000/api/planner-data', {
      withCredentials: true,
    })
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('No class timetable connected')
    expect(wrapper.text()).toContain('Project checkpoint')
    expect(wrapper.text()).toContain('Evening walk')
    expect(wrapper.text()).toContain('Team sync')
  })

  it('selects a source-linked deadline by URL and changes selection when the URL changes', async () => {
    const router = await render('/calendar?event=assignment:1:1')
    expect(wrapper.get('#calendar-selected-title').text()).toBe('Project checkpoint')
    expect(wrapper.get('.calendar-source-link').attributes('href')).toContain(
      '/assignments?course=1',
    )
    await router.push('/calendar?event=meeting:m1')
    await flushPromises()
    expect(wrapper.get('#calendar-selected-title').text()).toBe('Team sync')
    expect(wrapper.get('.calendar-source-link').attributes('href')).toBe(
      '/groupwork?group=g1&meeting=m1#meeting-m1',
    )
  })

  it('marks a selected activity complete when it ends while the calendar is open', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-11-05T18:59:59+08:00'))
    await render('/calendar?event=activity:walk')

    const details = wrapper.get('.calendar-details')
    expect(details.text()).toContain('Evening walk')
    expect(details.text()).not.toContain('Completed')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(details.text()).toContain('Completed')
    const activity = wrapper.get('button[aria-label^="Evening walk,"]')
    const meeting = wrapper.get('button[aria-label^="Team sync,"]')
    expect(activity.attributes('aria-label')).toContain('completed')
    expect(meeting.attributes('aria-label')).not.toContain('completed')
    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  it('filters event categories and handles all types turned off', async () => {
    await render()
    await button('Deadlines').trigger('click')
    expect(
      wrapper
        .findAll('.calendar-month-events button')
        .some((el) => el.text().includes('checkpoint')),
    ).toBe(false)
    expect(wrapper.text()).toContain('Evening walk')
    for (const label of ['Classes', 'Activities', 'Meetings']) await button(label).trigger('click')
    expect(wrapper.text()).toContain('Choose an event type above')
    expect(wrapper.findAll('.calendar-month-events button')).toHaveLength(0)
  })

  it('changes month and week periods and keeps deadlines outside the timed grid', async () => {
    await render()
    await wrapper.get('button[aria-label="Next month"]').trigger('click')
    expect(wrapper.get('.calendar-period h2').text()).toContain('December 2026')
    await button('Today').trigger('click')
    await button('Week').trigger('click')
    expect(wrapper.find('.calendar-deadline-row').exists()).toBe(true)
    expect(wrapper.findAll('.calendar-block').some((el) => el.text().includes('checkpoint'))).toBe(
      false,
    )
    await button('Day').trigger('click')
    expect(wrapper.get('.calendar-period h2').text()).toContain('5 November 2026')
  })

  it('does not show an empty calendar as if a failed request succeeded and allows retry', async () => {
    axios.get.mockRejectedValueOnce(new Error('Offline'))
    await render()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load your calendar')
    expect(wrapper.find('.calendar-board').exists()).toBe(false)
    await button('Try again').trigger('click')
    await flushPromises()
    expect(wrapper.find('.calendar-board').exists()).toBe(true)
  })

  it('shows a genuine empty result and uses a day view on narrow screens', async () => {
    axios.get.mockResolvedValue({ data: { assignments: [], quizzes: [], activities: [] } })
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true })
    await render()
    expect(button('Day').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('No events in this day')
    expect(wrapper.findAll('.calendar-block')).toHaveLength(0)
  })

  it('keeps the current day when selecting an overnight continuation segment', async () => {
    const data = fixture()
    data.activities.push({
      id: 'overnight',
      title: 'Overnight hackathon',
      when: '2026-11-05T23:00:00+08:00',
      end: '2026-11-06T01:00:00+08:00',
    })
    axios.get.mockResolvedValue({ data })
    await render('/calendar?date=2026-11-06')
    await button('Day').trigger('click')
    const continuation = wrapper
      .findAll('.calendar-block')
      .find((el) => el.text().includes('Overnight hackathon'))
    expect(continuation.text()).toContain('Continues from previous day')
    await continuation.trigger('click')
    expect(wrapper.get('.calendar-period h2').text()).toContain('6 November 2026')
    expect(wrapper.get('#calendar-selected-title').text()).toBe('Overnight hackathon')
    expect(
      wrapper.findAll('.calendar-block').some((el) => el.text().includes('Overnight hackathon')),
    ).toBe(true)
  })
})
