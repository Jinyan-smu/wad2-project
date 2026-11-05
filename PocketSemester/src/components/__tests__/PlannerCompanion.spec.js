import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlannerCompanion from '@/components/PlannerCompanion.vue'
import LoginCharacters from '@/components/LoginCharacters.vue'

let wrapper
let media
function render(props = {}) {
  wrapper = mount(PlannerCompanion, {
    props: { message: 'Two deadlines tomorrow.', ...props },
    global: { stubs: { LoginCharacters: true } },
  })
  return wrapper
}
beforeEach(() => {
  sessionStorage.clear()
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Planner companion reactions', () => {
  it('keeps the existing hover reaction and lets a completion reaction take priority', async () => {
    render()
    const characters = () => wrapper.getComponent(LoginCharacters)
    expect(characters().props('mood')).toBe('idle')
    await wrapper.trigger('pointerenter')
    expect(characters().props('mood')).toBe('excited')
    await wrapper.setProps({ mood: 'success', message: 'Project proposal completed. Nice work!' })
    expect(characters().props('mood')).toBe('success')
    expect(wrapper.get('.companion-message').text()).toBe('Project proposal completed. Nice work!')
    await wrapper.trigger('pointerleave')
    expect(characters().props('mood')).toBe('success')
    await wrapper.setProps({ mood: 'idle' })
    expect(characters().props('mood')).toBe('idle')
  })

  it('honors system reduced motion even when the stored login choice enables animation', async () => {
    sessionStorage.setItem('student-planner:login-reduced-motion', 'false')
    media.matches = true
    render({ mood: 'success' })
    await wrapper.vm.$nextTick()
    expect(wrapper.getComponent(LoginCharacters).props('animate')).toBe(false)
    expect(wrapper.attributes('data-animate')).toBe('false')
    const onChange = media.addEventListener.mock.calls[0][1]
    media.matches = false
    onChange()
    await wrapper.vm.$nextTick()
    expect(wrapper.getComponent(LoginCharacters).props('animate')).toBe(true)
  })

  it('honors a stored pause and removes the system preference listener on unmount', async () => {
    sessionStorage.setItem('student-planner:login-reduced-motion', 'true')
    render()
    await wrapper.vm.$nextTick()
    expect(wrapper.getComponent(LoginCharacters).props('animate')).toBe(false)
    const onChange = media.addEventListener.mock.calls[0][1]
    wrapper.unmount()
    wrapper = null
    expect(media.removeEventListener).toHaveBeenCalledWith('change', onChange)
  })
})
