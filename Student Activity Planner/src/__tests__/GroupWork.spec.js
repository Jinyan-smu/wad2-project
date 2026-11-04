import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import axios from 'axios'
import GroupWork from '../components/GroupWork.vue'

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
const mutationPost = vi.fn()

let wrapper
let state
const originalScrollIntoView = Element.prototype.scrollIntoView
const group = (id = 'project', joinCode = 'ABCD2345') => ({
  id,
  name: `${id} team`,
  joinCode,
  isOwner: false,
  members: [{ id: 'teammate', name: 'Teammate', scheduleStatus: 'complete' }],
})

beforeEach(() => {
  vi.resetAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  state = {
    defaults: {
      fromDate: '2026-11-04',
      toDate: '2026-11-05',
      startTime: '09:00',
      endTime: '18:00',
      durationMinutes: 60,
    },
    groups: [],
    meetings: [],
    incomingInvitations: [],
    sentInvitations: [],
  }
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.endsWith('/group-meetings')
        ? structuredClone(state)
        : { activities: [], assignments: [], quizzes: [] },
    }),
  )
  axios.post.mockImplementation((url, body, config) => {
    if (!url.endsWith('/common-time')) return mutationPost(url, body, config)
    const date = body.fromDate
    const startAt = `${date}T10:00:00+08:00`
    const endAt = new Date(Date.parse(startAt) + body.durationMinutes * 60000).toISOString()
    return Promise.resolve({
      data: {
        status: 'ok',
        groupId: body.groupId,
        window: { ...body, stepMinutes: 15 },
        days: [
          { date, freeMinutes: 60, blocks: [{ startAt, endAt, slots: [{ startAt, endAt }] }] },
        ],
        availability: {
          stepMinutes: 15,
          days: [
            {
              date,
              cells: [
                {
                  startAt,
                  endAt: `${date}T10:15:00+08:00`,
                  freeCount: 1,
                  totalCount: 1,
                  canBook: true,
                  busyMemberIds: [],
                },
              ],
            },
          ],
        },
        sources: {
          activities: 2,
          assignments: 1,
          quizzes: 0,
          meetings: 0,
          assignmentBufferMinutes: body.assignmentBufferMinutes,
        },
        totalSlots: 1,
        truncated: false,
        blockers: [],
        best: { date, startAt, endAt },
      },
    })
  })
})
afterEach(() => {
  wrapper?.unmount()
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.unstubAllGlobals()
})

async function render(path = '/groupwork') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/groupwork', component: { template: '<div />' } },
      { path: '/dashboard', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(GroupWork, { global: { plugins: [router], stubs: { PlannerNavigation: true } } })
  await flushPromises()
  return router
}
async function submitCode(code) {
  await wrapper.get('#gm-join-code').setValue(code)
  await wrapper
    .get('#gm-join-code')
    .element.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
}

describe('joining groups with a code', () => {
  it('lets an account with no groups join, then displays the joined group and its code', async () => {
    mutationPost.mockImplementation(async () => {
      state.groups.push(group())
      return { data: { group: state.groups[0] } }
    })
    await render()
    expect(wrapper.text()).toContain('Start a group')
    await submitCode(' abcd2345 ')
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/group-meetings\/groups\/join$/),
      { code: 'ABCD2345' },
      { withCredentials: true },
    )
    expect(wrapper.get('#gm-group').element.value).toBe('project')
    expect(wrapper.get('.gm-group-code').text()).toBe('ABCD2345')
    expect(wrapper.text()).toContain('You joined project team.')
    expect(wrapper.find('#gm-join-code').exists()).toBe(false)
  })

  it('selects a newly joined group when the account already belongs to another', async () => {
    state.groups.push(group('first'))
    mutationPost.mockImplementation(async () => {
      state.groups.push(group('second', 'EFGH6789'))
      return { data: { group: state.groups[1] } }
    })
    await render()
    await submitCode('EFGH6789')
    expect(wrapper.get('#gm-group').element.value).toBe('second')
    expect(wrapper.get('.gm-group-code').text()).toBe('EFGH6789')
    expect(wrapper.get('#gm-invite-group').element.value).toBe('second')
  })

  it('rejects malformed input before sending a request', async () => {
    await render()
    await submitCode('bad')
    expect(mutationPost).not.toHaveBeenCalled()
    expect(wrapper.get('#gm-join-error').text()).toContain('8-character group code')
    expect(wrapper.get('#gm-join-code').attributes('aria-invalid')).toBe('true')
  })

  it.each([
    'No group matches that code. Check it with your teammate.',
    'You already belong to this group.',
    'A group can hold at most 12 members.',
  ])('shows the server error and retains the code for correction: %s', async (message) => {
    mutationPost.mockRejectedValue({ response: { data: { message } } })
    await render()
    await submitCode('ABCD2345')
    expect(wrapper.get('#gm-join-error').text()).toBe(message)
    expect(wrapper.get('#gm-join-code').element.value).toBe('ABCD2345')
    expect(wrapper.text()).not.toContain('You joined')
  })

  it('copies the selected group code and updates it when the group changes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    state.groups.push(group('first'), group('second', 'EFGH6789'))
    await render('/groupwork?group=first')
    const copy = () => wrapper.findAll('button').find((button) => button.text() === 'Copy code')
    await copy().trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('ABCD2345')
    expect(wrapper.text()).toContain('Code copied.')
    await wrapper.get('#gm-group').setValue('second')
    expect(wrapper.text()).not.toContain('Code copied.')
    await copy().trigger('click')
    expect(writeText).toHaveBeenLastCalledWith('EFGH6789')
  })
})

describe('group overview and leaving', () => {
  it('starts on an overview, opens a group, and returns without changing membership', async () => {
    state.groups.push(group('first'), group('second', 'EFGH6789'))
    const router = await render()
    expect(wrapper.get('h1').text()).toBe('Group Meetings')
    expect(wrapper.findAll('.gm-group-card')).toHaveLength(2)
    expect(wrapper.find('#gm-group').exists()).toBe(false)
    expect(wrapper.get('a[href="/dashboard"]').text()).toBe('Back to dashboard')

    await wrapper.get('button[aria-label="Open first team"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.group).toBe('first')
    expect(wrapper.get('h1').text()).toBe('first team')
    expect(wrapper.get('#gm-group').element.value).toBe('first')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Back to groups'))
      .trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.group).toBeUndefined()
    expect(wrapper.findAll('.gm-group-card')).toHaveLength(2)
    expect(wrapper.find('#gm-group').exists()).toBe(false)
    expect(mutationPost).not.toHaveBeenCalled()
  })

  it('clears group and meeting deep links when returning to the overview', async () => {
    state.groups.push(group('first'))
    const router = await render('/groupwork?group=first&meeting=target')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Back to groups'))
      .trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.get('h1').text()).toBe('Group Meetings')
    expect(wrapper.find('#gm-leave-group').exists()).toBe(false)
    expect(state.groups).toHaveLength(1)
  })

  it('updates the URL when switching groups and removes the old meeting link', async () => {
    state.groups.push(group('first'), group('second', 'EFGH6789'))
    const router = await render('/groupwork?group=first&meeting=target')
    await wrapper.get('#gm-group').setValue('second')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ group: 'second' })
    expect(wrapper.get('h1').text()).toBe('second team')
  })

  it('returns to the overview when a requested group is unavailable', async () => {
    state.groups.push(group('first'))
    const router = await render('/groupwork?group=first')
    await router.push('/groupwork?group=missing')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Group Meetings')
    expect(wrapper.find('#gm-group').exists()).toBe(false)
  })

  it('lets the user cancel leaving without sending a request', async () => {
    state.groups.push(group())
    await render('/groupwork?group=project')
    await wrapper.get('#gm-leave-group').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Leave project team?')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Stay in group')
      .trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(mutationPost).not.toHaveBeenCalled()
    expect(wrapper.get('#gm-group').element.value).toBe('project')
  })

  it('leaves the selected group and returns to the updated group list', async () => {
    state.groups.push(group('first'), group('second', 'EFGH6789'))
    mutationPost.mockImplementation(async () => {
      state.groups = state.groups.filter((item) => item.id !== 'first')
      return { data: { groupId: 'first', deleted: false, newOwnerId: 'owner' } }
    })
    const router = await render('/groupwork?group=first&meeting=target')
    await wrapper.get('#gm-leave-group').trigger('click')
    await wrapper.get('#gm-confirm-leave').trigger('click')
    await flushPromises()
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/group-meetings\/groups\/first\/leave$/),
      {},
      { withCredentials: true },
    )
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.get('h1').text()).toBe('Group Meetings')
    expect(wrapper.findAll('.gm-group-card')).toHaveLength(1)
    expect(wrapper.get('.gm-group-card').text()).toContain('second team')
    expect(wrapper.text()).toContain('You left first team.')
    expect(wrapper.find('#gm-group').exists()).toBe(false)
  })

  it('warns the last member and shows onboarding after the group closes', async () => {
    state.groups.push({ ...group(), isOwner: true })
    mutationPost.mockImplementation(async () => {
      state.groups = []
      return { data: { groupId: 'project', deleted: true, newOwnerId: null } }
    })
    await render('/groupwork?group=project')
    await wrapper.get('#gm-leave-group').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain(
      'Leaving will close the group and remove its meetings.',
    )
    await wrapper.get('#gm-confirm-leave').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('The empty group was closed.')
    expect(wrapper.text()).toContain('Start a group')
    expect(wrapper.find('#gm-join-code').exists()).toBe(true)
  })

  it('explains ownership transfer before the owner leaves a populated group', async () => {
    state.groups.push({
      ...group(),
      isOwner: true,
      members: [
        { id: 'owner', name: 'Owner', scheduleStatus: 'complete' },
        { id: 'teammate', name: 'Teammate', scheduleStatus: 'complete' },
      ],
    })
    await render('/groupwork?group=project')
    await wrapper.get('#gm-leave-group').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Ownership will pass to another member')
  })

  it('keeps the group open with a visible error if leaving fails', async () => {
    state.groups.push(group())
    mutationPost.mockRejectedValue({
      response: { data: { message: 'Could not leave. Try again.' } },
    })
    await render('/groupwork?group=project')
    await wrapper.get('#gm-leave-group').trigger('click')
    await wrapper.get('#gm-confirm-leave').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe('Could not leave. Try again.')
    expect(wrapper.get('#gm-confirm-leave').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('#gm-group').element.value).toBe('project')
  })
})

describe('automatic availability and shared calendar booking', () => {
  it('loads the selected team’s availability with a one-hour deadline buffer', async () => {
    state.groups.push(group())
    await render('/groupwork?group=project')
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/common-time$/),
      expect.objectContaining({
        groupId: 'project',
        assignmentBufferMinutes: 60,
        durationMinutes: 60,
      }),
      { withCredentials: true },
    )
    expect(wrapper.find('.ag-table').exists()).toBe(true)
    expect(wrapper.text()).toContain('2 activities')
    expect(wrapper.text()).toContain('1 unfinished deadlines')
    expect(wrapper.get('.gm-book-button').attributes('disabled')).toBeDefined()
  })

  it('refetches availability and clears a chosen time when the deadline buffer changes', async () => {
    state.groups.push(group())
    await render('/groupwork?group=project')
    await wrapper.get('.ag-cell-everyone').trigger('click')
    expect(wrapper.find('.gm-chosen-time').exists()).toBe(true)
    await wrapper.get('#gm-buffer').setValue(120)
    expect(wrapper.find('.gm-chosen-time').exists()).toBe(false)
    await vi.waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringMatching(/\/common-time$/),
        expect.objectContaining({ assignmentBufferMinutes: 120 }),
        { withCredentials: true },
      ),
    )
    await flushPromises()
  })

  it('books an explicitly chosen shared time and shows the meeting on the calendar list', async () => {
    state.groups.push({ ...group(), isOwner: true })
    mutationPost.mockImplementation(async (url, body) => {
      if (url.endsWith('/preview')) return { data: { conflicts: [] } }
      const meeting = {
        id: 'booked-meeting',
        groupId: body.groupId,
        title: body.title,
        startAt: body.startAt,
        endAt: body.endAt,
        participantIds: ['teammate'],
        isMine: true,
      }
      state.meetings.push(meeting)
      return { data: { meeting, activityId: 'activity-booked-meeting' } }
    })
    await render('/groupwork?group=project')
    await wrapper.get('.ag-cell-everyone').trigger('click')
    await wrapper.get('#gm-meeting-title').setValue('Project catch-up')
    await wrapper
      .get('#gm-meeting-title')
      .element.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/group-meetings\/meetings$/),
      expect.objectContaining({
        groupId: 'project',
        title: 'Project catch-up',
        assignmentBufferMinutes: 60,
        force: false,
      }),
      { withCredentials: true },
    )
    expect(wrapper.get('#meeting-booked-meeting').text()).toContain('Project catch-up')
    expect(wrapper.text()).toContain('dashboard calendar')
    axios.delete.mockImplementation(async () => {
      state.meetings = []
      return { data: { ok: true } }
    })
    await wrapper.get('button[aria-label="Cancel Project catch-up"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm cancel')
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('#meeting-booked-meeting').exists()).toBe(false)
    expect(wrapper.find('.gm-booked-notice').exists()).toBe(false)
  })

  it('refreshes after a booking conflict rather than overriding another member’s schedule', async () => {
    state.groups.push(group())
    mutationPost.mockImplementation(async (url) => {
      if (url.endsWith('/preview')) return { data: { conflicts: [] } }
      throw {
        response: {
          status: 409,
          data: { code: 'slot_conflict', message: 'A teammate is now busy. Pick another time.' },
        },
      }
    })
    await render('/groupwork?group=project')
    const previousSearches = axios.post.mock.calls.filter(([url]) =>
      url.endsWith('/common-time'),
    ).length
    await wrapper.get('.ag-cell-everyone').trigger('click')
    await wrapper.get('#gm-meeting-title').setValue('Project catch-up')
    await wrapper
      .get('#gm-meeting-title')
      .element.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('A teammate is now busy')
    expect(wrapper.find('.gm-chosen-time').exists()).toBe(false)
    expect(
      axios.post.mock.calls.filter(([url]) => url.endsWith('/common-time')).length,
    ).toBeGreaterThan(previousSearches)
    expect(axios.post.mock.calls.some(([, body]) => body?.force === true)).toBe(false)
  })
})
