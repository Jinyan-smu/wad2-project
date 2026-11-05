import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import PlannerNavigation from '@/components/PlannerNavigation.vue'

let wrapper
afterEach(() => wrapper?.unmount())

async function render(props, slots = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(props.active)
  await router.isReady()
  wrapper = mount(PlannerNavigation, {
    props,
    slots,
    global: { plugins: [router], stubs: { LogoutButton: true } },
  })
  return router
}

describe('Shared planner navigation', () => {
  it('marks the current page and links to the overall calendar', async () => {
    await render({ active: '/activities' })
    const current = wrapper.get('[aria-current="page"]')
    expect(current.text()).toBe('Activities')
    expect(wrapper.get('a[href="/calendar"]').text()).toBe('Calendar')
    expect(wrapper.find('a[href="/dashboard#dashboard-weather"]').exists()).toBe(false)
  })

  it('closes the mobile menu after selecting a route', async () => {
    const router = await render({ active: '/activities', mobile: true })
    wrapper.get('details').element.open = true
    await wrapper.get('a[href="/assignments"]').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/assignments'))
    expect(wrapper.get('details').element.open).toBe(false)
  })

  it('preserves page-specific invitation controls in desktop and mobile navigation', async () => {
    const respond = vi.fn()
    await render(
      { active: '/groupwork' },
      {
        extra: { template: '<button @click="respond">Invitations</button>', methods: { respond } },
      },
    )
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ mobile: true })
    await wrapper.get('button').trigger('click')
    expect(respond).toHaveBeenCalledTimes(2)
  })
})
