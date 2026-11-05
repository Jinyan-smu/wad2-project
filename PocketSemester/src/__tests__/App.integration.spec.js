import { describe, it, expect } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../App.vue'
import LoginView from '@/views/LoginView.vue'
import RegisterView from '@/views/RegisterView.vue'

describe('App and authentication views integration', () => {
  it('lets a user open registration from login and return to login', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'Login', component: LoginView },
        { path: '/register', name: 'Register', component: RegisterView },
      ],
    })
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    try {
      expect(wrapper.get('h1').text()).toBe('Welcome back.')

      await wrapper.get('a[href="/register"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Create your account')

      await wrapper.get('a[href="/login"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Welcome back.')
    } finally {
      wrapper.unmount()
    }
  })
})
