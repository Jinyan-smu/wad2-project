import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GroupAvailabilityGrid from '../components/GroupAvailabilityGrid.vue'

const wrappers = []
function render(options) {
  const wrapper = mount(GroupAvailabilityGrid, options)
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})
const members = [
  { id: 'rithik', name: 'Rithik Panneer' },
  { id: 'huang', name: 'Huang Chujun' },
  { id: 'yang', name: 'Yang Qizuo' },
]

function cell(time, overrides = {}) {
  const start = Date.parse(`2026-11-04T${time}:00+08:00`)
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + 15 * 60000).toISOString(),
    freeCount: 3,
    totalCount: 3,
    canBook: true,
    busyMemberIds: [],
    ...overrides,
  }
}
function availability(cells, moreDays = []) {
  return { stepMinutes: 15, days: [{ date: '2026-11-04', cells }, ...moreDays] }
}

describe('GroupAvailabilityGrid', () => {
  it('selects a start with the chosen meeting duration instead of the bucket end', async () => {
    const start = cell('09:00')
    const wrapper = render({
      props: { availability: availability([start]), durationMinutes: 60 },
    })
    const button = wrapper.get('.ag-cell')
    expect(button.attributes('aria-label')).toContain('3 of 3 members free')
    expect(button.attributes('aria-label')).toContain('Wednesday, 4 November, 09:00–09:15')
    await button.trigger('click')
    expect(wrapper.emitted('select')).toEqual([
      [
        {
          date: '2026-11-04',
          startAt: start.startAt,
          endAt: '2026-11-04T02:00:00.000Z',
        },
      ],
    ])
  })

  it('colors only by per-slot counts while keeping unavailable meeting starts inspectable', async () => {
    const wrapper = render({
      props: {
        availability: availability([
          cell('09:00', { freeCount: 0, canBook: false }),
          cell('09:15', { freeCount: 2, canBook: false }),
          cell('09:30', { canBook: false }),
        ]),
      },
    })
    const buttons = wrapper.findAll('.ag-cell')
    expect(buttons[0].classes()).toContain('ag-cell-busy')
    expect(buttons[1].classes()).toContain('ag-cell-some')
    expect(buttons[2].classes()).toContain('ag-cell-everyone')
    expect(buttons[2].classes()).not.toContain('ag-cell-no-fit')
    expect(buttons.map((button) => button.get('.ag-cell-count').text())).toEqual([
      '0/3',
      '2/3',
      '3/3',
    ])
    expect(buttons[2].attributes('aria-label')).toContain(
      'A full 60-minute meeting cannot start here',
    )
    for (const button of buttons) {
      expect(button.attributes('aria-disabled')).toBe('true')
      expect(button.attributes('disabled')).toBeUndefined()
      await button.trigger('click')
    }
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('shows the full selected duration across consecutive buckets', () => {
    const cells = ['09:00', '09:15', '09:30', '09:45', '10:00'].map((time) => cell(time))
    const wrapper = render({
      props: {
        availability: availability(cells),
        selectedStart: cells[0].startAt,
        durationMinutes: 60,
      },
    })
    expect(wrapper.findAll('.ag-cell-selected')).toHaveLength(4)
    expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(4)
    expect(wrapper.get('.ag-selection-start').attributes('aria-label')).toContain(
      'Part of your selected meeting',
    )
    expect(wrapper.get('.ag-selection-end').attributes('aria-label')).toContain('09:45–10:00')
    expect(wrapper.get('[role="status"]').text()).toContain('4 Nov · 09:00–10:00')
  })

  it('aligns different daily hours by wall time and never fills missing buckets as free', () => {
    const second = cell('10:00')
    const wrapper = render({
      props: {
        availability: availability(
          [cell('09:00')],
          [
            {
              date: '2026-11-05',
              cells: [
                {
                  ...second,
                  startAt: '2026-11-05T02:00:00.000Z',
                  endAt: '2026-11-05T02:15:00.000Z',
                },
              ],
            },
          ],
        ),
      },
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.findAll('button.ag-cell')).toHaveLength(2)
    expect(wrapper.findAll('.ag-cell-missing')).toHaveLength(2)
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('09:00')
    expect(wrapper.findAll('tbody tr')[1].text()).toContain('10:00')
    expect(wrapper.get('table').attributes('style')).toContain('min-width: 236px')
  })

  it('shows a meaningful empty state and a separate loading status', async () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('Choose your dates and meeting length')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.setProps({ loading: true })
    expect(wrapper.get('[role="status"]').text()).toContain('Comparing the team')
    expect(wrapper.get('.ag-shell').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.setProps({
      loading: false,
      availability: { stepMinutes: 15, days: [{ date: '2026-11-04', cells: [] }] },
    })
    expect(wrapper.find('.ag-empty').exists()).toBe(true)
  })

  it('keeps availability counts and colors unchanged when only the meeting length changes', async () => {
    const start = cell('09:00')
    const wrapper = render({ props: { availability: availability([start]), durationMinutes: 30 } })
    const classes = wrapper.get('.ag-cell').classes()
    await wrapper.setProps({
      availability: availability([{ ...start, canBook: false }]),
      durationMinutes: 90,
    })
    expect(wrapper.get('.ag-cell').classes()).toEqual(classes)
    expect(wrapper.get('.ag-cell-count').text()).toBe('3/3')
    await wrapper.get('.ag-cell').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(document.querySelector('[role="tooltip"]').textContent).toContain(
      'A full 90-minute meeting cannot start here',
    )
  })

  it('shows exactly who is available and busy on hover, even for an unbookable start', async () => {
    const wrapper = render({
      props: {
        members,
        availability: availability([
          cell('09:00', { freeCount: 2, busyMemberIds: ['yang'], canBook: false }),
        ]),
      },
    })
    const button = wrapper.get('.ag-cell')
    await button.trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('[role="tooltip"]')
    expect(tooltip.querySelector('.ag-detail-free').textContent).toContain('Rithik Panneer')
    expect(tooltip.querySelector('.ag-detail-free').textContent).toContain('Huang Chujun')
    expect(tooltip.querySelector('.ag-detail-free').textContent).not.toContain('Yang Qizuo')
    expect(tooltip.querySelector('.ag-detail-busy').textContent).toContain('Yang Qizuo')
    expect(tooltip.textContent).toContain('09:00–09:15')
    expect(tooltip.textContent).toContain('2/3 free')
    expect(button.attributes('aria-describedby')).toBe(tooltip.id)
    expect(tooltip.style.visibility).toBe('visible')
  })

  it('supports keyboard inspection, Escape dismissal, and tapping a busy slot without booking', async () => {
    const wrapper = render({
      props: {
        members,
        availability: availability([
          cell('09:00', {
            freeCount: 0,
            busyMemberIds: members.map((member) => member.id),
            canBook: false,
          }),
        ]),
      },
    })
    const button = wrapper.get('.ag-cell')
    await button.trigger('focus')
    expect(document.querySelector('[role="tooltip"] .ag-detail-free').textContent).toContain(
      'No one is free',
    )
    expect(document.querySelectorAll('[role="tooltip"] .ag-detail-busy li')).toHaveLength(3)
    await button.trigger('keydown', { key: 'Escape' })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await button.trigger('click')
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('handles all-free slots and clears stale names on scroll or refreshed availability', async () => {
    const wrapper = render({ props: { members, availability: availability([cell('09:00')]) } })
    await wrapper.get('.ag-cell').trigger('mouseenter')
    expect(document.querySelectorAll('[role="tooltip"] .ag-detail-free li')).toHaveLength(3)
    expect(document.querySelector('[role="tooltip"] .ag-detail-busy').textContent).toContain(
      'No one is busy',
    )
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await wrapper.get('.ag-cell').trigger('focus')
    await wrapper.setProps({
      availability: availability([
        cell('09:00', { freeCount: 2, busyMemberIds: ['yang'], canBook: false }),
      ]),
    })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await wrapper.get('.ag-cell').trigger('mouseenter')
    expect(document.querySelector('[role="tooltip"] .ag-detail-busy').textContent).toContain(
      'Yang Qizuo',
    )
  })
})
