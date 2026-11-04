import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupAvailabilityGrid from '../components/GroupAvailabilityGrid.vue'

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
    const wrapper = mount(GroupAvailabilityGrid, {
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

  it('distinguishes busy, partially free and too-short cells and prevents selection', async () => {
    const wrapper = mount(GroupAvailabilityGrid, {
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
    expect(buttons[2].classes()).toContain('ag-cell-no-fit')
    expect(buttons[2].attributes('aria-label')).toContain(
      'A full 60-minute meeting cannot start here',
    )
    for (const button of buttons) {
      expect(button.attributes('disabled')).toBeDefined()
      await button.trigger('click')
    }
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('shows the full selected duration across consecutive buckets', () => {
    const cells = ['09:00', '09:15', '09:30', '09:45', '10:00'].map((time) => cell(time))
    const wrapper = mount(GroupAvailabilityGrid, {
      props: {
        availability: availability(cells),
        selectedStart: cells[0].startAt,
        durationMinutes: 60,
      },
    })
    expect(wrapper.findAll('.ag-cell-selected')).toHaveLength(4)
    expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(4)
    expect(wrapper.get('.ag-selection-start').attributes('title')).toContain(
      'Part of your selected meeting',
    )
    expect(wrapper.get('.ag-selection-end').attributes('aria-label')).toContain('09:45–10:00')
    expect(wrapper.get('[role="status"]').text()).toContain('4 Nov · 09:00–10:00')
  })

  it('aligns different daily hours by wall time and never fills missing buckets as free', () => {
    const second = cell('10:00')
    const wrapper = mount(GroupAvailabilityGrid, {
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
    const wrapper = mount(GroupAvailabilityGrid)
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
})
