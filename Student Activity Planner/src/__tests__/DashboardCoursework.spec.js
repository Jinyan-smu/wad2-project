import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardCoursework from '../components/DashboardCoursework.vue'

const at = (day, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute)
const item = (key, type, when, extra = {}) => ({
  key,
  type,
  when,
  title: key,
  courseName: 'WAD2',
  done: false,
  ...extra,
})
let wrapper
function render(items = [], props = {}) {
  wrapper = mount(DashboardCoursework, {
    props: { items, weekStart: at(2, 0), now: at(4), ...props },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}
afterEach(() => wrapper?.unmount())
const keys = (type) =>
  wrapper
    .findAll('#weekly-' + type + '-list .coursework-row')
    .map((row) => row.attributes('data-coursework-key'))

describe('Weekly dashboard coursework', () => {
  it('uses the selected local week and assignment deadline rather than its event date', async () => {
    render([
      item('later', 'assignment', at(7), { dueAt: at(8, 23, 59) }),
      item('monday-overdue', 'assignment', at(1), { dueAt: at(2, 0) }),
      item('wrong-week', 'assignment', at(4), { dueAt: at(9, 0) }),
      item('before-week', 'assignment', at(1, 23, 59)),
      item('completed', 'assignment', at(5), { done: true }),
      item('activity', 'activity', at(5)),
      item('no-date', 'assignment', null),
      item('bad-date', 'assignment', new Date('invalid')),
    ])
    expect(keys('assignment')).toEqual(['monday-overdue', 'later'])
    expect(wrapper.get('#weekly-assignment-list').text()).toContain('Overdue')
    expect(wrapper.get('.coursework-week').text()).toContain('2 Nov')
    await wrapper.setProps({ weekStart: at(9, 0) })
    expect(keys('assignment')).toEqual(['wrong-week'])
  })

  it('shows only upcoming quizzes in the week using their start time', () => {
    render([
      item('later', 'quiz', at(6), { dueAt: at(15) }),
      item('just-starting', 'quiz', at(4)),
      item('past', 'quiz', at(4, 11, 59)),
      item('next-week', 'quiz', at(9, 0), { dueAt: at(5) }),
      item('done', 'quiz', at(5), { done: true }),
      item('fallback', 'quiz', null, { dueAt: at(5) }),
    ])
    expect(keys('quiz')).toEqual(['just-starting', 'fallback', 'later'])
    expect(wrapper.get('#weekly-quiz-list').text()).toContain('Starts today')
    expect(wrapper.get('#weekly-assignment-heading').element.parentElement.textContent).toContain(
      '0',
    )
  })

  it('emits the original item for saving and disables its checkbox during a request', async () => {
    const assignment = item('assignment:1:1', 'assignment', at(5))
    render([assignment])
    const checkbox = wrapper.get('input[aria-label="Mark assignment:1:1 as complete"]')
    expect(checkbox.attributes('data-completion-key')).toBe(assignment.key)
    await checkbox.setValue(true)
    expect(wrapper.emitted('complete')[0][0].item).toEqual(assignment)
    expect(wrapper.emitted('complete')[0][0].event.type).toBe('change')
    await wrapper.setProps({ savingItems: [assignment.key] })
    expect(checkbox.element.disabled).toBe(true)
    await wrapper.setProps({ items: [{ ...assignment, done: true }] })
    expect(wrapper.find('#weekly-assignment-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('No unfinished assignments due in the selected week.')
  })

  it('keeps loading and errors distinct from genuine empty results', async () => {
    render([], { loading: true })
    expect(wrapper.get('[role="status"]').text()).toContain('Loading')
    expect(wrapper.text()).not.toContain('No upcoming quizzes')
    await wrapper.setProps({ loading: false, loadError: 'Offline' })
    expect(wrapper.text()).toContain('when the planner loads')
    expect(wrapper.text()).not.toContain('No upcoming quizzes')
    await wrapper.setProps({ loadError: '' })
    expect(wrapper.text()).toContain('No upcoming quizzes in the selected week.')
  })

  it('keeps long weeks compact and reveals the remaining items on request', async () => {
    render(
      Array.from({ length: 5 }, (_, index) => item('task-' + index, 'assignment', at(5, index))),
    )
    expect(keys('assignment')).toHaveLength(3)
    const toggle = wrapper.get('button[aria-controls="weekly-assignment-list"]')
    expect(toggle.text()).toContain('Show 2 more')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(keys('assignment')).toHaveLength(5)
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(keys('assignment')).toHaveLength(3)
    await toggle.trigger('click')
    await wrapper.setProps({ weekStart: at(9, 0) })
    await wrapper.setProps({ weekStart: at(2, 0) })
    expect(keys('assignment')).toHaveLength(3)
  })
})
