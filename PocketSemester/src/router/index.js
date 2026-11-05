import { createRouter, createWebHistory } from 'vue-router'
import RegisterView from '@/views/RegisterView.vue'
import LoginView from '@/views/LoginView.vue'
import DashboardView from '@/views/DashboardView.vue'
import CalendarView from '@/views/CalendarView.vue'
import AssignmentsView from '@/views/AssignmentsView.vue'
import ActivitiesView from '@/views/ActivitiesView.vue'
import GroupWorkView from '@/views/GroupWorkView.vue'
import axios from 'axios'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) {
      const mobileNavHeight =
        document.querySelector('.planner-mobile-bar')?.getBoundingClientRect().height || 0
      return { el: to.hash, top: mobileNavHeight + 20 }
    }
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      component: LoginView,
    },
    {
      path: '/login',
      name: 'Login',
      component: LoginView,
    },
    {
      path: '/register',
      name: 'Register',
      component: RegisterView,
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    {
      path: '/calendar',
      name: 'Calendar',
      component: CalendarView,
      meta: { requiresAuth: true },
    },
    {
      path: '/assignments',
      name: 'Assignments',
      component: AssignmentsView,
      meta: { requiresAuth: true },
    },
    {
      path: '/activities',
      name: 'Activities',
      component: ActivitiesView,
      meta: { requiresAuth: true },
    },
    {
      path: '/groupwork',
      name: 'GroupWork',
      component: GroupWorkView,
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to) => {
  console.log('Navigating to:', to.fullPath)
  console.log('Requires authentication:', to.meta.requiresAuth)
  if (!to.meta.requiresAuth) {
    return true
  }

  try {
    await axios.get('http://localhost:8000/api/me', {
      withCredentials: true,
    })

    return true
  } catch (error) {
    return {
      name: 'Login',
      query: {
        required: 'true',
        redirect: to.fullPath,
      },
    }
  }
})

export default router
