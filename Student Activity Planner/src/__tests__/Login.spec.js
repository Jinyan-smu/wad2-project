import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Login from '../components/Login.vue'

const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }))

vi.mock('axios', () => ({ default: { post: mocks.post } }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: mocks.push }),
}))

let wrapper

beforeEach(() => {
  sessionStorage.removeItem('student-planner:login-reduced-motion')
  mocks.post.mockReset()
  mocks.push.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
})

afterEach(() => {
  sessionStorage.removeItem('student-planner:login-reduced-motion')
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function render() {
  wrapper = mount(Login, {
    global: {
      stubs: {
        LoginCharacters: {
          name: 'LoginCharacters',
          props: ['mood', 'gaze', 'animate'],
          template: '<div aria-hidden="true" />',
        },
        RouterLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
  return wrapper
}

function mood() {
  return wrapper.findComponent({ name: 'LoginCharacters' }).props('mood')
}

async function enterCredentials(email = 'hello@university.edu', password = 'sample-password') {
  await wrapper.get('#email').setValue(email)
  await wrapper.get('#password').setValue(password)
}

async function moveMouse(page, clientX, clientY) {
  const event = new MouseEvent('pointermove', { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  page.element.dispatchEvent(event)
  await wrapper.vm.$nextTick()
}

describe('Peekaboo login', () => {
  it('lets the user enable animations despite reduced motion and remembers their choice', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    render()
    const characters = () => wrapper.findComponent({ name: 'LoginCharacters' })
    await wrapper.vm.$nextTick()
    expect(characters().props('animate')).toBe(false)
    await wrapper.get('.character-motion-control button').trigger('click')
    expect(characters().props('animate')).toBe(true)
    expect(wrapper.get('.character-motion-control button').text()).toBe('Pause animations')
    const page = wrapper.get('.peekaboo-login')
    vi.spyOn(page.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    })
    await moveMouse(page, 750, 200)
    expect(characters().props('gaze').x).toBeGreaterThan(0)
    wrapper.unmount()
    render()
    await wrapper.vm.$nextTick()
    expect(characters().props('animate')).toBe(true)
    await wrapper.get('.character-motion-control button').trigger('click')
    expect(characters().props('animate')).toBe(false)
    expect(characters().props('gaze')).toEqual({ x: 0, y: 0 })
  })

  it('follows the pointer and resets its gaze when the pointer leaves', async () => {
    render()
    const page = wrapper.get('.peekaboo-login')
    vi.spyOn(page.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    })

    await moveMouse(page, 750, 200)

    const gaze = wrapper.findComponent({ name: 'LoginCharacters' }).props('gaze')
    expect(gaze.x).toBeGreaterThan(0)
    expect(gaze.y).toBeLessThan(0)

    await page.trigger('pointerleave')
    expect(wrapper.findComponent({ name: 'LoginCharacters' }).props('gaze')).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('keeps its gaze still when reduced motion is preferred', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    render()
    const page = wrapper.get('.peekaboo-login')
    vi.spyOn(page.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    })

    await moveMouse(page, 750, 200)

    expect(wrapper.findComponent({ name: 'LoginCharacters' }).props('gaze')).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('validates empty fields before sending a login request', async () => {
    render()
    await wrapper.get('form').trigger('submit')

    expect(mocks.post).not.toHaveBeenCalled()
    expect(wrapper.get('#email').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#password').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Enter your email address.')
    expect(wrapper.text()).toContain('Enter your password.')
  })

  it('rejects an invalid email without making a request', async () => {
    render()
    await enterCredentials('not-an-email')
    await wrapper.get('form').trigger('submit')

    expect(mocks.post).not.toHaveBeenCalled()
    expect(wrapper.get('#email').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Enter a valid email address.')
  })

  it('reacts to input focus and keeps the password when visibility changes', async () => {
    render()
    await wrapper.get('#email').trigger('focus')
    expect(mood()).toBe('email')

    await wrapper.get('#password').setValue('sample-password')
    await wrapper.get('#password').trigger('focus')
    expect(mood()).toBe('private')
    expect(wrapper.get('#password').attributes('type')).toBe('password')

    await wrapper.get('button[aria-label="Show password"]').trigger('click')
    expect(mood()).toBe('peek')
    expect(wrapper.get('#password').attributes('type')).toBe('text')
    expect(wrapper.get('button[aria-label="Hide password"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.get('#password').element.value).toBe('sample-password')

    await wrapper.get('button[aria-label="Hide password"]').trigger('click')
    expect(wrapper.get('#password').attributes('type')).toBe('password')
    expect(wrapper.get('button[aria-label="Show password"]').attributes('aria-pressed')).toBe(
      'false',
    )
  })

  it('keeps the characters looking away from a revealed password after focus moves', async () => {
    render()
    await enterCredentials()
    await wrapper.get('button[aria-label="Show password"]').trigger('click')
    await wrapper.get('#password').trigger('blur')
    await wrapper.get('#email').trigger('focus')
    expect(mood()).toBe('peek')

    await wrapper.get('#email').trigger('blur')
    await wrapper.get('button[type="submit"]').trigger('focus')
    expect(mood()).toBe('peek')
  })

  it('shows a readable server error and preserves details so the user can correct them', async () => {
    mocks.post.mockRejectedValue({
      message: 'Request failed with status code 401',
      response: { data: { message: 'Email or password is incorrect.' } },
    })
    render()
    await enterCredentials()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Email or password is incorrect.')
    expect(wrapper.text()).not.toContain('Request failed with status code 401')
    expect(wrapper.get('#email').element.value).toBe('hello@university.edu')
    expect(wrapper.get('#password').element.value).toBe('sample-password')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('does not render error objects when the server has no usable message', async () => {
    mocks.post.mockRejectedValue({
      message: 'Internal transport detail',
      response: { data: { message: { debug: 'Server-only detail' } } },
    })
    render()
    await enterCredentials()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const error = wrapper.get('[role="alert"]').text()
    expect(error.length).toBeGreaterThan(0)
    expect(error).not.toContain('[object Object]')
    expect(error).not.toContain('Server-only detail')
    expect(error).not.toContain('Internal transport detail')
  })

  it('uses the existing credential request and reaches the dashboard after a successful login', async () => {
    vi.useFakeTimers()
    mocks.post.mockResolvedValue({ data: {} })
    render()
    await enterCredentials('  hello@university.edu  ')
    await wrapper.get('form').trigger('submit')

    expect(mocks.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/login',
      { email: 'hello@university.edu', password: 'sample-password' },
      { withCredentials: true },
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.push).toHaveBeenCalledWith('/dashboard')
  })

  it('keeps account creation linked to the registration page', () => {
    render()
    expect(wrapper.get('a[href="/register"]').text()).toBe('Create an account')
  })
})
