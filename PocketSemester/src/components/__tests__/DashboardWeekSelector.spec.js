import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardWeekSelector from '@/components/DashboardWeekSelector.vue'

let wrapper
const days = () =>
  Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2026, 10, 2 + index)
    return {
      date,
      key: '2026-11-' + String(2 + index).padStart(2, '0'),
      label: date.toLocaleDateString('en-SG', { weekday: 'short' }),
      count: [0, 1, 3, 5, 2, 4, 0][index],
      deadlines: index === 3 ? 4 : index === 2 ? 2 : 0,
      today: index === 2,
    }
  })
function render(props = {}) {
  wrapper = mount(DashboardWeekSelector, {
    props: { days: days(), selectedKey: '2026-11-04', ...props },
  })
}
afterEach(() => wrapper?.unmount())

describe('Dashboard week selector', () => {
  it('selects a date without changing the selection until the parent accepts it', async () => {
    render()
    await wrapper.get('[data-date="2026-11-05"]').trigger('click')
    expect(wrapper.emitted('select')[0][0]).toEqual(new Date(2026, 10, 5))
    expect(wrapper.get('[data-date="2026-11-04"]').attributes('aria-pressed')).toBe('true')
    await wrapper.setProps({ selectedKey: '2026-11-05' })
    expect(wrapper.get('[data-date="2026-11-04"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-date="2026-11-05"]').attributes('aria-pressed')).toBe('true')
  })

  it('describes real workload and retains deadline indicators independently', () => {
    render()
    expect(wrapper.findAll('.week-day')).toHaveLength(7)
    const moderate = wrapper.get('[data-date="2026-11-04"]')
    expect(moderate.attributes('aria-label')).toContain(
      'today, 3 pending items, 2 coursework deadlines, moderate day',
    )
    const busy = wrapper.get('[data-date="2026-11-05"]')
    expect(busy.attributes('aria-label')).toContain('5 pending items, 4 coursework deadlines, busy day')
    expect(wrapper.get('[data-date="2026-11-03"]').attributes('aria-label')).toContain('light day')
    expect(wrapper.get('[data-date="2026-11-02"]').attributes('aria-label')).toContain('clear day')
    expect(wrapper.get('[role="group"]').attributes('aria-describedby')).toBe(
      wrapper.get('p').attributes('id'),
    )
  })

  it('does not present pending counts or workload as known while plans are loading', async () => {
    render({ loading: true })
    expect(wrapper.get('[role="group"]').attributes('aria-busy')).toBe('true')
    const day = wrapper.get('[data-date="2026-11-05"]')
    expect(day.attributes('aria-label')).toContain('loading plans')
    expect(day.attributes('aria-label')).not.toContain('5 pending')
    await wrapper.setProps({ loading: false, selectedKey: '2026-11-20' })
    expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(0)
  })
})
