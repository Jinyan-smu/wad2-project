import { createRouter, createWebHistory } from 'vue-router'
import Register from '@/components/Register.vue'
import Login from '@/components/Login.vue'
import Dashboard from '@/components/Dashboard.vue'
import Assignments from '@/components/Assignments.vue'
import GroupWork from '@/components/GroupWork.vue'
import axios from 'axios'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: Login
    },
    {
      path: '/login',
      name: 'Login',
      component: Login
    },
    {
      path: '/register',
      name: 'Register',
      component: Register
    }, 
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: Dashboard,
      meta: {requiresAuth: true}
    },
    {
      path: '/assignments',
      name: 'Assignments',
      component: Assignments,
      meta: {requiresAuth: true}
    },
    {
      path: '/groupwork',
      name: 'GroupWork',
      component: GroupWork,
      meta: {requiresAuth: true}
    }

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
      withCredentials: true
    })

    return true
  } catch (error){
    return {
      name: 'Login',
      query: {
        required: 'true',
        redirect: to.fullPath
      }
    }
  }
})


export default router
